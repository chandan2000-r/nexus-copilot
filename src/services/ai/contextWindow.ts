import type { ChatMessage } from './types'

/** Rough character cost of one image in the budget. */
const IMAGE_COST = 3_000

/**
 * Keeps the system prompt plus the most recent messages that fit in a character budget.
 * Images are only kept on the newest message that has them, so old screenshots are not
 * re-uploaded with every request.
 */
export function trimToBudget(messages: ChatMessage[], maxChars = 60_000): ChatMessage[] {
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')
  const lastWithImages = rest.map((m) => !!m.images?.length).lastIndexOf(true)
  const cleaned = rest.map((m, i) => (i === lastWithImages || !m.images ? m : { role: m.role, content: m.content }))

  let used = system.reduce((n, m) => n + m.content.length, 0)
  const kept: ChatMessage[] = []
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const m = cleaned[i]
    used += m.content.length + (m.images?.length ?? 0) * IMAGE_COST
    if (used > maxChars && kept.length > 0) break
    kept.unshift(m)
  }
  return [...system, ...kept]
}
