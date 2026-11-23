import { describe, expect, it } from 'vitest'
import { asInt16, createDownsampler, encodeWav, rms } from '../src/services/stt/audio'

const sine = (n: number, rate: number, hz: number, amp = 0.5, phase0 = 0) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * hz * ((i + phase0) / rate)))

describe('createDownsampler', () => {
  it('turns 48 kHz into 16 kHz across uneven chunks without drift', () => {
    const ds = createDownsampler(48_000)
    let total = 0
    let fed = 0
    for (const size of [4096, 1000, 333, 4096, 7, 4096]) {
      total += ds(sine(size, 48_000, 440, 0.5, fed)).length
      fed += size
    }
    expect(Math.abs(total - fed / 3)).toBeLessThanOrEqual(1)
  })

  it('handles 44.1 kHz and keeps the signal level', () => {
    const ds = createDownsampler(44_100)
    const out = ds(sine(44_100, 44_100, 300, 0.5))
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(1)
    // RMS of a 0.5 sine is ~0.354
    expect(rms(out)).toBeGreaterThan(0.33)
    expect(rms(out)).toBeLessThan(0.37)
  })

  it('passes through when the rate already matches', () => {
    expect(createDownsampler(16_000)(new Float32Array([0, 1, -1])).length).toBe(3)
  })
})

describe('encodeWav', () => {
  it('writes a valid 16 kHz mono PCM header', () => {
    const wav = encodeWav(new Int16Array([1, -1, 32767]))
    const v = new DataView(wav.buffer)
    const tag = (o: number) => String.fromCharCode(...wav.slice(o, o + 4))
    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(16_000)
    expect(v.getUint32(40, true)).toBe(6)
    expect(v.getInt16(44 + 4, true)).toBe(32767)
    expect(wav.length).toBe(50)
  })
})

describe('asInt16', () => {
  it('accepts ArrayBuffers and views (as Electron IPC may deliver either)', () => {
    const src = new Int16Array([5, -6, 7])
    expect([...asInt16(src.buffer)]).toEqual([5, -6, 7])
    expect([...asInt16(new Uint8Array(src.buffer))]).toEqual([5, -6, 7])
  })
})
