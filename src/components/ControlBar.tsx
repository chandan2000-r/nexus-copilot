import { useEffect, useState } from 'react'
import { MODE_LABELS } from '../services/copilot/prompts'
import type { Copilot } from '../services/useCopilot'
import type { Speaker } from '../shared/copilot'
import type { CopilotMode, Settings } from '../shared/settings'
import { BoltIcon, MicIcon, PlusIcon, SpeakerIcon } from './icons'

function elapsed(since: number): string {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function Timer({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="timer">{elapsed(since)}</span>
}

function SourceChip({ source, settings, copilot }: { source: Speaker; settings: Settings; copilot: Copilot }) {
  const enabled = source === 'them' ? settings.stt.captureThem : settings.stt.captureYou
  const on = copilot.active[source]
  const level = copilot.levels[source]
  const Icon = source === 'them' ? SpeakerIcon : MicIcon
  const label = source === 'them' ? 'Them' : 'You'
  const hint =
    source === 'them'
      ? 'Transcribe the other side of the call (system audio)'
      : 'Transcribe your microphone (use headphones to avoid echo)'
  return (
    <button
      className={`chip source ${enabled ? 'on' : ''} ${copilot.speaking[source] ? 'speaking' : ''}`}
      onClick={() => void copilot.setSourceEnabled(source, !enabled)}
      title={`${hint}. Click to turn ${enabled ? 'off' : 'on'}.`}
      aria-pressed={enabled}
    >
      <Icon width={13} height={13} />
      {label}
      {on && (
        <span className="meter" aria-hidden>
          <span style={{ transform: `scaleX(${Math.max(0.04, level)})` }} />
        </span>
      )}
    </button>
  )
}

export function ControlBar({ settings, copilot }: { settings: Settings; copilot: Copilot }) {
  const update = (patch: Parameters<typeof window.nexus.updateSettings>[0]) => void window.nexus.updateSettings(patch)
  return (
    <div className="controlbar">
      <button
        className={`listen-btn ${copilot.listening ? 'live' : ''}`}
        onClick={copilot.toggleListening}
        title={copilot.listening ? 'Stop listening' : 'Start listening'}
      >
        <span className="rec-dot" />
        {copilot.listening && copilot.startedAt ? <Timer since={copilot.startedAt} /> : 'Listen'}
      </button>
      <SourceChip source="them" settings={settings} copilot={copilot} />
      <SourceChip source="you" settings={settings} copilot={copilot} />
      <select
        className="mode-select"
        value={settings.copilot.mode}
        onChange={(e) => update({ copilot: { mode: e.target.value as CopilotMode } })}
        title="What kind of conversation this is"
        aria-label="Mode"
      >
        {(Object.keys(MODE_LABELS) as CopilotMode[]).map((m) => (
          <option key={m} value={m}>
            {MODE_LABELS[m]}
          </option>
        ))}
      </select>
      <button
        className={`chip auto ${settings.copilot.autoAnswer ? 'on' : ''}`}
        onClick={() => update({ copilot: { autoAnswer: !settings.copilot.autoAnswer } })}
        title="Auto-answer: respond as soon as a question is detected"
        aria-pressed={settings.copilot.autoAnswer}
      >
        <BoltIcon width={13} height={13} />
        Auto
      </button>
      <button className="icon-btn small" onClick={copilot.newSession} title="New session (saves the current one)" aria-label="New session">
        <PlusIcon width={15} height={15} />
      </button>
    </div>
  )
}
