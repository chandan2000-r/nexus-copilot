/**
 * Audio capture in the renderer: opens the right MediaStream for each speaker and turns it
 * into 16 kHz mono PCM chunks for the main-process transcription service.
 *
 * 'them' = system audio (getDisplayMedia + loopback, answered by the main process) or a
 *          loopback input device such as BlackHole / VB-Cable.
 * 'you'  = the microphone.
 */
import { createDownsampler } from '../../services/stt/audio'
import type { Speaker } from '../../shared/copilot'

const isMac = navigator.userAgent.includes('Mac')

export class AudioPump {
  private readonly ctx: AudioContext
  private readonly src: MediaStreamAudioSourceNode
  private readonly node: ScriptProcessorNode
  private readonly mute: GainNode
  private stopped = false

  constructor(
    private readonly stream: MediaStream,
    onPcm: (pcm: Int16Array) => void,
    onLevel: (level: number) => void,
    onEnded: () => void
  ) {
    this.ctx = new AudioContext()
    const downsample = createDownsampler(this.ctx.sampleRate)
    this.src = this.ctx.createMediaStreamSource(stream)
    // ScriptProcessorNode is deprecated but needs no worklet module, which keeps the CSP
    // strict and works from file:// in packaged builds. ~43 ms per callback at 48 kHz, so the
    // end of speech is noticed sooner.
    this.node = this.ctx.createScriptProcessor(2048, 1, 1)
    this.mute = this.ctx.createGain()
    this.mute.gain.value = 0 // must reach the destination to run, but must not play back
    let lastLevelAt = 0
    let level = 0
    this.node.onaudioprocess = (ev) => {
      if (this.stopped) return
      const input = ev.inputBuffer.getChannelData(0)
      const pcm = downsample(input)
      if (pcm.length) onPcm(pcm)
      let sum = 0
      for (let i = 0; i < input.length; i += 4) sum += input[i] * input[i]
      level = Math.max(Math.sqrt(sum / (input.length / 4)), level * 0.7)
      const now = performance.now()
      if (now - lastLevelAt > 120) {
        lastLevelAt = now
        onLevel(Math.min(1, level * 4))
      }
    }
    this.src.connect(this.node)
    this.node.connect(this.mute)
    this.mute.connect(this.ctx.destination)
    for (const t of stream.getAudioTracks()) t.addEventListener('ended', () => !this.stopped && onEnded())
    void this.ctx.resume()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.node.onaudioprocess = null
    try {
      this.src.disconnect()
      this.node.disconnect()
      this.mute.disconnect()
    } catch {
      /* already disconnected */
    }
    for (const t of this.stream.getTracks()) t.stop()
    void this.ctx.close()
  }
}

function describe(err: unknown, source: Speaker): string {
  const e = err as DOMException
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
    if (source === 'them') {
      return isMac
        ? 'System audio needs permission: System Settings → Privacy & Security → Screen & System Audio Recording → allow Nexus AI, then restart the app.'
        : 'System audio capture was blocked.'
    }
    return isMac
      ? 'Microphone access is off: System Settings → Privacy & Security → Microphone → allow Nexus AI.'
      : 'Microphone access was blocked. Check Windows Settings → Privacy → Microphone.'
  }
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') {
    return source === 'them'
      ? 'The selected input device for "Them" was not found. Pick another one in Settings → Audio.'
      : 'Microphone not found. Pick another one in Settings → Audio.'
  }
  if (e?.name === 'NotReadableError') return 'The audio device is busy or unavailable.'
  return (e as Error)?.message || String(err)
}

async function systemAudio(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
  for (const t of display.getVideoTracks()) {
    t.stop()
    display.removeTrack(t)
  }
  const audio = display.getAudioTracks()
  if (!audio.length) {
    throw new Error(
      isMac
        ? 'This macOS version did not provide system audio (needs macOS 13 or later). Install a loopback device such as BlackHole and choose it for "Them" in Settings → Audio.'
        : 'System audio is not available. Choose a loopback input device for "Them" in Settings → Audio.'
    )
  }
  return new MediaStream(audio)
}

export async function openSource(source: Speaker, device: string): Promise<MediaStream> {
  try {
    if (source === 'them') {
      if (device === 'system') return await systemAudio()
      return await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: device }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      })
    }
    const access = await window.nexus.media.requestMicAccess()
    if (!access.granted) throw new DOMException('denied', 'NotAllowedError')
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(device ? { deviceId: { exact: device } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
  } catch (err) {
    throw new Error(describe(err, source))
  }
}

export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
  } catch {
    return []
  }
}
