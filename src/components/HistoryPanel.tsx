import { useCallback, useEffect, useState } from 'react'
import { MODE_LABELS } from '../services/copilot/prompts'
import type { BookmarkItem, SessionRecord, SessionSearchHit, SessionSummary } from '../shared/copilot'
import { BackIcon, DownloadIcon, StarIcon, TrashIcon } from './icons'
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
              <div key={m.id} className={`answer ${m.bookmarked ? 'bookmarked' : ''}`}>
                {m.bookmarked && (
                  <span className="bookmark-mark" title="Bookmarked">
                    <StarIcon width={12} height={12} filled />
                  </span>
                )}
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

const WHERE: Record<SessionSearchHit['where'], string> = { title: 'Title', question: 'Question', answer: 'Answer', transcript: 'Transcript' }

export function HistoryPanel() {
  const [list, setList] = useState<SessionSummary[] | null>(null)
  const [open, setOpen] = useState<SessionRecord | null>(null)
  const [tab, setTab] = useState<'sessions' | 'bookmarks'>('sessions')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SessionSearchHit[] | null>(null)
  const [marks, setMarks] = useState<BookmarkItem[] | null>(null)
  const refresh = useCallback(() => {
    void window.nexus.sessions.list().then(setList)
    void window.nexus.sessions.bookmarks().then(setMarks)
  }, [])
  useEffect(refresh, [refresh])

  // Search as you type (from 2 characters), a moment after typing stops.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits(null)
      return
    }
    const t = setTimeout(() => void window.nexus.sessions.search(q).then(setHits), 200)
    return () => clearTimeout(t)
  }, [query])

  const openSession = (id: string) => void window.nexus.sessions.get(id).then((r) => r && setOpen(r))

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
      <div className="history-top">
        <h2 className="history-h">History</h2>
        <input
          className="field history-search"
          type="search"
          placeholder="Search questions, answers, transcripts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search history"
        />
      </div>
      {hits ? (
        <>
          <p className="section-hint pad">{hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'No matches.'}</p>
          <ul className="session-list">
            {hits.map((h, i) => (
              <li key={`${h.sessionId}-${i}`}>
                <button onClick={() => openSession(h.sessionId)}>
                  <strong>{h.snippet}</strong>
                  <span>
                    {WHERE[h.where]} · {h.title} · {when(h.startedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <nav className="tabs small">
            <button className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}>
              Sessions ({list?.length ?? 0})
            </button>
            <button className={tab === 'bookmarks' ? 'active' : ''} onClick={() => setTab('bookmarks')}>
              Bookmarks ({marks?.length ?? 0})
            </button>
          </nav>
          {tab === 'sessions' && (
            <>
              {list && list.length === 0 && (
                <p className="section-hint pad">No saved sessions yet. Sessions save automatically while you use Nexus.</p>
              )}
              <ul className="session-list">
                {list?.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => openSession(s.id)}>
                      <strong>{s.title}</strong>
                      <span>
                        {MODE_LABELS[s.mode] ?? s.mode} · {when(s.updatedAt)} · {s.questions} Q · {s.lines} lines
                        {s.bookmarks > 0 && ` · ★ ${s.bookmarks}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {tab === 'bookmarks' && (
            <>
              {marks && marks.length === 0 && (
                <p className="section-hint pad">No bookmarks yet. Use the star under an answer to keep it here.</p>
              )}
              <ul className="bookmark-list">
                {marks?.map((b) => (
                  <li key={b.messageId}>
                    <button className="bookmark-open" onClick={() => openSession(b.sessionId)}>
                      <strong>{b.question || b.sessionTitle}</strong>
                      <span>
                        {b.sessionTitle !== b.question && `${b.sessionTitle} · `}
                        {when(b.at)}
                      </span>
                    </button>
                    <div className="answer">
                      <Markdown text={b.answer} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  )
}
