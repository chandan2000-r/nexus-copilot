import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { ModelListResult, SecretsStatus } from '../../shared/ipc'
import type { SecretName } from '../../shared/settings'

export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="row">
      <span className="row-text">
        <span className="row-label">{label}</span>
        {hint && <span className="row-hint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <Row label={label} hint={hint}>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  )
}

/** Text input that keeps local state and saves after typing pauses or on blur. */
export function TextField({
  value,
  onCommit,
  placeholder,
  multiline,
  rows = 5,
  mono,
  ariaLabel
}: {
  value: string
  onCommit(v: string): void
  placeholder?: string
  multiline?: boolean
  rows?: number
  mono?: boolean
  ariaLabel?: string
}) {
  const [local, setLocal] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) setLocal(value)
  }, [value])
  const commit = (v: string) => {
    if (timer.current) clearTimeout(timer.current)
    dirty.current = false
    if (v !== value) onCommit(v)
  }
  const onChange = (v: string) => {
    setLocal(v)
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(v), 700)
  }
  const props = {
    value: local,
    placeholder,
    'aria-label': ariaLabel,
    className: `field ${mono ? 'mono' : ''}`,
    spellCheck: false,
    onBlur: () => commit(local)
  }
  return multiline ? (
    <textarea {...props} rows={rows} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input {...props} onChange={(e) => onChange(e.target.value)} />
  )
}

/** API key entry. Keys go straight to the main process; the UI only learns whether one is saved. */
export function KeyField({
  name,
  label,
  status,
  onStatus,
  hint
}: {
  name: SecretName
  label: string
  status: SecretsStatus | null
  onStatus(s: SecretsStatus): void
  hint?: ReactNode
}) {
  const saved = !!status?.saved[name]
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const save = async (v: string) => {
    onStatus(await window.nexus.secrets.set(name, v))
    setValue('')
    setEditing(false)
  }
  return (
    <div className="field-block">
      <div className="field-label">
        {label}
        {saved && !editing && <span className="saved-tag">Saved{status?.encryption === 'os' ? ' · encrypted' : ''}</span>}
      </div>
      {saved && !editing ? (
        <div className="key-row">
          <span className="key-mask">••••••••••••••••</span>
          <button className="mini-btn" onClick={() => setEditing(true)}>
            Replace
          </button>
          <button className="mini-btn danger" onClick={() => void save('')}>
            Remove
          </button>
        </div>
      ) : (
        <div className="key-row">
          <input
            type="password"
            className="field mono"
            value={value}
            placeholder="Paste API key"
            aria-label={label}
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && value.trim() && void save(value)}
          />
          <button className="mini-btn primary" disabled={!value.trim()} onClick={() => void save(value)}>
            Save
          </button>
          {saved && (
            <button className="mini-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </div>
      )}
      {hint && <div className="field-hint">{hint}</div>}
      {status?.encryption === 'plain' && (
        <div className="field-hint warn">This system has no OS key store, so keys are saved unencrypted in the app's data folder.</div>
      )}
    </div>
  )
}

/** Model name with suggestions; "Load" fetches the provider's live list. */
export function ModelField({
  id,
  value,
  suggestions,
  onCommit,
  load
}: {
  id: string
  value: string
  suggestions: string[]
  onCommit(v: string): void
  load?: () => Promise<ModelListResult>
}) {
  const [models, setModels] = useState<string[]>([])
  const [state, setState] = useState<string | null>(null)
  const list = [...new Set([...suggestions, ...models])]
  return (
    <div className="field-block">
      <div className="field-label">Model</div>
      <div className="key-row">
        <input
          className="field mono"
          list={`models-${id}`}
          defaultValue={value}
          key={value}
          aria-label="Model"
          spellCheck={false}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== value && onCommit(e.target.value.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <datalist id={`models-${id}`}>
          {list.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        {load && (
          <button
            className="mini-btn"
            onClick={async () => {
              setState('Loading…')
              const r = await load()
              if (r.ok) {
                setModels(r.models)
                setState(`${r.models.length} models available — pick from the list`)
              } else setState(r.error)
            }}
          >
            Load
          </button>
        )}
      </div>
      {state && <div className="field-hint">{state}</div>}
    </div>
  )
}
