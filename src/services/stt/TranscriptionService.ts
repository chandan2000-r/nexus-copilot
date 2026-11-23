import type { Speaker, SttEvent } from '../../shared/copilot'
import type { SttStartResult } from '../../shared/ipc'
import { STT_ENGINES } from '../../shared/providers'
import type { Settings } from '../../shared/settings'
import type { SecretLookup } from '../ai/registry'
import { DeepgramSession, geminiTranscriber, SegmentedSession, whisperTranscriber, type SttSession } from './engines'

/** One transcription session per audio source ('them' = system audio, 'you' = microphone). */
export class TranscriptionService {
  private sessions = new Map<Speaker, SttSession>()

  constructor(
    private readonly settings: () => Settings,
    private readonly secret: SecretLookup,
    private readonly emit: (e: SttEvent) => void
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
    const meta = STT_ENGINES[stt.engine]
    switch (stt.engine) {
      case 'whisper': {
        const key = this.secret('whisper') ?? this.secret('openai')
        if (!key && /(^|\.)openai\.com/.test(stt.whisperBaseUrl)) {
          throw new Error('Add an OpenAI API key (AI tab) or a transcription key (Audio tab) in Settings.')
        }
        return new SegmentedSession(
          source,
          whisperTranscriber({ baseUrl: stt.whisperBaseUrl, apiKey: key, model: stt.whisperModel, language: stt.language }),
          this.emit
        )
      }
      case 'gemini': {
        const key = this.secret('gemini')
        if (!key) throw new Error('Add your Google Gemini API key in Settings → AI to use Gemini transcription.')
        return new SegmentedSession(
          source,
          geminiTranscriber({ apiKey: key, model: stt.geminiModel, language: stt.language }),
          this.emit
        )
      }
      case 'deepgram': {
        const key = this.secret(meta.keyName)
        if (!key) throw new Error('Add your Deepgram API key in Settings → Audio.')
        return new DeepgramSession({ apiKey: key, model: stt.deepgramModel, language: stt.language }, source, this.emit)
      }
    }
  }
}
