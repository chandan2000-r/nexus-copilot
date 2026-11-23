import { useCallback, useEffect, useState } from 'react'
import { MODE_LABELS } from '../services/copilot/prompts'
import type { SessionRecord, SessionSummary } from '../shared/copilot'
import { BackIcon, DownloadIcon, TrashIcon } from './icons'
import { Markdown } from './Markdown'

const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function Detail({ rec, onBack, onDeleted }: { rec: SessionRecord; onBack(): void; onDeleted(): void }) {
  const [tab, setTab] = useState<'answers' | 'transcript'>(rec.messages.length ? 'answers' : 'transcript')
  const [exported, setExported] = useState(false)
  return (
    <main className="history">
      <div className="history-bar">
        <button className="icon-btn" onClick={onBack} title="Back" aria-label="Back">
          <BackIcon />
        </button>
        <div className="history-title">
          <strong>{rec.title}</strong>
          <span>
            {MODE_LABELS[rec.mode] ?? rec.mode} · {when(rec.startedAt)}
          </span>
        </div>
        <button
          className="icon-btn"
          title="Export as Markdown"
          aria-label="Export"
          onClick={async () => setExported(await window.nexus.sessions.exportMarkdown(rec.id))}
        >
          <DownloadIcon />
        </button>
        <button
          className="icon-btn danger"
          title="Delete session"
          aria-label="Delete"
          onClick={async () => {
            if (!confirm('Delete this session? This cannot be undone.')) return
            await window.nexus.sessions.delete(rec.id)
            onDeleted()
          }}
        >
          <TrashIcon />
        </button>
      </div>
      {exported && <p className="section-hint pad">Exported.</p>}
      <nav className="tabs small">
        <button className={tab === 'answers' ? 'active' : ''} onClick={() => setTab('answers')}>
          Answers ({rec.messages.filter((m) => m.role === 'user').length})
        </button>
        <button className={tab === 'transcript' ? 'active' : ''} onClick={() => setTab('transcript')}>
          Transcript ({rec.transcript.length})
        </button>
      </nav>
      <div className="history-body">
        {tab === 'answers' &&
          rec.messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className={`turn-head kind-${m.kind}`}>
                <span className="badge">{m.kind === 'answer' ? 'Q' : m.kind === 'screen' ? 'Screen' : 'You'}</span>
                <span className="turn-text">{m.content}</span>
              </div>
            ) : (
              <div key={m.id} className="answer">
                <Markdown text={m.content} />
              </div>
            )
          )}
        {tab === 'transcript' &&
          rec.transcript.map((l) => (
            <p key={l.id} className={`line ${l.source}`}>
              <time>{clock(l.at)}</time> <b>{l.source === 'them' ? 'Them' : 'You'}</b> {l.text}
            </p>
          ))}
      </div>
    </main>
  )
}

export function HistoryPanel() {
  const [list, setList] = useState<SessionSummary[] | null>(null)
  const [open, setOpen] = useState<SessionRecord | null>(null)
  const refresh = useCallback(() => void window.nexus.sessions.list().then(setList), [])
  useEffect(refresh, [refresh])

  if (open) {
    return (
      <Detail
        rec={open}
        onBack={() => setOpen(null)}
        onDeleted={() => {
          setOpen(null)
          refresh()
        }}
      />
    )
  }

  return (
    <main className="history">
      <h2 className="history-h">Session history</h2>
      {list && list.length === 0 && <p className="section-hint pad">No saved sessions yet. Sessions save automatically while you use Nexus.</p>}
      <ul className="session-list">
        {list?.map((s) => (
          <li key={s.id}>
            <button onClick={() => void window.nexus.sessions.get(s.id).then((r) => r && setOpen(r))}>
              <strong>{s.title}</strong>
              <span>
                {MODE_LABELS[s.mode] ?? s.mode} · {when(s.updatedAt)} · {s.questions} Q · {s.lines} lines
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
