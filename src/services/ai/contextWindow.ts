import type { ChatMessage } from './types'

/** Rough character cost of one image in the budget. */
const IMAGE_COST = 3_000

/**
 * Request budget for models on this computer: about 5k tokens, which fits Ollama's 8k context
 * (OLLAMA_NUM_CTX) with room for the answer, and keeps prompt processing short.
 */
export const LOCAL_BUDGET_CHARS = 20_000

/**
 * Index of the first item to keep so the items from there on cost at most `budget` (the last
 * item is always kept). With `step`, the start only moves to where the running total, counted
 * from the very first item, passes a multiple of `step`. Successive calls on a growing list
 * then keep the same start for a while, so a local model can reuse the work it already did on
 * that beginning (prompt caching) instead of rereading everything after every new line.
 */
export function windowStart(costs: number[], budget: number, step = 0): number {
  let after = costs.reduce((a, b) => a + b, 0)
  let before = 0
  let fits = -1
  for (let i = 0; i < costs.length; i++) {
    if (after <= budget) {
      if (fits < 0) fits = i
      if (!step || i === 0 || Math.floor(before / step) > Math.floor((before - costs[i - 1]) / step)) return i
    }
    before += costs[i]
    after -= costs[i]
  }
  return fits >= 0 ? fits : Math.max(0, costs.length - 1)
}

/**
 * Keeps the system prompt plus the most recent messages that fit in a character budget.
 * Images are only kept on the newest message that has them, so old screenshots are not
 * re-uploaded with every request. `sticky` drops old turns in steps (see windowStart); use it
 * for local models, which reuse a cached prefix.
 */
export function trimToBudget(messages: ChatMessage[], maxChars = 60_000, sticky = false): ChatMessage[] {
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')
  const lastWithImages = rest.map((m) => !!m.images?.length).lastIndexOf(true)
  const cleaned = rest.map((m, i) => (i === lastWithImages || !m.images ? m : { role: m.role, content: m.content }))
  if (!cleaned.length) return system

  const budget = maxChars - system.reduce((n, m) => n + m.content.length, 0)
  const costs = cleaned.map((m) => m.content.length + (m.images?.length ?? 0) * IMAGE_COST)
  const start = windowStart(costs, budget, sticky ? Math.max(1, Math.floor(budget / 2)) : 0)
  return [...system, ...cleaned.slice(start)]
}
