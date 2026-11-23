import { describe, expect, it } from 'vitest'
import { trimToBudget } from '../src/services/ai/contextWindow'
import { answerPrompt, buildMessages, formatTranscript, systemPrompt } from '../src/services/copilot/prompts'
import { looksLikeQuestion, questionSnippet } from '../src/services/copilot/questionDetector'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/shared/settings'

describe('looksLikeQuestion', () => {
  it.each([
    'So tell me about yourself.',
    'Can you walk me through your last project',
    'What is the difference between a process and a thread?',
    'Great. Now, describe a time you disagreed with your manager.',
    'How would you design a URL shortener',
    'Okay thanks for that. Why do you want to work here'
  ])('detects: %s', (q) => expect(looksLikeQuestion(q)).toBe(true))

  it.each(['Okay, great.', 'Yeah', 'That makes sense, thanks for sharing that with us.', 'Let me share my screen now.'])(
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
