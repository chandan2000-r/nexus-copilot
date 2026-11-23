import { type KeyboardEvent, useState } from 'react'

const isMac = navigator.userAgent.includes('Mac')

const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  Escape: 'Escape',
  Tab: 'Tab',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Backslash: '\\'
}

function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code
  return KEY_NAMES[code] ?? null
}

/** Converts a keydown into an Electron accelerator string, or null if incomplete. */
function toAccelerator(e: KeyboardEvent): string | null {
  const key = keyFromCode(e.code)
  if (!key) return null
  const mods: string[] = []
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl')
  if (isMac && e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (mods.length === 0 && !/^F\d+$/.test(key)) return null
  return [...mods, key].join('+')
}

export function prettyAccelerator(acc: string): string {
  if (!acc) return 'Not set'
  return acc
    .split('+')
    .map((p) => {
      if (p === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl'
      if (isMac && p === 'Control') return '⌃'
      if (isMac && p === 'Alt') return '⌥'
      if (isMac && p === 'Shift') return '⇧'
      return p
    })
    .join(isMac ? '' : '+')
}

interface Props {
  value: string
  registered: boolean | undefined
  onChange(accelerator: string): void
}

export function ShortcutRecorder({ value, registered, onChange }: Props) {
  const [recording, setRecording] = useState(false)

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return
    e.preventDefault()
    if (e.key === 'Escape') return setRecording(false)
    if (e.key === 'Backspace' || e.key === 'Delete') {
      setRecording(false)
      return onChange('')
    }
    const acc = toAccelerator(e)
    if (acc) {
      setRecording(false)
      onChange(acc)
    }
  }

  return (
    <div className="shortcut">
      <button
        className={`shortcut-btn ${recording ? 'recording' : ''}`}
        onClick={() => setRecording((r) => !r)}
        onKeyDown={onKeyDown}
        onBlur={() => setRecording(false)}
      >
        {recording ? 'Press keys… (Esc to cancel)' : prettyAccelerator(value)}
      </button>
      {!recording && value && registered === false && (
        <span className="shortcut-warn" title="Another app may already use this shortcut">
          In use
        </span>
      )}
    </div>
  )
}
