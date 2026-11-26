import type { CaptureStatus } from '../shared/capture'
import { nextWindowSize, WINDOW_SIZES, type WindowSize } from '../shared/windowSize'
import { captureLabel } from './captureLabels'
import { CloseIcon, EyeOffIcon, GearIcon, HistoryIcon, MinusIcon } from './icons'

export type View = 'main' | 'settings' | 'history'

interface Props {
  capture: CaptureStatus | null
  view: View
  onView(v: View): void
  /** Signed out: only the window buttons are shown. */
  locked?: boolean
  windowSize: WindowSize
}

const SIZE_LETTER: Record<WindowSize, string> = { small: 'S', medium: 'M', large: 'L', custom: '·' }

export function TitleBar({ capture, view, onView, locked = false, windowSize }: Props) {
  const label = captureLabel(capture)
  const toggle = (v: View) => onView(view === v ? 'main' : v)
  const nextSize = nextWindowSize(windowSize, window.innerWidth)
  const sizeTitle = `Window size: ${windowSize === 'custom' ? 'custom' : WINDOW_SIZES[windowSize].label}. Click for ${WINDOW_SIZES[nextSize].label}.`
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
        {!locked && (
          <>
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
          </>
        )}
        <button
          className="icon-btn size-btn"
          onClick={() => window.nexus.updateSettings({ windowSize: nextWindowSize(windowSize, window.innerWidth) })}
          title={sizeTitle}
          aria-label={sizeTitle}
        >
          <span aria-hidden>{SIZE_LETTER[windowSize]}</span>
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
