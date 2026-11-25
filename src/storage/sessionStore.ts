/** Saved copilot sessions (transcript + answers), one JSON file each in <userData>/sessions. */
import { app } from 'electron'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ANSWER_VERSIONS,
  type AnswerVersion,
  type BookmarkItem,
  type SessionRecord,
  type SessionSearchHit,
  type SessionSummary
} from '../shared/copilot'
import { MODE_LABELS } from '../services/copilot/prompts'

const ID = /^[A-Za-z0-9-]{8,64}$/
const MAX_LINES = 5_000
const MAX_MESSAGES = 1_000

export class SessionStore {
  private readonly dir = join(app.getPath('userData'), 'sessions')

  private path(id: string): string {
    if (!ID.test(id)) throw new Error('invalid session id')
    return join(this.dir, `${id}.json`)
  }

  /** Every readable saved session, newest first. */
  private all(): SessionRecord[] {
    let files: string[] = []
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
    const out: SessionRecord[] = []
    for (const f of files) {
      try {
        out.push(JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as SessionRecord)
      } catch {
        /* skip unreadable file */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  list(): SessionSummary[] {
    return this.all().map((r) => ({
      id: r.id,
      title: r.title,
      mode: r.mode,
      startedAt: r.startedAt,
      updatedAt: r.updatedAt,
      questions: r.messages.filter((m) => m.role === 'user').length,
      lines: r.transcript.length,
      bookmarks: r.messages.filter((m) => m.bookmarked).length
    }))
  }

  search(query: string): SessionSearchHit[] {
    return searchSessions(this.all(), query)
  }

  bookmarks(): BookmarkItem[] {
    return bookmarksOf(this.all())
  }

  get(id: string): SessionRecord | null {
    try {
      return JSON.parse(readFileSync(this.path(id), 'utf8')) as SessionRecord
    } catch {
      return null
    }
  }

  save(rec: SessionRecord): void {
    const clean: SessionRecord = {
      id: String(rec.id),
      title: String(rec.title ?? 'Session').slice(0, 200),
      mode: rec.mode,
      startedAt: Number(rec.startedAt) || Date.now(),
      updatedAt: Date.now(),
      transcript: (rec.transcript ?? []).slice(-MAX_LINES).map((l) => ({
        id: String(l.id),
        source: l.source === 'you' ? 'you' : 'them',
        text: String(l.text).slice(0, 5_000),
        at: Number(l.at) || 0
      })),
      messages: (rec.messages ?? []).slice(-MAX_MESSAGES).map((m) => ({
        id: String(m.id),
        role: m.role === 'assistant' ? 'assistant' : 'user',
        kind: m.kind === 'answer' || m.kind === 'screen' ? m.kind : 'chat',
        content: String(m.content).slice(0, 50_000),
        at: Number(m.at) || 0,
        ...(m.role === 'assistant' ? answerExtras(m) : {})
      }))
    }
    const file = this.path(clean.id)
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(clean))
    renameSync(`${file}.tmp`, file)
  }

  delete(id: string): void {
    rmSync(this.path(id), { force: true })
  }
}

/** Bookmark and answer versions of a saved answer, keeping only well-formed values. */
function answerExtras(m: SessionRecord['messages'][number]): Partial<SessionRecord['messages'][number]> {
  const out: Partial<SessionRecord['messages'][number]> = {}
  if (m.bookmarked === true) out.bookmarked = true
  if (m.versions && typeof m.versions === 'object') {
    const v: Partial<Record<AnswerVersion, string>> = {}
    for (const k of ANSWER_VERSIONS) if (typeof m.versions[k] === 'string') v[k] = m.versions[k]!.slice(0, 50_000)
    if (Object.keys(v).length) out.versions = v
  }
  if (m.version && ANSWER_VERSIONS.includes(m.version)) out.version = m.version
  return out
}

/** Shortens `text` to about `width` characters around position `at`. */
function around(text: string, at: number, width = 140): string {
  const t = text.replace(/\s+/g, ' ')
  const start = Math.max(0, at - Math.floor(width / 3))
  const end = Math.min(t.length, start + width)
  return `${start > 0 ? '…' : ''}${t.slice(start, end).trim()}${end < t.length ? '…' : ''}`
}

/** Case-insensitive search; at most a few hits per session, 50 in all, newest sessions first. */
export function searchSessions(records: SessionRecord[], query: string, limit = 50): SessionSearchHit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const hits: SessionSearchHit[] = []
  for (const r of records) {
    const add = (where: SessionSearchHit['where'], text: string) => {
      const i = text.replace(/\s+/g, ' ').toLowerCase().indexOf(q)
      if (i < 0) return false
      hits.push({ sessionId: r.id, title: r.title, startedAt: r.startedAt, where, snippet: around(text, i) })
      return true
    }
    let n = 0
    if (add('title', r.title)) n++
    for (const m of r.messages) {
      if (n >= 3) break
      if (m.role === 'user' ? add('question', m.content) : add('answer', m.content)) n++
    }
    for (const l of r.transcript) {
      if (n >= 3) break
      if (add('transcript', l.text)) n++
    }
    if (hits.length >= limit) break
  }
  return hits.slice(0, limit)
}

/** Bookmarked answers with the question before each, newest first. */
export function bookmarksOf(records: SessionRecord[]): BookmarkItem[] {
  const out: BookmarkItem[] = []
  for (const r of records) {
    r.messages.forEach((m, i) => {
      if (m.role !== 'assistant' || !m.bookmarked) return
      const q = [...r.messages.slice(0, i)].reverse().find((x) => x.role === 'user')
      out.push({ sessionId: r.id, sessionTitle: r.title, messageId: m.id, question: q?.content ?? '', answer: m.content, at: m.at })
    })
  }
  return out.sort((a, b) => b.at - a.at)
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function sessionToMarkdown(r: SessionRecord): string {
  const out = [
    `# ${r.title}`,
    '',
    `${MODE_LABELS[r.mode] ?? r.mode} · ${new Date(r.startedAt).toLocaleString()}`,
    ''
  ]
  if (r.messages.length) {
    out.push('## Questions and answers', '')
    for (const m of r.messages) {
      if (m.role === 'user') {
        const label = m.kind === 'answer' ? 'Question' : m.kind === 'screen' ? 'Screen' : 'You asked'
        out.push(`### ${label} (${time(m.at)})`, '', m.content, '')
      } else {
        out.push(m.bookmarked ? `★ ${m.content}` : m.content, '')
      }
    }
  }
  if (r.transcript.length) {
    out.push('## Transcript', '')
    for (const l of r.transcript) out.push(`**${l.source === 'them' ? 'Them' : 'You'}** (${time(l.at)}): ${l.text}  `)
  }
  return `${out.join('\n').trim()}\n`
}
