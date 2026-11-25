/**
 * Speech recognition on this computer: NVIDIA Parakeet TDT 0.6B v2 (int8) run by sherpa-onnx.
 *
 * The model (~660 MB) is downloaded once into the app's data folder and checked against known
 * SHA-256 hashes. Decoding runs on sherpa-onnx's own threads (decodeOfflineStreamAsync), so the
 * main process stays responsive. Finished utterances decode immediately, live previews one at a
 * time in between. On an Apple M1 a spoken question of 2–5 s decodes in about 0.1–0.15 s.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import type { LocalModelStatus } from '../../shared/ipc'
import { STT_SAMPLE_RATE } from './audio'

export interface ModelFile {
  name: string
  bytes: number
  sha256: string
}

export interface ModelSpec {
  id: string
  /** Base URL the files are downloaded from (`${url}/${file.name}`). */
  url: string
  files: ModelFile[]
}

export const PARAKEET_MODEL: ModelSpec = {
  id: 'parakeet-tdt-0.6b-v2-int8',
  url: 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main',
  files: [
    { name: 'tokens.txt', bytes: 9_384, sha256: 'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d' },
    { name: 'joiner.int8.onnx', bytes: 1_739_080, sha256: '77a29f3e5ac7d37074e0af465391b80f314015d5b97f0f90c6c7767f1d56f428' },
    { name: 'decoder.int8.onnx', bytes: 7_257_753, sha256: '4d097bae3bac5c96018d5293ba39f1b657296102b142affda40378f38b020f41' },
    { name: 'encoder.int8.onnx', bytes: 652_282_309, sha256: '92a10bd9c23936ea0566c29f963bc57c2a5df4261b6a8921c39abea66557ca8b' }
  ]
}

/** The parts of the sherpa-onnx Node addon this app uses. */
export interface SherpaAddon {
  createOfflineRecognizerAsync(config: object): Promise<unknown>
  createOfflineStream(recognizer: unknown): unknown
  acceptWaveformOffline(stream: unknown, wave: { samples: Float32Array; sampleRate: number }): void
  decodeOfflineStreamAsync(recognizer: unknown, stream: unknown): Promise<string>
}

export interface TranscribeOptions {
  /** Live preview of an unfinished utterance: waits behind finished ones. */
  partial?: boolean
  signal?: AbortSignal
}

interface Job extends TranscribeOptions {
  pcm: Int16Array
  resolve(text: string): void
  reject(err: Error): void
}

/**
 * Decodes PCM with a loaded recognizer. Finished utterances start at once (decoding separate
 * streams in parallel is safe and gives identical results); live previews run one at a time and
 * only while no finished utterance is decoding, so a final line never waits behind a preview.
 */
export class LocalRecognizer {
  private previews: Job[] = []
  private previewRunning = false
  private finalsRunning = 0

  constructor(
    private readonly addon: SherpaAddon,
    private readonly handle: unknown
  ) {}

  transcribe(pcm: Int16Array, opts: TranscribeOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const job: Job = { ...opts, pcm, resolve, reject }
      if (job.partial) {
        this.previews.push(job)
        this.next()
      } else void this.run(job)
    })
  }

  private next(): void {
    if (this.previewRunning || this.finalsRunning > 0) return
    const job = this.previews.shift()
    if (job) void this.run(job)
  }

  private async run(job: Job): Promise<void> {
    if (job.signal?.aborted) {
      job.reject(new DOMException('Transcription was cancelled.', 'AbortError'))
      return this.next()
    }
    if (job.partial) this.previewRunning = true
    else this.finalsRunning++
    try {
      const stream = this.addon.createOfflineStream(this.handle)
      this.addon.acceptWaveformOffline(stream, { samples: toFloat32(job.pcm), sampleRate: STT_SAMPLE_RATE })
      const json = await this.addon.decodeOfflineStreamAsync(this.handle, stream)
      job.resolve(String((JSON.parse(json) as { text?: unknown }).text ?? '').trim())
    } catch (err) {
      job.reject(err instanceof Error ? err : new Error(String(err)))
    } finally {
      if (job.partial) this.previewRunning = false
      else this.finalsRunning--
      this.next()
    }
  }
}

export function toFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

const MB = 1024 * 1024
export const formatMb = (bytes: number) => `${Math.round(bytes / MB)} MB`

/** Downloads, verifies and loads the speech model. One instance per app. */
export class LocalSpeechModel {
  private download: Promise<void> | null = null
  /** Set before the download's first progress report (which runs before `download` is assigned). */
  private downloading = false
  private received = 0
  private lastError: string | null = null
  private readonly listeners = new Set<(s: LocalModelStatus) => void>()
  private lastNotify = 0
  private recognizerP: Promise<LocalRecognizer> | null = null

  constructor(
    readonly dir: string,
    private readonly loadAddon: () => SherpaAddon,
    private readonly spec: ModelSpec = PARAKEET_MODEL,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a)
  ) {}

  get total(): number {
    return this.spec.files.reduce((n, f) => n + f.bytes, 0)
  }

  private fileReady(f: ModelFile): boolean {
    try {
      return statSync(join(this.dir, f.name)).size === f.bytes
    } catch {
      return false
    }
  }

  /** All model files are on disk (sizes checked; hashes were checked when they were downloaded). */
  isOnDisk(): boolean {
    return this.spec.files.every((f) => this.fileReady(f))
  }

  status(): LocalModelStatus {
    const total = this.total
    if (this.downloading) return { state: 'downloading', received: this.received, total }
    if (this.isOnDisk()) return { state: 'ready', received: total, total }
    const onDisk = this.spec.files.filter((f) => this.fileReady(f)).reduce((n, f) => n + f.bytes, 0)
    return this.lastError ? { state: 'error', received: onDisk, total, error: this.lastError } : { state: 'missing', received: onDisk, total }
  }

  /** Downloads whatever is missing. Concurrent callers share one download. */
  ensure(onProgress?: (s: LocalModelStatus) => void): Promise<void> {
    if (!this.download && this.isOnDisk()) return Promise.resolve()
    if (onProgress) this.listeners.add(onProgress)
    if (!this.download) {
      this.lastError = null
      this.downloading = true
      this.download = this.fetchAll().then(
        () => {
          this.download = null
          this.downloading = false
          this.notify(true)
        },
        (err: Error) => {
          this.download = null
          this.downloading = false
          this.lastError = err.message
          this.notify(true)
          throw err
        }
      )
    }
    const p = this.download
    p.then(
      () => onProgress && this.listeners.delete(onProgress),
      () => onProgress && this.listeners.delete(onProgress)
    )
    return p
  }

  /** The loaded recognizer (downloads the model first if needed). Loading takes ~1.5 s. */
  recognizer(): Promise<LocalRecognizer> {
    this.recognizerP ??= this.load().catch((err: Error) => {
      this.recognizerP = null
      throw err
    })
    return this.recognizerP
  }

  private async load(): Promise<LocalRecognizer> {
    await this.ensure()
    let addon: SherpaAddon
    try {
      addon = this.loadAddon()
    } catch (err) {
      throw new Error(`Speech recognition on this computer could not start: ${(err as Error).message}`)
    }
    const f = (name: string) => join(this.dir, name)
    const handle = await addon.createOfflineRecognizerAsync({
      featConfig: { sampleRate: STT_SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: f('encoder.int8.onnx'), decoder: f('decoder.int8.onnx'), joiner: f('joiner.int8.onnx') },
        tokens: f('tokens.txt'),
        // 4 threads measured ~25% faster than 2 on an M1; leave cores for the app and a local LLM.
        numThreads: Math.max(1, Math.min(4, Math.floor(cpus().length / 2))),
        provider: 'cpu',
        debug: 0,
        modelType: 'nemo_transducer'
      },
      decodingMethod: 'greedy_search'
    })
    return new LocalRecognizer(addon, handle)
  }

  private notify(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastNotify < 250) return
    this.lastNotify = now
    const s = this.status()
    for (const l of this.listeners) l(s)
  }

  private async fetchAll(): Promise<void> {
    mkdirSync(this.dir, { recursive: true })
    this.received = this.spec.files.filter((f) => this.fileReady(f)).reduce((n, f) => n + f.bytes, 0)
    this.notify(true)
    for (const f of this.spec.files) {
      if (!this.fileReady(f)) await this.fetchFile(f)
    }
  }

  private async fetchFile(f: ModelFile): Promise<void> {
    const part = join(this.dir, `${f.name}.part`)
    let got = 0
    try {
      const res = await this.fetchFn(`${this.spec.url}/${f.name}`, { signal: AbortSignal.timeout(30 * 60_000) })
      if (!res.ok || !res.body) throw new Error(`the server answered ${res.status}`)
      const hash = createHash('sha256')
      const out = createWriteStream(part)
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          hash.update(chunk)
          got += chunk.length
          this.received += chunk.length
          if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()))
          this.notify()
        }
        out.end()
        await finished(out)
      } catch (err) {
        out.destroy()
        throw err
      }
      if (got !== f.bytes || hash.digest('hex') !== f.sha256) throw new Error(`${f.name} arrived incomplete or damaged`)
      renameSync(part, join(this.dir, f.name))
    } catch (err) {
      this.received -= got
      if (existsSync(part)) rmSync(part, { force: true })
      const e = err as Error
      throw new Error(e.name === 'TimeoutError' ? 'the download timed out' : e.message || String(err))
    }
  }
}
