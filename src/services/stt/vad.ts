import { rms, STT_SAMPLE_RATE } from './audio'

export interface VadOptions {
  sampleRate: number
  frameMs: number
  /** Consecutive voiced frames needed to start an utterance. */
  startFrames: number
  /** Silence that ends an utterance. */
  silenceMs: number
  /** Utterances longer than this are cut so transcripts keep flowing during monologues. */
  maxSegmentMs: number
  /** Utterances with less voiced audio than this are dropped (clicks, coughs). */
  minSpeechMs: number
  /** Audio kept from before speech was detected, so first syllables are not clipped. */
  prerollMs: number
  /** Lowest level (normalised RMS) that can count as speech. */
  minThreshold: number
}

export const DEFAULT_VAD: VadOptions = {
  sampleRate: STT_SAMPLE_RATE,
  frameMs: 20,
  startFrames: 3,
  silenceMs: 750,
  maxSegmentMs: 20_000,
  minSpeechMs: 300,
  prerollMs: 300,
  minThreshold: 0.006
}

export interface Segment {
  pcm: Int16Array
  /** Sample index (from the start of the stream) where the segment begins. */
  startSample: number
  voicedMs: number
}

export interface VadHandlers {
  onSegment(seg: Segment): void
  onSpeech(speaking: boolean): void
}

/**
 * Energy-based voice-activity segmenter. Splits a live 16 kHz PCM stream into utterances
 * using an adaptive noise floor with hysteresis. Cheap, dependency-free, and good enough to
 * decide when to send audio to a transcription API.
 */
export class VadSegmenter {
  private readonly o: VadOptions
  private readonly frameLen: number
  private pending = new Int16Array(0)
  private total = 0
  private floor = 0.003
  private speaking = false
  private voicedRun = 0
  private preroll: Int16Array[] = []
  private frames: Int16Array[] = []
  private segStart = 0
  private voicedFrames = 0
  private silenceRun = 0

  constructor(
    private readonly handlers: VadHandlers,
    options: Partial<VadOptions> = {}
  ) {
    this.o = { ...DEFAULT_VAD, ...options }
    this.frameLen = Math.round((this.o.sampleRate * this.o.frameMs) / 1000)
  }

  push(pcm: Int16Array): void {
    let buf = pcm
    if (this.pending.length) {
      buf = new Int16Array(this.pending.length + pcm.length)
      buf.set(this.pending)
      buf.set(pcm, this.pending.length)
    }
    let off = 0
    while (off + this.frameLen <= buf.length) {
      this.frame(buf.slice(off, off + this.frameLen))
      off += this.frameLen
    }
    this.pending = buf.slice(off)
  }

  /** True while an utterance is in progress. */
  get active(): boolean {
    return this.speaking
  }

  /** Audio of the utterance in progress so far (for live previews), or null between utterances. */
  current(): { pcm: Int16Array; voicedMs: number } | null {
    if (!this.speaking || this.frames.length === 0) return null
    return { pcm: concat(this.frames), voicedMs: this.voicedFrames * this.o.frameMs }
  }

  /** Ends any utterance in progress (used when listening stops). */
  flush(): void {
    if (this.speaking) this.end()
    this.pending = new Int16Array(0)
  }

  private get startThreshold(): number {
    return Math.max(this.o.minThreshold, this.floor * 3)
  }

  private get continueThreshold(): number {
    return Math.max(this.o.minThreshold * 0.6, this.floor * 2)
  }

  private frame(f: Int16Array): void {
    const level = rms(f)
    const frameStart = this.total
    this.total += f.length

    if (!this.speaking) {
      const voiced = level > this.startThreshold
      this.voicedRun = voiced ? this.voicedRun + 1 : 0
      if (!voiced) this.floor = Math.min(0.05, Math.max(0.0005, this.floor * 0.98 + level * 0.02))
      this.preroll.push(f)
      const maxPreroll = Math.max(this.o.startFrames, Math.round(this.o.prerollMs / this.o.frameMs))
      if (this.preroll.length > maxPreroll) this.preroll.shift()
      if (this.voicedRun >= this.o.startFrames) {
        this.speaking = true
        this.frames = this.preroll
        this.preroll = []
        this.segStart = frameStart + f.length - this.frames.reduce((n, x) => n + x.length, 0)
        this.voicedFrames = this.voicedRun
        this.silenceRun = 0
        this.handlers.onSpeech(true)
      }
      return
    }

    this.frames.push(f)
    if (level > this.continueThreshold) {
      this.voicedFrames++
      this.silenceRun = 0
    } else {
      this.silenceRun++
    }

    if (this.silenceRun * this.o.frameMs >= this.o.silenceMs) {
      this.end()
    } else if (this.frames.length * this.o.frameMs >= this.o.maxSegmentMs) {
      // Long monologue: hand over what we have and keep listening.
      this.emit()
      this.segStart = this.total
      this.frames = []
      this.voicedFrames = 0
      this.silenceRun = 0
    }
  }

  private end(): void {
    // Keep ~200 ms of the trailing silence; drop the rest.
    const keepSilence = Math.round(200 / this.o.frameMs)
    const drop = Math.max(0, this.silenceRun - keepSilence)
    if (drop) this.frames = this.frames.slice(0, this.frames.length - drop)
    this.emit()
    this.speaking = false
    this.voicedRun = 0
    this.frames = []
    this.preroll = []
    this.silenceRun = 0
    this.handlers.onSpeech(false)
  }

  private emit(): void {
    const voicedMs = this.voicedFrames * this.o.frameMs
    if (voicedMs < this.o.minSpeechMs || this.frames.length === 0) return
    this.handlers.onSegment({ pcm: concat(this.frames), startSample: this.segStart, voicedMs })
  }
}

function concat(frames: Int16Array[]): Int16Array {
  const pcm = new Int16Array(frames.reduce((n, x) => n + x.length, 0))
  let off = 0
  for (const x of frames) {
    pcm.set(x, off)
    off += x.length
  }
  return pcm
}
