import { describe, expect, it } from 'vitest'
import { trimToBudget, windowStart } from '../src/services/ai/contextWindow'
import {
  answerPrompt,
  buildMessages,
  chatPrompt,
  formatTranscript,
  screenPrompt,
  systemPrompt,
  transcriptBlock
} from '../src/services/copilot/prompts'
import { isLocalModel } from '../src/shared/providers'
import { looksLikeQuestion, questionSnippet } from '../src/services/copilot/questionDetector'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/shared/settings'

describe('looksLikeQuestion', () => {
  it.each([
    'So tell me about yourself.',
    'Can you walk me through your last project',
    'What is the difference between a process and a thread?',
    'Great. Now, describe a time you disagreed with your manager.',
    'How would you design a URL shortener',
    'Okay thanks for that. Why do you want to work here',
    "What's Kubernetes?",
    'Explain polymorphism',
    'Define REST.',
    "What's Docker used for?"
  ])('detects: %s', (q) => expect(looksLikeQuestion(q)).toBe(true))

  it.each([
    'Okay, great.',
    'Yeah',
    'Sounds good?',
    'Share screen.',
    'Thank you.',
    'That makes sense, thanks for sharing that with us.',
    'Let me share my screen now.'
  ])(
    'ignores: %s',
    (q) => expect(looksLikeQuestion(q)).toBe(false)
  )
})

describe('questionSnippet', () => {
  it('keeps the last sentences when the text is long', () => {
    const long = `${'Background context sentence. '.repeat(20)}So what would you do differently?`
    const s = questionSnippet(long, 80)
    expect(s.endsWith('What would you do differently?'.replace('What', 'what'))).toBe(true)
    expect(s.length).toBeLessThanOrEqual(80)
  })
})

describe('prompts', () => {
  it('includes the profile and style in the system prompt', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      copilot: { answerStyle: 'star', mode: 'interview' },
      profile: { resume: 'Led payments team at Acme', role: 'Senior SRE' }
    })
    const sys = systemPrompt(s.copilot, s.profile)
    expect(sys).toContain('<resume>\nLed payments team at Acme\n</resume>')
    expect(sys).toContain('Target role: Senior SRE')
    expect(sys).toContain('STAR')
    expect(sys).toContain('never invent')
  })

  it('formats the transcript newest-last within budget', () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ id: String(i), source: i % 2 ? 'you' : 'them', text: `line ${i}`, at: i }) as const)
    const t = formatTranscript([...lines], 60)
    expect(t.split('\n').at(-1)).toBe('You: line 49')
    expect(t.length).toBeLessThanOrEqual(60)
  })

  it('sends earlier turns compactly and the newest turn in full', () => {
    const msgs = buildMessages('SYS', [
      { role: 'user', kind: 'answer', content: 'Why us?', prompt: 'LONG TRANSCRIPT 1' },
      { role: 'assistant', kind: 'answer', content: 'Because…' },
      { role: 'user', kind: 'screen', content: 'solve', prompt: 'FULL', images: [{ mimeType: 'image/jpeg', data: 'AAA' }] },
      { role: 'assistant', kind: 'screen', content: '' }
    ])
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(msgs[1].content).toBe('They asked: "Why us?"')
    expect(msgs[3].content).toBe('FULL')
    expect(msgs[3].images).toHaveLength(1)
    expect(answerPrompt('Why?', 'Them: Why?')).toContain('Live transcript')
  })

  it('starts every request type with the same transcript block (local prompt cache)', () => {
    const block = transcriptBlock('Them: What is a mutex?')
    for (const p of [answerPrompt('What is a mutex?', 'Them: What is a mutex?'), chatPrompt('help', 'Them: What is a mutex?'), screenPrompt('', 'Them: What is a mutex?')]) {
      expect(p.startsWith(block)).toBe(true)
    }
    expect(transcriptBlock('')).toBe('')
  })

  it('moves the transcript window in steps, so consecutive requests share their start', () => {
    const line = (i: number) => ({ id: String(i), source: 'them', text: `question number ${i} about databases`, at: i }) as const
    const lines = Array.from({ length: 200 }, (_, i) => line(i))
    const firsts = new Set<string>()
    for (let n = 1; n <= lines.length; n++) {
      const t = formatTranscript(lines.slice(0, n), 600)
      expect(t.length).toBeLessThanOrEqual(600)
      expect(t.split('\n').at(-1)).toBe(`Them: question number ${n - 1} about databases`)
      if (n > 30) expect(t.length).toBeGreaterThanOrEqual(400 - 40)
      firsts.add(t.split('\n')[0])
    }
    // ~8,600 chars through a 600-char window with 200-char steps: ~44 distinct starts, where a
    // plain sliding window would start somewhere new on almost every one of the 200 lines.
    expect(firsts.size).toBeLessThanOrEqual(45)
  })
})

describe('trimToBudget', () => {
  it('keeps images only on the newest message that has them', () => {
    const img = [{ mimeType: 'image/png', data: 'x' }]
    const out = trimToBudget([
      { role: 'system', content: 's' },
      { role: 'user', content: 'a', images: img },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c', images: img }
    ])
    expect(out[1].images).toBeUndefined()
    expect(out[3].images).toHaveLength(1)
  })

  it('finds a stable start with steps, and the largest window without', () => {
    expect(windowStart([10, 10, 10, 10], 25)).toBe(2)
    expect(windowStart([10, 10, 10, 10], 100)).toBe(0)
    expect(windowStart([10, 10, 50], 20)).toBe(2) // nothing fits: keep the newest anyway
    // Step 20: cut points sit where the running total passes 20, 40, …
    const starts = [4, 5, 6, 7, 8].map((n) => windowStart(Array(n).fill(10), 35, 20))
    expect(starts).toEqual([2, 2, 4, 4, 6])
  })

  it('trims local requests in steps that keep the system prompt and a stable start', () => {
    const turn = (i: number) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `${i}`.padEnd(100, '.') })
    const starts = new Set<string>()
    for (let n = 1; n <= 60; n++) {
      const out = trimToBudget([{ role: 'system', content: 'S'.repeat(100) }, ...Array.from({ length: n }, (_, i) => turn(i))], 1_100, true)
      expect(out[0].content).toBe('S'.repeat(100))
      expect(out.reduce((a, m) => a + m.content.length, 0)).toBeLessThanOrEqual(1_100)
      starts.add(out[1].content)
    }
    expect(starts.size).toBeLessThanOrEqual(12)
  })

  it('treats Ollama and OpenAI-compatible servers on localhost as local', () => {
    expect(isLocalModel({ provider: 'ollama', openaiBaseUrl: '' })).toBe(true)
    expect(isLocalModel({ provider: 'openai', openaiBaseUrl: 'http://localhost:1234/v1' })).toBe(true)
    expect(isLocalModel({ provider: 'openai', openaiBaseUrl: 'http://127.0.0.1:8080/v1' })).toBe(true)
    expect(isLocalModel({ provider: 'openai', openaiBaseUrl: 'https://api.openai.com/v1' })).toBe(false)
    expect(isLocalModel({ provider: 'gemini', openaiBaseUrl: 'http://localhost:1234/v1' })).toBe(false)
  })

  it('drops the oldest turns first', () => {
    const out = trimToBudget(
      [{ role: 'system', content: 's' }, { role: 'user', content: 'x'.repeat(100) }, { role: 'user', content: 'y'.repeat(100) }],
      150
    )
    expect(out).toHaveLength(2)
    expect(out[1].content[0]).toBe('y')
  })
})

describe('mergeSettings', () => {
  it('merges nested groups without dropping siblings', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { ai: { models: { gemini: 'gemini-x' } }, stt: { language: 'de' } })
    expect(s.ai.models.gemini).toBe('gemini-x')
    expect(s.ai.models.openai).toBe(DEFAULT_SETTINGS.ai.models.openai)
    expect(s.stt.language).toBe('de')
    expect(s.stt.engine).toBe(DEFAULT_SETTINGS.stt.engine)
  })
})

describe('auto-answer timing', () => {
  it('answers fast after a question, a little later after an unpunctuated one', async () => {
    const { autoAnswerDelay } = await import('../src/services/useCopilot')
    expect(autoAnswerDelay('What is Docker?')).toBeLessThanOrEqual(150)
    expect(autoAnswerDelay('Explain how Kafka guarantees message ordering.')).toBeLessThan(500)
    expect(autoAnswerDelay('Okay, thanks for that.')).toBeGreaterThan(1_000)
  })
})

describe('answer shape', () => {
  it('follows the answer style and asks for more than a bare one-liner', () => {
    const spoken = answerPrompt('How does HTTPS keep data secure?', 'You: How does HTTPS keep data secure?')
    expect(spoken).toMatch(/"Them" just said: "How does HTTPS keep data secure\?"/)
    expect(spoken).toMatch(/2 to 4 bullet points, as they would say it: the answer first, then how it works, then a concrete example/)
    expect(spoken).toMatch(/Do not repeat the question\.$/)
    expect(answerPrompt('Why?', '', 'bullets')).toMatch(/3 to 5 short bullet points/)
    expect(answerPrompt('Why?', '', 'star')).toMatch(/four bullets, \*\*Situation\*\*/)
    expect(answerPrompt('How does a Kubernetes readiness probe work?', '', 'detailed')).toMatch(/5 to 8 Markdown bullet points.*the first bullet is the direct answer/)
  })

  it('asks for bullet points in every answer style, mode and the system prompt', () => {
    for (const style of ['concise', 'detailed', 'star', 'bullets'] as const) {
      expect(answerPrompt('What is a VPC?', '', style)).toMatch(/bullet/)
      for (const mode of ['quick', 'interview', 'detailed'] as const) expect(answerPrompt('What is a VPC?', '', style, mode)).toMatch(/bullet/)
    }
    const sys = systemPrompt({ ...DEFAULT_SETTINGS.copilot }, DEFAULT_SETTINGS.profile)
    expect(sys).toMatch(/Format every answer as Markdown bullet points/)
    expect(sys).toMatch(/Only when the user asks for a specific format \(an email, a message, a script\)/)
    // Code still comes as code, with bullets after it.
    expect(answerPrompt('Write a Python script for log rotation.', '', 'detailed')).toMatch(/fenced code block, then one or two bullets/)
  })
})

describe('latest question', () => {
  it('answers the newest question, not earlier remarks', async () => {
    const { latestQuestion } = await import('../src/services/copilot/questionDetector')
    expect(
      latestQuestion('Yeah we can create a VPC with separate subnets for the public and private subnets. Can you provide a Python script for the log rotation?')
    ).toBe('Can you provide a Python script for the log rotation?')
    expect(latestQuestion('Write a Python script for log rotation. Please write.')).toBe('Write a Python script for log rotation. Please write.')
    expect(latestQuestion("Maybe I don't know. What should I have to do after?")).toBe('What should I have to do after?')
    expect(latestQuestion('I have a list of numbers. Sort it?')).toBe('I have a list of numbers. Sort it?')
  })

  it('asks for code when code is requested, whatever the answer style', () => {
    expect(answerPrompt('Can you provide a Python script for the log rotation?', '', 'bullets')).toMatch(/in a fenced code block/)
    expect(answerPrompt('Give me the kubectl command to restart a deployment', '', 'concise')).toMatch(/fenced code block/)
    expect(answerPrompt('What is a multistage build in Docker?', '', 'bullets')).not.toMatch(/fenced code block/)
  })
})
