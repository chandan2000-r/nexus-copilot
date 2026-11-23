/** Speech-to-text backends. Segment engines get one WAV per utterance; Deepgram streams. */
import type { Speaker, SttEvent } from '../../shared/copilot'
import { apiError, request, trimSlash } from '../ai/http'
import { GEMINI_BASE, geminiRequest } from '../ai/providers/geminiProvider'
import { encodeWav, STT_SAMPLE_RATE } from './audio'
import { VadSegmenter, type Segment, type VadOptions } from './vad'

export type Emit = (e: SttEvent) => void

export interface SttSession {
  write(pcm: Int16Array): void
  close(): Promise<void>
}

export type SegmentTranscriber = (wav: Uint8Array, opts: { prompt: string; signal: AbortSignal }) => Promise<string>

const NON_SPEECH = /^[[(（【].*[\])）】]$/
const HALLUCINATIONS = [
  /^(thank you|thanks)( (so|very) much)?( for watching| for listening)?[.!]*$/i,
  /^(you|bye|okay|so)[.!]*$/i,
  /^[.…\s-]+$/,
  /^(subtitles|captions|transcribed) by\b/i,
  /^♪/,
  /^no (intelligible )?speech( detected)?\.?$/i
]

/** Drops empty output, bracketed sound labels, and the phrases Whisper invents for near-silence. */
export function cleanTranscript(text: string, voicedMs: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || NON_SPEECH.test(t)) return ''
  if (voicedMs < 1500 && HALLUCINATIONS.some((r) => r.test(t))) return ''
  if (/^no (intelligible )?speech/i.test(t)) return ''
  return t
}

export function whisperTranscriber(cfg: {
  baseUrl: string
  apiKey: string | null
  model: string
  language: string
}): SegmentTranscriber {
  const base = trimSlash(cfg.baseUrl)
  return async (wav, { prompt, signal }) => {
    const form = new FormData()
    form.append('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'utterance.wav')
    form.append('model', cfg.model)
    form.append('response_format', 'json')
    if (cfg.language && cfg.language !== 'auto') form.append('language', cfg.language)
    if (prompt) form.append('prompt', prompt)
    const res = await request('the transcription API', `${base}/audio/transcriptions`, {
      method: 'POST',
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      body: form,
      signal
    })
    if (!res.ok) throw await apiError(res, 'Transcription')
    const json = (await res.json()) as { text?: string }
    return json.text ?? ''
  }
}

export function geminiTranscriber(cfg: { apiKey: string; model: string; language: string; baseUrl?: string }): SegmentTranscriber {
  const lang = cfg.language && cfg.language !== 'auto' ? ` The speech is in language code "${cfg.language}".` : ''
  return async (wav, { prompt, signal }) => {
    // Transcription never needs thinking: 'fast' keeps each utterance quick, and an overloaded
    // model falls back to the lighter one instead of dropping what was said.
    const res = await geminiRequest({
      label: 'Gemini transcription',
      base: cfg.baseUrl ?? GEMINI_BASE,
      apiKey: cfg.apiKey,
      model: cfg.model,
      method: 'generateContent',
      speed: 'fast',
      signal,
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'audio/wav', data: Buffer.from(wav).toString('base64') } },
              {
                text:
                  `Transcribe the speech in this audio verbatim, with punctuation.${lang} ` +
                  'Output only the transcript text, nothing else. If there is no intelligible speech, output an empty response.' +
                  (prompt ? `\nFor spelling of names and terms, the conversation so far ended with: "${prompt}"` : '')
              }
            ]
          }
        ],
        generationConfig: { temperature: 0 }
      }
    })
    if (!res.ok) throw await apiError(res, 'Gemini transcription')
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }
    return (json.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('')
  }
}

/** Throttles identical error messages so a bad key does not flood the UI. */
function errorGate(emit: Emit, source: Speaker) {
  let last = ''
  let lastAt = 0
  return (message: string) => {
    const now = Date.now()
    if (message === last && now - lastAt < 15_000) return
    last = message
    lastAt = now
    emit({ type: 'error', source, message })
  }
}

let lineCounter = 0
const lineId = (source: Speaker) => `${source}-${Date.now().toString(36)}-${(lineCounter++).toString(36)}`

/** VAD → one transcription request per utterance. Results are emitted in speaking order. */
export class SegmentedSession implements SttSession {
  private readonly vad: VadSegmenter
  private readonly startedAt = Date.now()
  private readonly abort = new AbortController()
  private readonly fail: (m: string) => void
  private chain: Promise<void> = Promise.resolve()
  private context = ''

  constructor(
    private readonly source: Speaker,
    private readonly transcribe: SegmentTranscriber,
    private readonly emit: Emit,
    vad: Partial<VadOptions> = {}
  ) {
    this.fail = errorGate(emit, source)
    this.vad = new VadSegmenter(
      {
        onSegment: (seg) => this.onSegment(seg),
        onSpeech: (speaking) => this.emit({ type: 'speech', source: this.source, speaking })
      },
      vad
    )
  }

  write(pcm: Int16Array): void {
    this.vad.push(pcm)
  }

  async close(): Promise<void> {
    this.vad.flush()
    await this.chain
    this.abort.abort()
  }

  private onSegment(seg: Segment): void {
    const at = this.startedAt + Math.round((seg.startSample / STT_SAMPLE_RATE) * 1000)
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)])
    const pending = this.transcribe(encodeWav(seg.pcm), { prompt: this.context, signal }).then(
      (text) => cleanTranscript(text, seg.voicedMs),
      (err: Error) => {
        if (!this.abort.signal.aborted) this.fail(err.name === 'TimeoutError' ? 'Transcription timed out.' : err.message)
        return ''
      }
    )
    this.chain = this.chain.then(async () => {
      const text = await pending
      if (!text) return
      this.context = `${this.context} ${text}`.slice(-300).trim()
      this.emit({ type: 'final', source: this.source, line: { id: lineId(this.source), source: this.source, text, at } })
    })
  }
}

interface DeepgramResult {
  type: string
  is_final?: boolean
  speech_final?: boolean
  start?: number
  channel?: { alternatives?: { transcript?: string }[] }
  description?: string
  message?: string
}

/** Deepgram live transcription over WebSocket: interim words while people talk, finals per utterance. */
export class DeepgramSession implements SttSession {
  private ws: WebSocket
  private queue: ArrayBuffer[] = []
  private finals: string[] = []
  private utteranceStart: number | null = null
  private readonly startedAt = Date.now()
  private readonly fail: (m: string) => void
  private keepAlive: NodeJS.Timeout
  private lastSend = Date.now()
  private closing = false
  private speaking = false

  constructor(
    cfg: { apiKey: string; model: string; language: string },
    private readonly source: Speaker,
    private readonly emit: Emit,
    socketFactory: (url: string, protocols: string[]) => WebSocket = (u, p) => new WebSocket(u, p)
  ) {
    this.fail = errorGate(emit, source)
    const params = new URLSearchParams({
      model: cfg.model,
      encoding: 'linear16',
      sample_rate: String(STT_SAMPLE_RATE),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: '400',
      utterance_end_ms: '1200',
      vad_events: 'true'
    })
    if (cfg.language && cfg.language !== 'auto') params.set('language', cfg.language)
    else if (cfg.model.startsWith('nova-3')) params.set('language', 'multi')
    this.ws = socketFactory(`wss://api.deepgram.com/v1/listen?${params}`, ['token', cfg.apiKey])
    this.ws.binaryType = 'arraybuffer'
    this.ws.onopen = () => {
      for (const chunk of this.queue) this.ws.send(chunk)
      this.queue = []
    }
    this.ws.onmessage = (ev) => this.onMessage(String(ev.data))
    this.ws.onerror = () => {
      if (!this.closing) this.fail('Deepgram connection failed. Check the Deepgram API key and your network.')
    }
    this.ws.onclose = (ev) => {
      clearInterval(this.keepAlive)
      if (!this.closing && ev.code !== 1000) {
        this.fail(`Deepgram closed the connection (${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`)
      }
    }
    this.keepAlive = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN && Date.now() - this.lastSend > 5_000) {
        this.ws.send(JSON.stringify({ type: 'KeepAlive' }))
      }
    }, 5_000)
  }

  write(pcm: Int16Array): void {
    const chunk = pcm.slice().buffer
    this.lastSend = Date.now()
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(chunk)
    else if (this.ws.readyState === WebSocket.CONNECTING && this.queue.length < 600) this.queue.push(chunk)
  }

  async close(): Promise<void> {
    this.closing = true
    clearInterval(this.keepAlive)
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }))
      // Give Deepgram a moment to return the last final result.
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 1_500)
        this.ws.addEventListener('close', () => {
          clearTimeout(t)
          resolve()
        })
      })
    }
    this.flushUtterance()
    try {
      this.ws.close(1000)
    } catch {
      /* already closed */
    }
  }

  private setSpeaking(speaking: boolean): void {
    if (speaking === this.speaking) return
    this.speaking = speaking
    this.emit({ type: 'speech', source: this.source, speaking })
  }

  private onMessage(raw: string): void {
    let msg: DeepgramResult
    try {
      msg = JSON.parse(raw) as DeepgramResult
    } catch {
      return
    }
    if (msg.type === 'SpeechStarted') return this.setSpeaking(true)
    if (msg.type === 'UtteranceEnd') return this.flushUtterance()
    if (msg.type === 'Error') return this.fail(`Deepgram: ${msg.description ?? msg.message ?? 'error'}`)
    if (msg.type !== 'Results') return

    const text = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? ''
    if (text && this.utteranceStart === null) this.utteranceStart = msg.start ?? 0
    if (msg.is_final) {
      if (text) this.finals.push(text)
      if (msg.speech_final) this.flushUtterance()
      else if (this.finals.length) this.emit({ type: 'partial', source: this.source, text: this.finals.join(' ') })
    } else if (text) {
      this.setSpeaking(true)
      this.emit({ type: 'partial', source: this.source, text: [...this.finals, text].join(' ') })
    }
  }

  private flushUtterance(): void {
    const text = this.finals.join(' ').trim()
    const start = this.utteranceStart ?? 0
    this.finals = []
    this.utteranceStart = null
    this.emit({ type: 'partial', source: this.source, text: '' })
    this.setSpeaking(false)
    if (!text) return
    this.emit({
      type: 'final',
      source: this.source,
      line: { id: lineId(this.source), source: this.source, text, at: this.startedAt + Math.round(start * 1000) }
    })
  }
}
