import { useCallback, useEffect, useState } from 'react'
import type { CaptureStatus } from '../../shared/capture'
import type { DisplayInfo, ShortcutStatus } from '../../shared/ipc'
import { MIN_OPACITY, type Settings, type SettingsPatch, type ShortcutSettings } from '../../shared/settings'
import { WINDOW_SIZE_IDS, WINDOW_SIZES } from '../../shared/windowSize'
import { captureLabel } from '../captureLabels'
import { ShieldIcon } from '../icons'
import { ShortcutRecorder } from '../ShortcutRecorder'
import { Row, Toggle } from './fields'

const SHORTCUT_LABELS: Record<keyof ShortcutSettings, string> = {
  toggleListening: 'Start / stop listening',
  answerNow: 'Answer latest question',
  analyzeScreen: 'Analyze screen',
  toggleWindow: 'Show / hide window',
  focusInput: 'Show and focus input',
  nextDisplay: 'Move to next display',
  cycleWindowSize: 'Change window size'
}

export function GeneralTab({ settings, capture, update }: { settings: Settings; capture: CaptureStatus | null; update(p: SettingsPatch): Promise<unknown> }) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [shortcuts, setShortcuts] = useState<ShortcutStatus | null>(null)
  const refresh = useCallback(() => {
    window.nexus.listDisplays().then(setDisplays)
    window.nexus.getShortcutStatus().then(setShortcuts)
  }, [])
  useEffect(refresh, [refresh, settings])

  const label = captureLabel(capture)
  const current = displays.find((d) => d.current)

  return (
    <>
      <section className={`status-card tone-${label.tone}`}>
        <div className="status-head">
          <ShieldIcon />
          <strong>{label.text}</strong>
        </div>
        {capture && (
          <dl className="status-grid">
            <dt>Mechanism</dt>
            <dd>{capture.mechanism}</dd>
            <dt>OS value</dt>
            <dd>{capture.rawValue ?? '—'}</dd>
            <dt>Native module</dt>
            <dd>{capture.nativeModuleLoaded ? 'Loaded' : 'Not loaded'}</dd>
            <dt>OS</dt>
            <dd>
              {capture.platform} {capture.osVersion}
            </dd>
          </dl>
        )}
        {capture?.detail && <p className="status-detail">{capture.detail}</p>}
        {capture && capture.caveats.length > 0 && (
          <details className="caveats">
            <summary>Known limits ({capture.caveats.length})</summary>
            <ul>
              {capture.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <h2>Privacy</h2>
      <Toggle
        label="Hide from screen capture"
        hint="You still see and use the window; supported screen shares do not."
        checked={settings.captureExclusion}
        onChange={(v) => update({ captureExclusion: v })}
      />
      <Toggle
        label="Keep out of recent activity"
        hint={
          window.nexus.platform === 'darwin'
            ? "No Dock icon, so Nexus is not in the Dock, its recent apps, Cmd+Tab or the Apple menu's Recent Items; open it from the menu-bar icon or the shortcut. Minimise hides the window. Files you import or export are not added to recent items."
            : 'No taskbar button, and not in Alt+Tab or Task View; minimise hides the window. Files you import or export are kept out of Recent items.'
        }
        checked={settings.hideActivity}
        onChange={(v) => update({ hideActivity: v })}
      />

      <h2>Window</h2>
      {/* A div, not Row's <label>: a label would pass clicks on its text to the first button. */}
      <div className="row">
        <span className="row-text">
          <span className="row-label">Window size</span>
          <span className="row-hint">
            {settings.windowSize === 'custom' ? 'Resized by dragging. ' : ''}Also from the S / M / L button in the title bar or the shortcut below.
          </span>
        </span>
        <span className="size-choice" role="radiogroup" aria-label="Window size">
          {WINDOW_SIZE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.windowSize === id}
              className={`version-chip ${settings.windowSize === id ? 'active' : ''}`}
              onClick={() => update({ windowSize: id })}
            >
              {WINDOW_SIZES[id].label}
            </button>
          ))}
        </span>
      </div>
      <Row label="Opacity">
        <span className="slider">
          <input
            type="range"
            min={MIN_OPACITY}
            max={1}
            step={0.01}
            value={settings.opacity}
            onChange={(e) => update({ opacity: Number(e.target.value) })}
            aria-label="Window opacity"
          />
          <output>{Math.round(settings.opacity * 100)}%</output>
        </span>
      </Row>
      <Toggle label="Always on top" checked={settings.alwaysOnTop} onChange={(v) => update({ alwaysOnTop: v })} />
      <Toggle label="Remember position and size" checked={settings.rememberPosition} onChange={(v) => update({ rememberPosition: v })} />
      <Row label="Display">
        <select
          value={current?.id ?? ''}
          onChange={(e) => window.nexus.moveToDisplay(Number(e.target.value)).then(refresh)}
          disabled={displays.length < 2}
        >
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} — {d.bounds.width}×{d.bounds.height}
              {d.primary ? ' (main)' : ''}
            </option>
          ))}
        </select>
      </Row>

      <h2>Keyboard shortcuts</h2>
      <p className="section-hint">Global: they work while another app (your meeting) has focus. Click to record; Backspace clears.</p>
      {(Object.keys(SHORTCUT_LABELS) as (keyof ShortcutSettings)[]).map((key) => (
        <div className="row" key={key}>
          <span className="row-text">
            <span className="row-label">{SHORTCUT_LABELS[key]}</span>
          </span>
          <ShortcutRecorder
            value={settings.shortcuts[key]}
            registered={shortcuts?.[key]?.registered}
            onChange={(acc) => update({ shortcuts: { [key]: acc } })}
          />
        </div>
      ))}

      <h2>Startup</h2>
      <Toggle
        label="Launch at login"
        hint={window.nexus.platform === 'linux' ? undefined : 'Applies to the installed app only.'}
        checked={settings.launchAtLogin}
        onChange={(v) => update({ launchAtLogin: v })}
      />
      <Toggle
        label="Start hidden"
        hint="Show it later with the shortcut or the tray icon."
        checked={settings.startHidden}
        onChange={(v) => update({ startHidden: v })}
      />
    </>
  )
}
