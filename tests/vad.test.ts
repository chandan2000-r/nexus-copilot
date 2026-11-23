import { describe, expect, it } from 'vitest'
import { VadSegmenter, type Segment } from '../src/services/stt/vad'

const RATE = 16_000
let seed = 1
const noise = (ms: number, amp = 0.002) =>
  Int16Array.from({ length: (RATE * ms) / 1000 }, () => {
    seed = (seed * 16807) % 2147483647
    return Math.round(((seed / 2147483647) * 2 - 1) * amp * 32767)
  })
const voice = (ms: number, amp = 0.15) =>
  Int16Array.from({ length: (RATE * ms) / 1000 }, (_, i) => Math.round(amp * 32767 * Math.sin((2 * Math.PI * 220 * i) / RATE) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / RATE))))

function run(parts: Int16Array[], chunk = 1365, opts = {}) {
  const segments: Segment[] = []
  const speech: boolean[] = []
  const vad = new VadSegmenter({ onSegment: (s) => segments.push(s), onSpeech: (v) => speech.push(v) }, opts)
  const all = new Int16Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) all.set(p, off), (off += p.length)
  for (let i = 0; i < all.length; i += chunk) vad.push(all.subarray(i, i + chunk))
  vad.flush()
  return { segments, speech }
}

describe('VadSegmenter', () => {
  it('finds two utterances separated by a pause', () => {
    const { segments, speech } = run([noise(1000), voice(1200), noise(1000), voice(800), noise(1000)])
    expect(segments).toHaveLength(2)
    expect(speech).toEqual([true, false, true, false])
    // First utterance starts ~1.0 s in (minus the pre-roll), lasts about 1.2 s plus padding.
    expect(segments[0].startSample / RATE).toBeGreaterThan(0.6)
    expect(segments[0].startSample / RATE).toBeLessThan(1.05)
    expect(segments[0].pcm.length / RATE).toBeGreaterThan(1.2)
    expect(segments[0].pcm.length / RATE).toBeLessThan(1.9)
    expect(segments[1].startSample / RATE).toBeGreaterThan(2.8)
  })

  it('ignores clicks shorter than the minimum speech length', () => {
    const { segments } = run([noise(800), voice(100), noise(1500)])
    expect(segments).toHaveLength(0)
  })

  it('keeps one utterance through a short mid-sentence pause', () => {
    const { segments } = run([noise(600), voice(700), noise(300), voice(700), noise(1200)])
    expect(segments).toHaveLength(1)
  })

  it('cuts very long monologues into pieces', () => {
    const { segments } = run([noise(500), voice(9000), noise(1000)], 1600, { maxSegmentMs: 4000 })
    expect(segments.length).toBeGreaterThanOrEqual(3)
  })

  it('emits a pending utterance on flush', () => {
    const { segments } = run([noise(500), voice(1000)])
    expect(segments).toHaveLength(1)
  })
})
