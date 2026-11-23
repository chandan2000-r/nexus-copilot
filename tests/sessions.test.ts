import { describe, expect, it, vi } from 'vitest'
import type { SttEvent } from '../src/shared/copilot'
import { DeepgramSession, SegmentedSession } from '../src/services/stt/engines'

const RATE = 16_000
const voice = (ms: number) => Int16Array.from({ length: (RATE * ms) / 1000 }, (_, i) => Math.round(5000 * Math.sin(i / 3)))
const quiet = (ms: number) => new Int16Array((RATE * ms) / 1000)

describe('SegmentedSession', () => {
  it('emits finals in speaking order even when transcriptions finish out of order', async () => {
    const events: SttEvent[] = []
    let n = 0
    const delays = [120, 10]
    const s = new SegmentedSession(
      'them',
      async () => {
        const i = n++
        await new Promise((r) => setTimeout(r, delays[i]))
        return `utterance ${i + 1} with some words`
      },
      (e) => events.push(e)
    )
    for (const part of [quiet(500), voice(800), quiet(1000), voice(800), quiet(1000)]) s.write(part)
    await s.close()
    const finals = events.filter((e) => e.type === 'final').map((e) => (e as Extract<SttEvent, { type: 'final' }>).line.text)
    expect(finals).toEqual(['utterance 1 with some words', 'utterance 2 with some words'])
    expect(events.filter((e) => e.type === 'speech').map((e) => (e as { speaking: boolean }).speaking)).toEqual([true, false, true, false])
  })

  it('reports transcription errors once instead of per utterance', async () => {
    const events: SttEvent[] = []
    const s = new SegmentedSession('you', async () => Promise.reject(new Error('Transcription error 401')), (e) => events.push(e))
    for (const part of [quiet(300), voice(600), quiet(900), voice(600), quiet(900)]) s.write(part)
    await s.close()
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1)
  })
})

class FakeSocket {
  static OPEN = 1
  readyState = 0
  binaryType = ''
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  constructor(
    public url: string,
    public protocols: string[]
  ) {}
  send(d: unknown) {
    this.sent.push(d)
  }
  addEventListener() {}
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  msg(o: object) {
    this.onmessage?.({ data: JSON.stringify(o) })
  }
}

describe('DeepgramSession', () => {
  it('authenticates with the token subprotocol, buffers until open, and assembles utterances', async () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CONNECTING: 0 })
    let sock!: FakeSocket
    const events: SttEvent[] = []
    const s = new DeepgramSession({ apiKey: 'dg', model: 'nova-3', language: 'auto' }, 'them', (e) => events.push(e), (u, p) => {
      sock = new FakeSocket(u, p)
      return sock as unknown as WebSocket
    })
    expect(sock.protocols).toEqual(['token', 'dg'])
    expect(sock.url).toContain('language=multi')
    expect(sock.url).toContain('sample_rate=16000')
    s.write(new Int16Array(160))
    expect(sock.sent).toHaveLength(0)
    sock.open()
    expect(sock.sent).toHaveLength(1)

    const result = (transcript: string, is_final: boolean, speech_final = false) =>
      sock.msg({ type: 'Results', is_final, speech_final, start: 1.5, channel: { alternatives: [{ transcript }] } })
    result('tell me', false)
    result('tell me about', true)
    result('yourself', false)
    result('yourself please', true, true)

    const partials = events.filter((e) => e.type === 'partial').map((e) => (e as { text: string }).text)
    expect(partials).toContain('tell me')
    expect(partials).toContain('tell me about yourself')
    const finals = events.filter((e) => e.type === 'final')
    expect(finals).toHaveLength(1)
    expect((finals[0] as Extract<SttEvent, { type: 'final' }>).line.text).toBe('tell me about yourself please')
    await s.close()
    vi.unstubAllGlobals()
  })
})
