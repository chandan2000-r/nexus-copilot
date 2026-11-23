/** Pure audio helpers shared by the renderer (capture) and main process (segmenting, upload). */

export const STT_SAMPLE_RATE = 16_000

/**
 * Returns a stateful downsampler from `inRate` float samples to 16-bit PCM at `outRate`.
 * Each output sample is the mean of the input samples it covers (a cheap low-pass), and
 * the fractional position is carried across chunks so long sessions do not drift.
 */
export function createDownsampler(inRate: number, outRate = STT_SAMPLE_RATE): (input: Float32Array) => Int16Array {
  const ratio = inRate / outRate
  let carry = new Float32Array(0)
  let phase = 0
  return (input) => {
    const buf = new Float32Array(carry.length + input.length)
    buf.set(carry)
    buf.set(input, carry.length)
    if (ratio <= 1) {
      carry = new Float32Array(0)
      return floatToInt16(buf)
    }
    const nOut = Math.max(0, Math.floor((buf.length - phase) / ratio))
    const out = new Int16Array(nOut)
    for (let i = 0; i < nOut; i++) {
      const start = Math.floor(phase + i * ratio)
      const end = Math.min(buf.length, Math.max(start + 1, Math.floor(phase + (i + 1) * ratio)))
      let sum = 0
      for (let j = start; j < end; j++) sum += buf[j]
      out[i] = toInt16(sum / (end - start))
    }
    const consumed = phase + nOut * ratio
    const keepFrom = Math.floor(consumed)
    phase = consumed - keepFrom
    carry = buf.slice(keepFrom)
    return out
  }
}

function toInt16(x: number): number {
  const c = Math.max(-1, Math.min(1, x))
  return c < 0 ? Math.round(c * 0x8000) : Math.round(c * 0x7fff)
}

export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) out[i] = toInt16(input[i])
  return out
}

/** Root-mean-square level of 16-bit PCM, normalised to 0…1. */
export function rms(pcm: Int16Array, from = 0, to = pcm.length): number {
  if (to <= from) return 0
  let sum = 0
  for (let i = from; i < to; i++) sum += pcm[i] * pcm[i]
  return Math.sqrt(sum / (to - from)) / 32768
}

/** Wraps mono 16-bit PCM in a WAV container. */
export function encodeWav(pcm: Int16Array, sampleRate = STT_SAMPLE_RATE): Uint8Array {
  const dataBytes = pcm.length * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true) // PCM chunk size
  v.setUint16(20, 1, true) // PCM format
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  v.setUint32(40, dataBytes, true)
  new Int16Array(buf, 44).set(pcm)
  return new Uint8Array(buf)
}

/** Accepts whatever Electron IPC delivered (ArrayBuffer or a typed-array view) as Int16 PCM. */
export function asInt16(data: ArrayBuffer | ArrayBufferView): Int16Array {
  if (data instanceof ArrayBuffer) return new Int16Array(data.slice(0, data.byteLength - (data.byteLength % 2)))
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength - (data.byteLength % 2))
  return new Int16Array(bytes.slice().buffer)
}
