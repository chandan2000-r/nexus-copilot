import { memo, useMemo, useState } from 'react'
import { type Block, type Inline, parseMarkdown } from '../services/copilot/markdown'
import { CheckIcon, CopyIcon } from './icons'

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="copy-btn"
      title={label}
      aria-label={label}
      onClick={() => {
        window.nexus.copyText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? <CheckIcon width={13} height={13} /> : <CopyIcon width={13} height={13} />}
    </button>
  )
}

function renderInline(nodes: Inline[], key = ''): React.ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`
    switch (n.t) {
      case 'text':
        return n.v
      case 'code':
        return <code key={k}>{n.v}</code>
      case 'strong':
        return <strong key={k}>{renderInline(n.c, k)}</strong>
      case 'em':
        return <em key={k}>{renderInline(n.c, k)}</em>
      case 'link':
        // Links are shown, not followed: the overlay never navigates.
        return (
          <span key={k} className="md-link" title={n.href}>
            {renderInline(n.c, k)}
          </span>
        )
    }
  })
}

function renderBlock(b: Block, key: string): React.ReactNode {
  switch (b.t) {
    case 'p':
      return (
        <p key={key}>
          {b.lines.map((l, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {renderInline(l, `${key}-${i}-`)}
            </span>
          ))}
        </p>
      )
    case 'h': {
      const H = (`h${Math.min(6, b.level + 2)}` as 'h3')
      return <H key={key}>{renderInline(b.c)}</H>
    }
    case 'code':
      return (
        <div key={key} className="md-code">
          <div className="md-code-head">
            <span>{b.lang || 'code'}</span>
            <CopyButton text={b.v} label="Copy code" />
          </div>
          <pre>
            <code>{b.v}</code>
          </pre>
        </div>
      )
    case 'list': {
      const items = b.items.map((it, i) => (
        <li key={i}>
          {renderInline(it.c, `${key}-${i}-`)}
          {it.children.map((c, j) => renderBlock(c, `${key}-${i}-${j}`))}
        </li>
      ))
      return b.ordered ? (
        <ol key={key} start={b.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      )
    }
    case 'quote':
      return <blockquote key={key}>{b.c.map((c, i) => renderBlock(c, `${key}-${i}`))}</blockquote>
    case 'hr':
      return <hr key={key} />
    case 'table':
      return (
        <div key={key} className="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i}>{renderInline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{renderInline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return <div className="md">{blocks.map((b, i) => renderBlock(b, String(i)))}</div>
})

export { CopyButton }
