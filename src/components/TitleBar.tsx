import type { CaptureStatus } from '../shared/capture'
import { captureLabel } from './captureLabels'
import { CloseIcon, EyeOffIcon, GearIcon, HistoryIcon, MinusIcon } from './icons'

export type View = 'main' | 'settings' | 'history'

interface Props {
  capture: CaptureStatus | null
  view: View
  onView(v: View): void
}

export function TitleBar({ capture, view, onView }: Props) {
  const label = captureLabel(capture)
  const toggle = (v: View) => onView(view === v ? 'main' : v)
  return (
    <header className="titlebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <span className="brand-name">Nexus AI</span>
      </div>
      <span className={`capture-pill tone-${label.tone}`} title={capture?.detail ?? ''}>
        <span className="dot" />
        {label.text}
      </span>
      <div className="window-buttons">
        <button
          className={`icon-btn ${view === 'history' ? 'active' : ''}`}
          onClick={() => toggle('history')}
          title="Session history"
          aria-label="Session history"
          aria-pressed={view === 'history'}
        >
          <HistoryIcon />
        </button>
        <button
          className={`icon-btn ${view === 'settings' ? 'active' : ''}`}
          onClick={() => toggle('settings')}
          title="Settings"
          aria-label="Settings"
          aria-pressed={view === 'settings'}
        >
          <GearIcon />
        </button>
        <button className="icon-btn" onClick={() => window.nexus.hideWindow()} title="Hide (use the shortcut or tray to show)" aria-label="Hide">
          <EyeOffIcon />
        </button>
        <button className="icon-btn" onClick={() => window.nexus.minimizeWindow()} title="Minimize" aria-label="Minimize">
          <MinusIcon />
        </button>
        <button className="icon-btn danger" onClick={() => window.nexus.closeWindow()} title="Quit" aria-label="Quit">
          <CloseIcon />
        </button>
      </div>
    </header>
  )
}
