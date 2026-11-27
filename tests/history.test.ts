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
    expect(answerPrompt('What is Docker?', '', 'bullets', 'quick')).toMatch(/2 to 4 short bullet points/)
    expect(answerPrompt('What is Docker?', '', 'bullets', 'interview')).toMatch(/3 to 6 bullet points to say in a 30 to 60 second spoken answer/)
    expect(answerPrompt('What is Docker?', '', 'bullets', 'detailed')).toMatch(/commands, configuration or code/)
    expect(answerPrompt('Write a Python script for log rotation.', '', 'bullets', 'detailed')).toMatch(/fenced code block.*Then explain each part/)
    expect(answerPrompt('Give me the kubectl command to restart a deployment.', '', 'bullets')).toMatch(/exact, complete command/)
  })
})

describe('read aloud', () => {
  it('speaks the words, not the Markdown', () => {
    expect(speakable('**Docker** packages apps.\n\n- Uses `images`\n- [Docs](https://docs.docker.com)\n\n```bash\ndocker build .\n```')).toBe(
      'Docker packages apps. Uses images Docs (code shown on screen)'
    )
  })
})

describe('tidy answers', () => {
  it('drops copied instruction labels but keeps the content', async () => {
    const { tidyAnswer } = await import('../src/services/copilot/prompts')
    expect(tidyAnswer('Answer:\nWhen I was at Walmart…')).toBe('When I was at Walmart…')
    expect(tidyAnswer('**Answer:**\nGit rebase replays commits.')).toBe('Git rebase replays commits.')
    expect(tidyAnswer('The precise, correct answer in one sentence: Locking prevents concurrent writes.')).toBe(
      'Locking prevents concurrent writes.'
    )
    expect(tidyAnswer('Intro line.\n\n**Answer:**\nDetails.')).toBe('Intro line.\n\nDetails.')
    expect(tidyAnswer('The answer depends on the load: use a queue.')).toBe('The answer depends on the load: use a queue.')
  })
})

describe('bullet answers from small local models', () => {
  it('moves a code block opened inside a bullet to its own line', async () => {
    const { tidyAnswer } = await import('../src/services/copilot/prompts')
    const { parseMarkdown } = await import('../src/services/copilot/markdown')
    const raw = '- Probes are set per container.\n- ```yaml\nlivenessProbe:\n  httpGet:\n    path: /healthz\n  ```\n- The kubelet restarts it.'
    const fixed = tidyAnswer(raw)
    expect(fixed).toBe('- Probes are set per container.\n```yaml\nlivenessProbe:\n  httpGet:\n    path: /healthz\n```\n- The kubelet restarts it.')
    expect(parseMarkdown(fixed).map((b) => b.t)).toEqual(['list', 'code', 'list'])
  })

  it('drops whole lines a looping model repeated, but not repeated code or short lines', async () => {
    const { tidyAnswer } = await import('../src/services/copilot/prompts')
    const loop = ['- Use `top` to find the busy process.', '- Check services with `systemctl`.', '- Use `top` to find the busy process.', '- Check services with `systemctl`.'].join('\n')
    expect(tidyAnswer(loop)).toBe('- Use `top` to find the busy process.\n- Check services with `systemctl`.')
    const code = '```bash\necho "restarting the service now"\necho "restarting the service now"\n```\n- Yes.\n- Yes.'
    expect(tidyAnswer(code)).toBe(code)
  })

  it('writing requests get ready-to-send text, not bullets or code', async () => {
    const { answerPrompt, chatPrompt, wantsWriting, wantsCode } = await import('../src/services/copilot/prompts')
    const email = "Draft a short email to my recruiter asking to move tomorrow's interview to Friday."
    expect(wantsWriting(email)).toBe(true)
    expect(wantsWriting('Write a thank-you note to the interviewer')).toBe(true)
    expect(wantsWriting('Write a Python script for log rotation.')).toBe(false)
    expect(wantsWriting('What is a message queue?')).toBe(false)
    const writeEmail = 'Write a short email to the hiring manager.'
    expect(wantsCode(writeEmail) && wantsWriting(writeEmail)).toBe(true) // "write a…": the writing check must come first
    expect(answerPrompt(writeEmail, '', 'detailed')).toMatch(/ready-to-send text/)
    expect(chatPrompt(email, '')).toMatch(/ready-to-send text in that format: no bullet points and no code block/)
    expect(answerPrompt(email, '', 'detailed')).toMatch(/ready-to-send text/)
    expect(answerPrompt(email, '', 'detailed')).not.toMatch(/fenced code block/)
    expect(chatPrompt('What is Kubernetes?', '')).toBe('What is Kubernetes?')
  })

  it('asks for complete commands in a code block of their own', async () => {
    const { answerPrompt } = await import('../src/services/copilot/prompts')
    expect(answerPrompt('Give me the kubectl command to roll back a deployment.', '', 'detailed')).toMatch(
      /exact, complete command.*resource type, name and flags.*fenced code block of their own/
    )
  })
})

describe('repetition guard', () => {
  it('ends an answer that loops through the same bullets', async () => {
    const { RepetitionGuard } = await import('../src/services/ai/repetition')
    const g = new RepetitionGuard()
    const lines = ['- Use `perf` for detailed CPU profiling.', '- Check misconfigured services with `systemctl list-unit-files`.', '- Use `strace` on the process to see system calls.']
    const stream = [...lines, ...lines, ...lines].map((l) => `${l}\n`)
    const stoppedAt = stream.findIndex((chunk) => g.push(chunk))
    expect(stoppedAt).toBe(4) // the second repeated line
  })

  it('lets a normal answer through, including repeated code lines split across chunks', async () => {
    const { RepetitionGuard } = await import('../src/services/ai/repetition')
    const g = new RepetitionGuard()
    const answer =
      '- A readiness probe gates traffic to the pod.\n- A liveness probe restarts a stuck container.\n```yaml\nperiodSeconds: 10\nperiodSeconds: 10\nperiodSeconds: 10\n```\n- Both run on the kubelet.\n- Yes.\n- Yes.\n'
    const chunks = answer.match(/.{1,7}/gs) ?? []
    expect(chunks.some((c) => g.push(c))).toBe(false)
  })
})

describe('fine-tuning from the live tests', () => {
  it('ends an endless list of bullet variations from a local model', async () => {
    const { RepetitionGuard } = await import('../src/services/ai/repetition')
    const g = new RepetitionGuard(15)
    const variants = ['-s', '-p', '-n', '-w', '-x', '-t', '-u', '-a', '-r', '-i', '-l', '-e', '-g', '-c', '-o', '-v', '-z']
    const lines = variants.map((f) => `- Check for misconfigured network protocols with \`netstat ${f}\`.\n`)
    expect(lines.findIndex((l) => g.push(l))).toBe(14) // the 15th bullet
    const cloud = new RepetitionGuard()
    expect(lines.some((l) => cloud.push(l))).toBe(false) // no bullet budget for cloud models
  })

  it('shows a bullet that is only a command as a code block to copy', async () => {
    const { tidyAnswer } = await import('../src/services/copilot/prompts')
    expect(tidyAnswer('- `kubectl rollout undo deployment/<name>`\n- Rolls back to the previous revision.')).toBe(
      '```bash\nkubectl rollout undo deployment/<name>\n```\n- Rolls back to the previous revision.'
    )
    // Names in a sentence stay inline.
    expect(tidyAnswer('- Use `top` or `htop` to find it.\n- `readinessProbe` and `livenessProbe` are set per container.')).toBe(
      '- Use `top` or `htop` to find it.\n- `readinessProbe` and `livenessProbe` are set per container.'
    )
  })

  it('fixes terms the speech recogniser misheard in the voice test', async () => {
    const { fixTechTerms } = await import('../src/services/stt/techTerms')
    expect(fixTechTerms('How does a Kubernetes readiness probe differ from a Lightness probe?')).toBe(
      'How does a Kubernetes readiness probe differ from a liveness probe?'
    )
    expect(fixTechTerms('Can you explain the cat theorem with an example?')).toBe('Can you explain the CAP theorem with an example?')
    expect(fixTechTerms('The cat sat on the mat.')).toBe('The cat sat on the mat.')
  })
})
