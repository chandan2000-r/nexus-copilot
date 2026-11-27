import { useEffect, useRef, useState } from 'react'
import type { CaptureStatus } from '../shared/capture'
import { MIN_OPACITY } from '../shared/settings'
import { nextWindowSize, WINDOW_SIZES, type WindowSize } from '../shared/windowSize'
import { captureLabel } from './captureLabels'
import { CloseIcon, EyeOffIcon, GearIcon, HistoryIcon, MinusIcon, OpacityIcon } from './icons'

export type View = 'main' | 'settings' | 'history'

interface Props {
  capture: CaptureStatus | null
  view: View
  onView(v: View): void
  /** Signed out: only the window buttons are shown. */
  locked?: boolean
  windowSize: WindowSize
  opacity: number
}

const SIZE_LETTER: Record<WindowSize, string> = { small: 'S', medium: 'M', large: 'L', custom: '·' }

/** Opacity button next to the size button: opens a slider that changes the window as you drag. */
function OpacityControl({ opacity }: { opacity: number }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const blur = () => setOpen(false)
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('blur', blur)
    }
  }, [open])
  const pct = Math.round(opacity * 100)
  const set = (v: number) => void window.nexus.updateSettings({ opacity: Math.min(1, Math.max(MIN_OPACITY, v)) })
  return (
    <div className="opacity-control" ref={box}>
      <button
        className={`icon-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`Opacity: ${pct}%`}
        aria-label={`Opacity: ${pct}%`}
        aria-expanded={open}
      >
        <OpacityIcon />
      </button>
      {open && (
        <div className="opacity-pop" role="dialog" aria-label="Window opacity">
          <input
            type="range"
            min={MIN_OPACITY}
            max={1}
            step={0.01}
            value={opacity}
            onChange={(e) => set(Number(e.target.value))}
            aria-label="Window opacity"
            autoFocus
          />
          <output>{pct}%</output>
        </div>
      )}
    </div>
  )
}

export function TitleBar({ capture, view, onView, locked = false, windowSize, opacity }: Props) {
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
      <span className={`capture-pill tone-${label.tone}`} title={capture?.detail ? `${label.text}. ${capture.detail}` : label.text}>
        <span className="dot" />
        <span className="pill-long">{label.text}</span>
        <span className="pill-short">{label.short}</span>
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
        <OpacityControl opacity={opacity} />
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
