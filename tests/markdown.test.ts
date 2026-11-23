import { describe, expect, it } from 'vitest'
import { inlineText, parseInline, parseMarkdown } from '../src/services/copilot/markdown'

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, lists and code', () => {
    const md = [
      '## Approach',
      'Use a **hash map** and `two pointers`.',
      '',
      '1. First step',
      '2. Second step',
      '   - nested a',
      '   - nested b',
      '3. Third',
      '',
      '```python',
      'def f(x):',
      '    return x',
      '```',
      'Done.'
    ].join('\n')
    const blocks = parseMarkdown(md)
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'list', 'code', 'p'])
    const list = blocks[2] as Extract<(typeof blocks)[number], { t: 'list' }>
    expect(list.ordered).toBe(true)
    expect(list.items).toHaveLength(3)
    expect(list.items[1].children[0].t).toBe('list')
    const code = blocks[3] as Extract<(typeof blocks)[number], { t: 'code' }>
    expect(code.lang).toBe('python')
    expect(code.v).toBe('def f(x):\n    return x')
    expect(code.open).toBe(false)
  })

  it('treats an unterminated fence (still streaming) as open code', () => {
    const blocks = parseMarkdown('Here:\n```js\nconst a = 1')
    const code = blocks[1] as Extract<(typeof blocks)[number], { t: 'code' }>
    expect(code.open).toBe(true)
    expect(code.v).toBe('const a = 1')
  })

  it('parses tables and quotes', () => {
    const blocks = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n\n> note')
    expect(blocks[0].t).toBe('table')
    expect(blocks[1].t).toBe('quote')
  })

  it('does not treat "- " paragraphs after text as broken lists', () => {
    const blocks = parseMarkdown('Points:\n- a\n- b')
    expect(blocks.map((b) => b.t)).toEqual(['p', 'list'])
  })
})

describe('parseInline', () => {
  it('handles bold, italic, code and links', () => {
    const n = parseInline('**Situation**: I *led* the `db` [migration](https://x.y)')
    expect(n.map((x) => x.t)).toEqual(['strong', 'text', 'em', 'text', 'code', 'text', 'link'])
    expect(inlineText(n)).toBe('Situation: I led the db migration')
  })

  it('leaves snake_case and lone asterisks alone', () => {
    expect(inlineText(parseInline('use my_var_name and 2 * 3'))).toBe('use my_var_name and 2 * 3')
    expect(parseInline('use my_var_name').every((x) => x.t === 'text')).toBe(true)
  })
})
