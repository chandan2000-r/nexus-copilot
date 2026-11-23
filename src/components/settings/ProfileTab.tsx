import { useState } from 'react'
import type { ProfileSettings, Settings, SettingsPatch } from '../../shared/settings'
import { TextField } from './fields'

export function ProfileTab({ settings, update }: { settings: Settings; update(p: SettingsPatch): Promise<unknown> }) {
  const p = settings.profile
  const [msg, setMsg] = useState<string | null>(null)
  const set = (patch: Partial<ProfileSettings>) => update({ profile: patch })

  const importInto = async (field: 'resume' | 'jobDescription') => {
    setMsg(null)
    const r = await window.nexus.importProfileFile()
    if (!r) return
    if ('error' in r) return setMsg(r.error)
    await set({ [field]: r.text })
    setMsg(`Imported ${r.name} (${r.text.length.toLocaleString()} characters).`)
  }

  return (
    <>
      <p className="section-hint">
        Answers use this to sound like you: real projects, numbers and skills. It is stored on this computer and sent to
        the AI provider with each request.
      </p>
      <div className="two-col">
        <div className="field-block">
          <div className="field-label">Target role</div>
          <TextField value={p.role} placeholder="e.g. Senior Backend Engineer" onCommit={(v) => set({ role: v })} ariaLabel="Target role" />
        </div>
        <div className="field-block">
          <div className="field-label">Company</div>
          <TextField value={p.company} placeholder="e.g. Acme Corp" onCommit={(v) => set({ company: v })} ariaLabel="Company" />
        </div>
      </div>

      <div className="field-block">
        <div className="field-label">
          Resume / background
          <button className="mini-btn" onClick={() => void importInto('resume')}>
            Import PDF / text…
          </button>
        </div>
        <TextField multiline rows={8} value={p.resume} placeholder="Paste your resume, key projects, achievements with numbers…" onCommit={(v) => set({ resume: v })} ariaLabel="Resume" />
      </div>

      <div className="field-block">
        <div className="field-label">
          Job description
          <button className="mini-btn" onClick={() => void importInto('jobDescription')}>
            Import…
          </button>
        </div>
        <TextField multiline rows={6} value={p.jobDescription} placeholder="Paste the job posting so answers match what they are looking for" onCommit={(v) => set({ jobDescription: v })} ariaLabel="Job description" />
      </div>

      <div className="field-block">
        <div className="field-label">Extra instructions</div>
        <TextField
          multiline
          rows={3}
          value={p.instructions}
          placeholder="e.g. I prefer Go for coding answers. Keep a friendly, confident tone."
          onCommit={(v) => set({ instructions: v })}
          ariaLabel="Extra instructions"
        />
      </div>
      {msg && <p className="section-hint">{msg}</p>}
    </>
  )
}
