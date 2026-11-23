/** Saved copilot sessions (transcript + answers), one JSON file each in <userData>/sessions. */
import { app } from 'electron'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionRecord, SessionSummary } from '../shared/copilot'
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

  list(): SessionSummary[] {
    let files: string[] = []
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
    const out: SessionSummary[] = []
    for (const f of files) {
      try {
        const r = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as SessionRecord
        out.push({
          id: r.id,
          title: r.title,
          mode: r.mode,
          startedAt: r.startedAt,
          updatedAt: r.updatedAt,
          questions: r.messages.filter((m) => m.role === 'user').length,
          lines: r.transcript.length
        })
      } catch {
        /* skip unreadable file */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
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
        at: Number(m.at) || 0
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
        out.push(m.content, '')
      }
    }
  }
  if (r.transcript.length) {
    out.push('## Transcript', '')
    for (const l of r.transcript) out.push(`**${l.source === 'them' ? 'Them' : 'You'}** (${time(l.at)}): ${l.text}  `)
  }
  return `${out.join('\n').trim()}\n`
}
