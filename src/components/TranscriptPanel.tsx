import { useEffect, useRef, useState } from 'react'
import type { Copilot } from '../services/useCopilot'
import { ChevronIcon } from './icons'

export function TranscriptPanel({ copilot }: { copilot: Copilot }) {
  const [open, setOpen] = useState(true)
  const body = useRef<HTMLDivElement>(null)
  const { transcript, partials, listening, speaking } = copilot
  const hasPartials = !!(partials.them || partials.you)

  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [transcript, partials, open])

  if (!listening && transcript.length === 0) return null

  return (
    <section className={`transcript ${open ? 'open' : ''}`}>
      <button className="transcript-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>Transcript</span>
        <span className="count">{transcript.length}</span>
        {(speaking.them || speaking.you) && <span className="talking">{speaking.them ? 'Them' : 'You'} speaking…</span>}
        <ChevronIcon className="chev" width={14} height={14} />
      </button>
      {open && (
        <div className="transcript-body" ref={body}>
          {transcript.length === 0 && !hasPartials && (
            <p className="transcript-empty">Listening… lines appear after each pause.</p>
          )}
          {transcript.map((l) => (
            <p key={l.id} className={`line ${l.source}`}>
              <b>{l.source === 'them' ? 'Them' : 'You'}</b> {l.text}
            </p>
          ))}
          {(['them', 'you'] as const).map(
            (s) =>
              partials[s] && (
                <p key={s} className={`line ${s} partial`}>
                  <b>{s === 'them' ? 'Them' : 'You'}</b> {partials[s]}
                </p>
              )
          )}
        </div>
      )}
    </section>
  )
}
