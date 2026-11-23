/**
 * Answer speed for thinking models. GPT-5 / o-series and Gemini reason silently before the first
 * visible token; left at their defaults that adds seconds to every live answer. Each model family
 * accepts different values (GPT-5 has 'minimal', GPT-5.1+ has 'none', Gemini 3 uses thinkingLevel,
 * Gemini 2.5 uses thinkingBudget), so we list candidates from fastest to safest, try them in order
 * and remember the first one the API accepts.
 */
import type { AnswerSpeed } from '../../shared/settings'
import { apiError } from './http'

const isOpenAIHost = (baseUrl: string) => {
  try {
    return /(^|\.)openai\.com$/.test(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}

/** `reasoning_effort` values to try for an OpenAI model; empty = do not send the parameter. */
export function openaiReasoningEfforts(baseUrl: string, model: string, speed: AnswerSpeed): string[] {
  const m = model.trim().toLowerCase()
  // Only api.openai.com reasoning models; other compatible servers use their own values.
  if (!isOpenAIHost(baseUrl) || !/^(gpt-5|o\d)/.test(m) || m.includes('chat')) return []
  if (speed === 'thorough') return ['medium']
  if (speed === 'balanced' || /^o\d/.test(m)) return ['low']
  // The original GPT-5 family bottoms out at 'minimal'; GPT-5.1 and later add 'none'.
  return /^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(m) ? ['minimal', 'low'] : ['none', 'minimal', 'low']
}

/** `generationConfig.thinkingConfig` values to try for a Gemini model; empty = model default. */
export function geminiThinkingConfigs(model: string, speed: AnswerSpeed): Record<string, unknown>[] {
  const m = model.replace(/^models\//, '').trim().toLowerCase()
  // Gemini 1.x / 2.0 and non-Gemini models (e.g. Gemma) have no thinking to turn down.
  if (!m.startsWith('gemini') || /^gemini-(1\.|2\.0)/.test(m) || speed === 'thorough') return []
  const v25 = /^gemini-2\.5/.test(m)
  if (speed === 'balanced') return v25 ? [{ thinkingBudget: 1024 }] : [{ thinkingLevel: 'low' }, { thinkingBudget: 1024 }]
  // 2.5 Pro cannot switch thinking off; 128 is its smallest budget.
  if (v25) return m.includes('pro') ? [{ thinkingBudget: 128 }] : [{ thinkingBudget: 0 }, { thinkingBudget: 128 }]
  // Gemini 3 and the "-latest" aliases.
  return [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, { thinkingBudget: 0 }]
}

/** Index of the candidate each model last accepted, so the fallback costs one extra request at most once. */
const accepted = new Map<string, number>()

export function resetSpeedCache(): void {
  accepted.clear()
}

/**
 * Sends the request with each candidate in turn (finally with none). Moves on only when the API
 * answers 400 and the error is about the option being varied; any other response is returned as is.
 */
export async function sendWithFallback<T>(opts: {
  label: string
  cacheKey: string
  candidates: T[]
  isOptionError: (message: string) => boolean
  send: (candidate: T | undefined) => Promise<Response>
}): Promise<Response> {
  const { label, cacheKey, candidates, isOptionError, send } = opts
  if (!candidates.length) return send(undefined)
  const options: (T | undefined)[] = [...candidates, undefined]
  for (let i = Math.min(accepted.get(cacheKey) ?? 0, options.length - 1); ; i++) {
    const res = await send(options[i])
    if (res.ok) accepted.set(cacheKey, i)
    if (res.ok || res.status !== 400 || i === options.length - 1) return res
    const err = await apiError(res, label)
    if (!isOptionError(err.message)) throw err
  }
}
