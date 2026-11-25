import { useEffect, useState } from 'react'
import { listInputDevices } from '../../renderer/audio/capture'
import type { LocalModelStatus, SecretsStatus } from '../../shared/ipc'
import { LANGUAGES, STT_ENGINES } from '../../shared/providers'
import type { Settings, SettingsPatch, SttEngineId } from '../../shared/settings'
import { KeyField, ModelField, Row, TextField, Toggle } from './fields'

interface Props {
  settings: Settings
  secrets: SecretsStatus | null
  onSecrets(s: SecretsStatus): void
  update(p: SettingsPatch): Promise<unknown>
}

const isMac = navigator.userAgent.includes('Mac')

export function AudioTab({ settings, secrets, onSecrets, update }: Props) {
  const stt = settings.stt
  const meta = STT_ENGINES[stt.engine]
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    void listInputDevices().then(setDevices)
    const onChange = () => void listInputDevices().then(setDevices)
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange)
  }, [])
  const name = (d: MediaDeviceInfo, i: number) => d.label || `Input ${i + 1}`

  return (
    <>
      <h2>Transcription</h2>
      <Row label="Engine">
        <select value={stt.engine} onChange={(e) => update({ stt: { engine: e.target.value as SttEngineId } })}>
          {(Object.keys(STT_ENGINES) as SttEngineId[]).map((id) => (
            <option key={id} value={id}>
              {STT_ENGINES[id].name}
            </option>
          ))}
        </select>
      </Row>
      <p className="section-hint">{meta.hint}</p>
      {stt.engine === 'local' && <LocalModelRow />}
      {stt.engine === 'local' && stt.language !== 'auto' && stt.language !== 'en' && (
        <p className="section-hint warn">This engine understands English only. For other languages choose Deepgram, Whisper API or Gemini.</p>
      )}
      {stt.engine === 'whisper' && (
        <>
          <div className="field-block">
            <div className="field-label">Base URL</div>
            <TextField mono value={stt.whisperBaseUrl} onCommit={(v) => update({ stt: { whisperBaseUrl: v } })} ariaLabel="Transcription base URL" />
          </div>
          <KeyField name="whisper" label="Transcription API key (optional)" status={secrets} onStatus={onSecrets} />
          <ModelField id="whisper" value={stt.whisperModel} suggestions={meta.suggestedModels} onCommit={(v) => update({ stt: { whisperModel: v } })} />
        </>
      )}
      {stt.engine === 'deepgram' && (
        <>
          <KeyField name="deepgram" label="Deepgram API key" status={secrets} onStatus={onSecrets} hint="Get one at https://console.deepgram.com" />
          <ModelField id="deepgram" value={stt.deepgramModel} suggestions={meta.suggestedModels} onCommit={(v) => update({ stt: { deepgramModel: v } })} />
        </>
      )}
      {stt.engine === 'gemini' && (
        <>
          {!secrets?.saved.gemini && <p className="section-hint warn">Add a Gemini API key in the AI tab (choose Google Gemini there to enter it).</p>}
          <ModelField id="gemini-stt" value={stt.geminiModel} suggestions={meta.suggestedModels} onCommit={(v) => update({ stt: { geminiModel: v } })} />
        </>
      )}
      <Row label="Spoken language">
        <select value={stt.language} onChange={(e) => update({ stt: { language: e.target.value } })}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </Row>

      <h2>Sources</h2>
      <Toggle
        label="Them (other side of the call)"
        hint="Zoom, Meet, Teams… whatever plays through your speakers or headphones."
        checked={stt.captureThem}
        onChange={(v) => update({ stt: { captureThem: v } })}
      />
      <Row
        label="Capture from"
        hint={isMac ? 'System audio needs macOS 13+ and Screen & System Audio Recording permission.' : 'System audio uses WASAPI loopback.'}
      >
        <select value={stt.themDevice} onChange={(e) => update({ stt: { themDevice: e.target.value } })}>
          <option value="system">System audio</option>
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {name(d, i)}
            </option>
          ))}
        </select>
      </Row>
      <Toggle
        label="You (microphone)"
        hint="Adds your side to the transcript. Use headphones so the mic does not pick up the other side."
        checked={stt.captureYou}
        onChange={(v) => update({ stt: { captureYou: v } })}
      />
      <Row label="Microphone">
        <select value={stt.micDevice} onChange={(e) => update({ stt: { micDevice: e.target.value } })}>
          <option value="">System default</option>
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {name(d, i)}
            </option>
          ))}
        </select>
      </Row>
      {devices.length > 0 && devices.every((d) => !d.label) && (
        <p className="section-hint">Device names appear after microphone access is granted (start listening with "You" on once).</p>
      )}
    </>
  )
}

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

/** Download state of the on-this-computer speech model, with a button to fetch it ahead of time. */
function LocalModelRow() {
  const [status, setStatus] = useState<LocalModelStatus | null>(null)
  const downloading = status?.state === 'downloading'

  useEffect(() => {
    let alive = true
    const refresh = () => window.nexus.stt.modelStatus().then((s) => alive && setStatus(s), () => {})
    void refresh()
    // Poll while a download runs (it may have been started by "Listen").
    const t = setInterval(refresh, 1_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (!status) return null
  const pct = Math.floor((status.received / Math.max(1, status.total)) * 100)
  return (
    <Row
      label="Speech model"
      hint={
        status.state === 'ready'
          ? `Downloaded (${mb(status.total)}). Works offline.`
          : downloading
            ? `${mb(status.received)} of ${mb(status.total)}. You can keep using the app.`
            : status.state === 'error'
              ? `Download failed: ${status.error}`
              : `Not downloaded yet (${mb(status.total)}). It downloads automatically when you start listening.`
      }
    >
      {status.state === 'ready' ? (
        <span className="test-ok">Ready</span>
      ) : downloading ? (
        <span>{pct}%</span>
      ) : (
        <button className="mini-btn primary" onClick={() => void window.nexus.stt.downloadModel().then(setStatus)}>
          {status.state === 'error' ? 'Try again' : 'Download now'}
        </button>
      )}
    </Row>
  )
}
