import { describe, expect, it } from 'vitest'
import type { SessionRecord } from '../src/shared/copilot'
import { answerPrompt } from '../src/services/copilot/prompts'
import { speakable } from '../src/services/useCopilot'
import { bookmarksOf, searchSessions, sessionToMarkdown } from '../src/storage/sessionStore'

const rec = (id: string, updatedAt: number, messages: SessionRecord['messages'], transcript: string[] = []): SessionRecord => ({
  id,
  title: messages.find((m) => m.role === 'user')?.content ?? `Session ${id}`,
  mode: 'interview',
  startedAt: updatedAt - 1000,
  updatedAt,
  transcript: transcript.map((text, i) => ({ id: `${id}-l${i}`, source: 'them', text, at: updatedAt - 900 + i })),
  messages
})
const q = (id: string, content: string, at: number) => ({ id, role: 'user' as const, kind: 'answer' as const, content, at })
const a = (id: string, content: string, at: number, bookmarked = false) => ({ id, role: 'assistant' as const, kind: 'answer' as const, content, at, bookmarked })

const sessions = [
  rec('s2', 2000, [q('q3', 'What is a multistage build in Docker?', 1900), a('a3', 'It uses several FROM stages and copies only the artifacts.', 1950, true)], [
    'Tell me about your Kubernetes work.'
  ]),
  rec('s1', 1000, [
    q('q1', 'How does a NAT gateway work?', 100),
    a('a1', 'It lets private subnets reach the internet without inbound access.', 150, true),
    q('q2', 'Write a Python script for log rotation.', 200),
    a('a2', 'Use logging.handlers.RotatingFileHandler.', 250)
  ])
]

describe('history search', () => {
  it('finds questions, answers and transcript lines, case-insensitively', () => {
    expect(searchSessions(sessions, 'rotatingfilehandler').map((h) => [h.sessionId, h.where])).toEqual([['s1', 'answer']])
    expect(searchSessions(sessions, 'KUBERNETES').map((h) => h.where)).toEqual(['transcript'])
    const docker = searchSessions(sessions, 'multistage')
    expect(docker[0]).toMatchObject({ sessionId: 's2', where: 'title' })
    expect(docker.map((h) => h.where)).toContain('question')
  })

  it('ignores one-letter searches and shortens long matches', () => {
    expect(searchSessions(sessions, 'a')).toEqual([])
    const long = rec('s3', 3000, [q('q9', `${'word '.repeat(80)}needle ${'more '.repeat(80)}`, 10)])
    const hit = searchSessions([long], 'needle')[0]
    expect(hit.snippet.length).toBeLessThan(150)
    expect(hit.snippet).toMatch(/^….*needle.*…$/)
  })
})

describe('bookmarks', () => {
  it('lists bookmarked answers with their questions, newest first', () => {
    expect(bookmarksOf(sessions).map((b) => [b.question, b.sessionId])).toEqual([
      ['What is a multistage build in Docker?', 's2'],
      ['How does a NAT gateway work?', 's1']
    ])
  })

  it('marks bookmarks in the Markdown export', () => {
    expect(sessionToMarkdown(sessions[1])).toContain('★ It lets private subnets reach the internet')
  })
})

describe('answer modes', () => {
  it('asks for the chosen length and depth, keeping code requests as code', () => {
    expect(answerPrompt('What is Docker?', '', 'bullets', 'quick')).toMatch(/2 to 4 sentences/)
    expect(answerPrompt('What is Docker?', '', 'bullets', 'interview')).toMatch(/30 to 60 second spoken answer/)
    expect(answerPrompt('What is Docker?', '', 'bullets', 'detailed')).toMatch(/commands, configuration or code/)
    expect(answerPrompt('Write a Python script for log rotation.', '', 'bullets', 'detailed')).toMatch(/fenced code block.*Then explain each part/)
    expect(answerPrompt('Give me the kubectl command to restart a deployment.', '', 'bullets')).toMatch(/exact command/)
  })
})

describe('read aloud', () => {
  it('speaks the words, not the Markdown', () => {
    expect(speakable('**Docker** packages apps.\n\n- Uses `images`\n- [Docs](https://docs.docker.com)\n\n```bash\ndocker build .\n```')).toBe(
      'Docker packages apps. Uses images Docs (code shown on screen)'
    )
  })
})
