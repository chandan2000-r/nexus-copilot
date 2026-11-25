import type { Speaker, SttEvent } from '../../shared/copilot'
import type { SttStartResult } from '../../shared/ipc'
import type { Settings } from '../../shared/settings'
import type { SecretLookup } from '../ai/registry'
import {
  DeepgramSession,
  GatedSession,
  geminiTranscriber,
  SegmentedSession,
  viaWav,
  whisperTranscriber,
  type SttSession
} from './engines'
import { formatMb, type LocalSpeechModel } from './localModel'

/** How often the on-this-computer engine refreshes the words of the sentence being spoken. */
export const LIVE_PREVIEW_MS = 600
/**
 * Silence that ends a sentence for the on-this-computer engine (cloud engines wait 750 ms).
 * Decoding a sentence costs ~0.1 s here, so splitting a long question in two costs nothing:
 * the lines are joined before answering.
 */
export const LOCAL_END_SILENCE_MS = 550

/** One transcription session per audio source ('them' = system audio, 'you' = microphone). */
export class TranscriptionService {
  private sessions = new Map<Speaker, SttSession>()

  constructor(
    private readonly settings: () => Settings,
    private readonly secret: SecretLookup,
    private readonly emit: (e: SttEvent) => void,
    private readonly local: LocalSpeechModel | null = null
  ) {}

  async start(source: Speaker): Promise<SttStartResult> {
    await this.stop(source)
    try {
      this.sessions.set(source, this.create(source))
      this.emit({ type: 'state', source, state: 'listening' })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  audio(source: Speaker, pcm: Int16Array): void {
    this.sessions.get(source)?.write(pcm)
  }

  async stop(source: Speaker): Promise<void> {
    const s = this.sessions.get(source)
    if (!s) return
    this.sessions.delete(source)
    this.emit({ type: 'state', source, state: 'stopped' })
    await s.close().catch(() => {})
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((s) => this.stop(s)))
  }

  private create(source: Speaker): SttSession {
    const { stt } = this.settings()
    switch (stt.engine) {
      case 'local':
        return this.createLocal(source)
      case 'whisper': {
        const key = this.secret('whisper') ?? this.secret('openai')
        if (!key && /(^|\.)openai\.com/.test(stt.whisperBaseUrl)) {
          throw new Error('Add an OpenAI API key (AI tab) or a transcription key (Audio tab) in Settings.')
        }
        return new SegmentedSession(
          source,
          viaWav(whisperTranscriber({ baseUrl: stt.whisperBaseUrl, apiKey: key, model: stt.whisperModel, language: stt.language })),
          this.emit
        )
      }
      case 'gemini': {
        const key = this.secret('gemini')
        if (!key) throw new Error('Add your Google Gemini API key in Settings → AI to use Gemini transcription.')
        return new SegmentedSession(
          source,
          viaWav(geminiTranscriber({ apiKey: key, model: stt.geminiModel, language: stt.language })),
          this.emit
        )
      }
      case 'deepgram': {
        const key = this.secret('deepgram')
        if (!key) throw new Error('Add your Deepgram API key in Settings → Audio.')
        return new DeepgramSession({ apiKey: key, model: stt.deepgramModel, language: stt.language }, source, this.emit)
      }
    }
  }

  /**
   * NVIDIA Parakeet on this computer. If the model is not downloaded yet, listening starts
   * anyway: the download runs with progress shown to the user, and audio is used once it is done.
   */
  private createLocal(source: Speaker): SttSession {
    const model = this.local
    if (!model) throw new Error('Transcription on this computer is not available in this build. Choose another engine in Settings → Audio.')
    const session = new SegmentedSession(
      source,
      (pcm, o) => model.recognizer().then((r) => r.transcribe(pcm, { partial: o.partial, signal: o.signal })),
      this.emit,
      { partialEveryMs: LIVE_PREVIEW_MS, vad: { silenceMs: LOCAL_END_SILENCE_MS } }
    )
    if (model.isOnDisk()) {
      // Load now (~1.5 s) so the first sentence is not delayed; failures surface on the first utterance.
      model.recognizer().catch(() => {})
      return session
    }
    const size = formatMb(model.total)
    const ready = model
      .ensure((s) => {
        if (s.state !== 'downloading') return
        const pct = Math.floor((s.received / s.total) * 100)
        this.emit({ type: 'status', source, message: `Downloading the speech model (one time, ${size}): ${pct}%` })
      })
      .then(async () => {
        this.emit({ type: 'status', source, message: 'Speech model downloaded. Starting…' })
        await model.recognizer()
        this.emit({ type: 'status', source, message: null })
      })
    ready.catch((err: Error) => {
      this.emit({ type: 'status', source, message: null })
      this.emit({
        type: 'error',
        source,
        message: `Could not download the speech model: ${err.message}. Check your internet connection, then stop and start listening to try again.`
      })
    })
    return new GatedSession(session, ready)
  }
}
