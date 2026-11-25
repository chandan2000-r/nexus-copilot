import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SttEvent } from '../src/shared/copilot'
import { STT_ENGINES } from '../src/shared/providers'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import { GatedSession, SegmentedSession, type SttSession } from '../src/services/stt/engines'
import { LocalRecognizer, LocalSpeechModel, PARAKEET_MODEL, type ModelSpec, type SherpaAddon } from '../src/services/stt/localModel'
import { TranscriptionService } from '../src/services/stt/TranscriptionService'

const RATE = 16_000
const voice = (ms: number) => Int16Array.from({ length: (RATE * ms) / 1000 }, (_, i) => Math.round(5000 * Math.sin(i / 3)))
const quiet = (ms: number) => new Int16Array((RATE * ms) / 1000)
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Feeds audio in 100 ms chunks at real-time pace (scaled), like the renderer does. */
async function play(s: SttSession, parts: Int16Array[], msPerChunk = 2) {
  for (const p of parts) {
    for (let off = 0; off < p.length; off += 1600) {
      s.write(p.slice(off, off + 1600))
      await sleep(msPerChunk)
    }
  }
}

function fakeModel(files: Record<string, Buffer>) {
  const spec: ModelSpec = {
    id: 'test',
    url: 'https://models.test/m',
    files: Object.entries(files).map(([name, b]) => ({ name, bytes: b.length, sha256: sha(b) }))
  }
  const requested: string[] = []
  let serve = (name: string) => files[name]
  const fetchFn = (async (url: string) => {
    const name = String(url).split('/').pop()!
    requested.push(name)
    const body = serve(name)
    return new Response(body ? new Uint8Array(body) : null, { status: body ? 200 : 404 })
  }) as unknown as typeof fetch
  return { spec, requested, fetchFn, setServe: (f: typeof serve) => (serve = f) }
}

describe('on-this-computer transcription', () => {
  it('is the default engine and needs no key', () => {
    expect(DEFAULT_SETTINGS.stt.engine).toBe('local')
    expect(STT_ENGINES.local.keyName).toBeNull()
    expect(PARAKEET_MODEL.files.reduce((n, f) => n + f.bytes, 0)).toBeGreaterThan(600_000_000)
  })

  it('downloads the model once, checks hashes, and reports progress', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-model-'))
    const m = fakeModel({ 'tokens.txt': Buffer.from('a b c'), 'encoder.onnx': Buffer.alloc(300_000, 7) })
    const model = new LocalSpeechModel(dir, () => ({}) as SherpaAddon, m.spec, m.fetchFn)
    expect(model.status()).toMatchObject({ state: 'missing', received: 0, total: 300_005 })
    const seen: string[] = []
    // Two callers (e.g. "Them" and "You" starting together) share one download.
    await Promise.all([model.ensure((s) => seen.push(s.state)), model.ensure()])
    expect(m.requested).toEqual(['tokens.txt', 'encoder.onnx'])
    expect(model.status()).toEqual({ state: 'ready', received: 300_005, total: 300_005 })
    expect(readFileSync(join(dir, 'tokens.txt'), 'utf8')).toBe('a b c')
    expect(existsSync(join(dir, 'encoder.onnx.part'))).toBe(false)
    expect(seen).toContain('downloading')
    await model.ensure()
    expect(m.requested).toHaveLength(2) // nothing fetched again
  })

  it('rejects a damaged download, keeps good files, and can retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-model-'))
    const good = Buffer.alloc(5_000, 1)
    const m = fakeModel({ 'tokens.txt': Buffer.from('t'), 'encoder.onnx': good })
    m.setServe((name) => (name === 'encoder.onnx' ? Buffer.alloc(5_000, 2) : Buffer.from('t')))
    const model = new LocalSpeechModel(dir, () => ({}) as SherpaAddon, m.spec, m.fetchFn)
    await expect(model.ensure()).rejects.toThrow(/encoder\.onnx arrived incomplete or damaged/)
    expect(model.status()).toMatchObject({ state: 'error', received: 1 })
    expect(existsSync(join(dir, 'encoder.onnx'))).toBe(false)
    expect(existsSync(join(dir, 'encoder.onnx.part'))).toBe(false)
    m.setServe((name) => (name === 'encoder.onnx' ? good : Buffer.from('t')))
    await model.ensure()
    expect(model.status().state).toBe('ready')
    expect(m.requested.filter((n) => n === 'tokens.txt')).toHaveLength(1)
  })

  it('treats a file of the wrong size as missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-model-'))
    const m = fakeModel({ 'tokens.txt': Buffer.from('abc') })
    writeFileSync(join(dir, 'tokens.txt'), 'ab')
    expect(new LocalSpeechModel(dir, () => ({}) as SherpaAddon, m.spec, m.fetchFn).isOnDisk()).toBe(false)
  })

  it('reports a missing speech engine clearly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-model-'))
    const m = fakeModel({ 'tokens.txt': Buffer.from('abc') })
    writeFileSync(join(dir, 'tokens.txt'), 'abc')
    const model = new LocalSpeechModel(
      dir,
      () => {
        throw new Error('the speech engine is missing from this build')
      },
      m.spec,
      m.fetchFn
    )
    await expect(model.recognizer()).rejects.toThrow(/could not start: the speech engine is missing/)
  })

  it('starts finished utterances at once and runs previews one at a time in between', async () => {
    const order: number[] = []
    const addon: SherpaAddon = {
      createOfflineRecognizerAsync: async () => ({}),
      createOfflineStream: () => ({ samples: 0 }),
      acceptWaveformOffline: (s, w) => void ((s as { samples: number }).samples = w.samples.length),
      decodeOfflineStreamAsync: async (_r, s) => {
        const n = (s as { samples: number }).samples
        order.push(n)
        await sleep(5)
        return JSON.stringify({ text: ` len ${n} ` })
      }
    }
    const r = new LocalRecognizer(addon, {})
    const results = await Promise.all([
      r.transcribe(new Int16Array(1), { partial: true }),
      r.transcribe(new Int16Array(2), { partial: true }),
      r.transcribe(new Int16Array(3)),
      r.transcribe(new Int16Array(4))
    ])
    // The first preview starts; the finals start alongside it; the second preview waits for all three.
    expect(order).toEqual([1, 3, 4, 2])
    expect(results).toEqual(['len 1', 'len 2', 'len 3', 'len 4'])
    const aborted = new AbortController()
    aborted.abort()
    await expect(r.transcribe(new Int16Array(5), { signal: aborted.signal })).rejects.toThrow(/cancelled/)
  })
})

describe('LocalRecognizer concurrency', () => {
  it('does not make a finished utterance wait for a running preview', async () => {
    let active = 0
    let maxActive = 0
    const addon: SherpaAddon = {
      createOfflineRecognizerAsync: async () => ({}),
      createOfflineStream: () => ({}),
      acceptWaveformOffline: () => {},
      decodeOfflineStreamAsync: async () => {
        maxActive = Math.max(maxActive, ++active)
        await sleep(30)
        active--
        return JSON.stringify({ text: 'x' })
      }
    }
    const r = new LocalRecognizer(addon, {})
    const preview = r.transcribe(new Int16Array(1), { partial: true })
    const t = Date.now()
    await r.transcribe(new Int16Array(1))
    expect(Date.now() - t).toBeLessThan(55) // ~30 ms, not ~60 ms
    expect(maxActive).toBe(2)
    await preview
  })
})

describe('live previews', () => {
  it('shows words while someone talks, then the finished line', async () => {
    const events: SttEvent[] = []
    const s = new SegmentedSession(
      'them',
      async (pcm, o) => (o.partial ? `preview ${Math.round(pcm.length / 1600)}` : 'What is a mutex?'),
      (e) => events.push(e),
      { partialEveryMs: 20 }
    )
    await play(s, [quiet(300), voice(2000), quiet(1000)])
    await s.close()
    const kinds = events.filter((e) => e.type === 'partial' || e.type === 'final').map((e) => e.type)
    expect(kinds.filter((k) => k === 'partial').length).toBeGreaterThan(2)
    expect(kinds.at(-1)).toBe('final')
    const previews = events.filter((e) => e.type === 'partial').map((e) => (e as { text: string }).text)
    expect(previews[0]).toMatch(/^preview \d+$/)
    // Previews grow with the utterance.
    expect(Number(previews.at(-1)!.split(' ')[1])).toBeGreaterThan(Number(previews[0].split(' ')[1]))
  })

  it('drops a preview that comes back after its utterance ended', async () => {
    const events: SttEvent[] = []
    const s = new SegmentedSession(
      'you',
      async (_pcm, o) => {
        if (o.partial) await sleep(200)
        return o.partial ? 'late preview' : 'Done.'
      },
      (e) => events.push(e),
      { partialEveryMs: 10 }
    )
    await play(s, [voice(600), quiet(900)], 0)
    await s.close()
    await sleep(250)
    expect(events.filter((e) => e.type === 'partial' && e.text === 'late preview')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'final')).toHaveLength(1)
  })

  it('takes the preview down when the finished utterance is empty', async () => {
    const events: SttEvent[] = []
    const s = new SegmentedSession('you', async (_pcm, o) => (o.partial ? 'uh' : ''), (e) => events.push(e), { partialEveryMs: 10 })
    await play(s, [voice(1500), quiet(900)])
    await s.close()
    const partials = events.filter((e) => e.type === 'partial').map((e) => (e as { text: string }).text)
    expect(partials[0]).toBe('uh')
    expect(partials.at(-1)).toBe('')
  })

  it('cloud engines send no previews', async () => {
    let calls = 0
    const s = new SegmentedSession('them', async () => (calls++, 'Hello there.'), () => {})
    await play(s, [voice(2000), quiet(900)])
    await s.close()
    expect(calls).toBe(1)
  })
})

describe('GatedSession', () => {
  it('ignores audio until ready', async () => {
    const got: number[] = []
    let open!: () => void
    const g = new GatedSession({ write: (p) => got.push(p.length), close: async () => {} }, new Promise<void>((r) => (open = r)))
    g.write(new Int16Array(10))
    open()
    await sleep(0)
    g.write(new Int16Array(20))
    expect(got).toEqual([20])
  })
})

describe('TranscriptionService with the local engine', () => {
  const settings = () => ({ ...DEFAULT_SETTINGS, stt: { ...DEFAULT_SETTINGS.stt, engine: 'local' as const } })

  it('starts listening while the model downloads and shows progress', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-model-'))
    const m = fakeModel({ 'tokens.txt': Buffer.from('x'), 'encoder.onnx': Buffer.alloc(400_000, 3) })
    const addon: SherpaAddon = {
      createOfflineRecognizerAsync: async () => ({}),
      createOfflineStream: () => ({}),
      acceptWaveformOffline: () => {},
      decodeOfflineStreamAsync: async () => JSON.stringify({ text: 'Tell me about yourself.' })
    }
    const model = new LocalSpeechModel(dir, () => addon, m.spec, m.fetchFn)
    const events: SttEvent[] = []
    const svc = new TranscriptionService(settings, () => null, (e) => events.push(e), model)
    expect(await svc.start('them')).toEqual({ ok: true })
    await model.ensure()
    await sleep(20)
    const statuses = events.filter((e) => e.type === 'status').map((e) => (e as { message: string | null }).message)
    expect(statuses[0]).toMatch(/^Downloading the speech model \(one time, 0 MB\): \d+%$/)
    expect(statuses.at(-1)).toBeNull()
    for (const p of [voice(800), quiet(900)]) svc.audio('them', p)
    await svc.stop('them')
    expect(events.filter((e) => e.type === 'final').map((e) => (e as Extract<SttEvent, { type: 'final' }>).line.text)).toEqual([
      'Tell me about yourself.'
    ])
  })

  it('explains a failed download', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-model-'))
    const m = fakeModel({ 'tokens.txt': Buffer.from('x') })
    m.setServe(() => undefined as unknown as Buffer)
    const model = new LocalSpeechModel(dir, () => ({}) as SherpaAddon, m.spec, m.fetchFn)
    const events: SttEvent[] = []
    const svc = new TranscriptionService(settings, () => null, (e) => events.push(e), model)
    await svc.start('you')
    await model.ensure().catch(() => {})
    await sleep(10)
    const err = events.find((e) => e.type === 'error') as { message: string } | undefined
    expect(err?.message).toMatch(/Could not download the speech model: the server answered 404\. Check your internet connection/)
  })

  it('needs the model manager', async () => {
    const svc = new TranscriptionService(settings, () => null, () => {})
    expect(await svc.start('them')).toMatchObject({ ok: false, error: expect.stringMatching(/not available in this build/) })
  })
})

describe('tech term fixes', () => {
  it('repairs common mishearings without touching ordinary words', async () => {
    const { fixTechTerms } = await import('../src/services/stt/techTerms')
    expect(fixTechTerms('How does cubectyl rollout undo work in cubanets?')).toBe('How does kubectl rollout undo work in Kubernetes?')
    expect(fixTechTerms('How does Cubectil roll out on do work in Cuba needs?')).toBe('How does kubectl roll out on do work in Kubernetes?')
    expect(fixTechTerms('What is the difference between post-gresh and mongo DB?')).toBe('What is the difference between PostgreSQL and MongoDB?')
    expect(fixTechTerms('Explain graph QL versus g RPC.')).toBe('Explain GraphQL versus gRPC.')
    expect(fixTechTerms('What is the cap theorem? And the solid principles?')).toBe('What is the CAP theorem? And the SOLID principles?')
    expect(fixTechTerms('We flew to Cuba last year. The cube was solid.')).toBe('We flew to Cuba last year. The cube was solid.')
  })

  it('applies to every transcript line', async () => {
    const { cleanTranscript } = await import('../src/services/stt/engines')
    expect(cleanTranscript('  Explain the CI CD pipeline in dev ops. ', 3000)).toBe('Explain the CI/CD pipeline in DevOps.')
  })
})
