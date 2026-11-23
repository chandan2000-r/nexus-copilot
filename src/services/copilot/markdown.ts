/**
 * A small Markdown parser for model answers: paragraphs, headings, lists (nested), fenced
 * code, block quotes, tables, rules, and inline code / bold / italic / links.
 * Produces a tree rendered as React elements (never raw HTML), and tolerates the
 * half-finished Markdown seen while an answer is still streaming.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; c: Inline[]; href: string }

export interface ListItem {
  c: Inline[]
  children: Block[]
}

export type Block =
  | { t: 'p'; lines: Inline[][] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'code'; lang: string; v: string; open: boolean }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'quote'; c: Block[] }
  | { t: 'hr' }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

const FENCE = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const LIST = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const indentOf = (s: string) => s.length - s.trimStart().length

export function parseMarkdown(src: string): Block[] {
  return parseBlocks(src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'))
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]
      const body: string[] = []
      i++
      let open = true
      while (i < lines.length) {
        if (lines[i].trim().startsWith(marker) && lines[i].trim().replace(/[`~]/g, '') === '') {
          open = false
          i++
          break
        }
        body.push(lines[i])
        i++
      }
      const pad = Math.min(indentOf(line), ...body.filter((b) => b.trim()).map(indentOf))
      blocks.push({ t: 'code', lang: fence[2] ?? '', v: body.map((b) => b.slice(pad)).join('\n'), open })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ t: 'h', level: heading[1].length, c: parseInline(heading[2]) })
      i++
      continue
    }

    if (HR.test(line)) {
      blocks.push({ t: 'hr' })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const inner: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(QUOTE.exec(lines[i])![1]), i++
      blocks.push({ t: 'quote', c: parseBlocks(inner) })
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i])), i++
      blocks.push({ t: 'table', head, rows })
      continue
    }

    if (LIST.test(line)) {
      const [list, next] = parseList(lines, i)
      blocks.push(list)
      i = next
      continue
    }

    const para: Inline[][] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !HR.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !(para.length > 0 && LIST.test(lines[i]))
    ) {
      para.push(parseInline(lines[i].trim()))
      i++
    }
    if (para.length === 0) {
      // A line that only looked like a block start; show it as text.
      para.push(parseInline(lines[i].trim()))
      i++
    }
    blocks.push({ t: 'p', lines: para })
  }
  return blocks
}

function splitRow(line: string): Inline[][] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((cell) => parseInline(cell.trim()))
}

function parseList(lines: string[], from: number): [Block, number] {
  const first = LIST.exec(lines[from])!
  const base = first[1].length
  const ordered = /\d/.test(first[2])
  const list: Block & { t: 'list' } = { t: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] }
  let i = from
  while (i < lines.length) {
    const line = lines[i]
    const m = LIST.exec(line)
    if (m && m[1].length === base) {
      if (/\d/.test(m[2]) !== ordered) break
      list.items.push({ c: parseInline(m[3]), children: [] })
      i++
      continue
    }
    if (!line.trim()) {
      // A blank line continues the list only if more of it follows.
      let j = i + 1
      while (j < lines.length && !lines[j].trim()) j++
      const n = j < lines.length ? lines[j] : ''
      const nm = LIST.exec(n)
      if (n && (indentOf(n) > base || (nm && nm[1].length === base && /\d/.test(nm[2]) === ordered))) {
        i = j
        continue
      }
      break
    }
    if (indentOf(line) > base && list.items.length) {
      // Nested content: everything indented deeper than this list.
      const sub: string[] = []
      while (i < lines.length && (indentOf(lines[i]) > base || !lines[i].trim())) {
        if (!lines[i].trim()) {
          let j = i + 1
          while (j < lines.length && !lines[j].trim()) j++
          if (j >= lines.length || indentOf(lines[j]) <= base) break
        }
        sub.push(lines[i])
        i++
      }
      const pad = Math.min(...sub.filter((s) => s.trim()).map(indentOf))
      const item = list.items[list.items.length - 1]
      const children = parseBlocks(sub.map((s) => s.slice(pad)))
      // Plain continuation text joins the item; real blocks nest under it.
      if (children.length === 1 && children[0].t === 'p' && !LIST.test(sub[0])) {
        for (const l of children[0].lines) item.c.push({ t: 'text', v: ' ' }, ...l)
      } else {
        item.children.push(...children)
      }
      continue
    }
    break
  }
  return [list, i]
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf })
    buf = ''
  }
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < s.length && /[\\`*_[\]()#+\-.!|]/.test(s[i + 1])) {
      buf += s[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      let ticks = 1
      while (s[i + ticks] === '`') ticks++
      const marker = '`'.repeat(ticks)
      const end = s.indexOf(marker, i + ticks)
      if (end > i) {
        flush()
        out.push({ t: 'code', v: s.slice(i + ticks, end).trim() })
        i = end + ticks
        continue
      }
    }
    if ((ch === '*' || ch === '_') && s[i + 1] === ch) {
      const marker = ch + ch
      const end = s.indexOf(marker, i + 2)
      if (end > i + 2 && s[i + 2] !== ' ') {
        flush()
        out.push({ t: 'strong', c: parseInline(s.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if ((ch === '*' || ch === '_') && s[i + 1] && s[i + 1] !== ' ' && s[i + 1] !== ch && (ch === '*' || !/\w/.test(s[i - 1] ?? ''))) {
      const end = findEmphasisEnd(s, ch, i + 1)
      if (end > 0) {
        flush()
        out.push({ t: 'em', c: parseInline(s.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    if (ch === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(s.slice(i))
      if (m) {
        flush()
        out.push({ t: 'link', c: parseInline(m[1]), href: m[2] })
        i += m[0].length
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
  return out
}

function findEmphasisEnd(s: string, ch: string, from: number): number {
  for (let j = from + 1; j < s.length; j++) {
    if (s[j] !== ch || s[j - 1] === ' ' || s[j - 1] === '\\') continue
    if (ch === '*' && s[j + 1] === '*') {
      j++
      continue
    }
    if (ch === '_' && /\w/.test(s[j + 1] ?? '')) continue
    return j
  }
  return -1
}

/** Plain text of inline nodes (for copy / titles). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inlineText(n.c))).join('')
}
