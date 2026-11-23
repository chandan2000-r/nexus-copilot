import type { AnswerSpeed } from '../../../shared/settings'
import { apiError, isRetryableStatus, readSse, request } from '../http'
import { geminiThinkingConfigs, sendWithFallback } from '../speed'
import type { AIProvider, ChatMessage, ChatOptions, ModelInfo } from '../types'

export interface GeminiConfig {
  apiKey: string
  model: string
  baseUrl?: string
  /** How much the model may think before answering (see speed.ts). Unset = model default. */
  speed?: AnswerSpeed
}

type Part = { text: string; thought?: boolean } | { inlineData: { mimeType: string; data: string } }

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Lighter, stable model tried when the chosen one is overloaded (503 "high demand"). */
export const GEMINI_OVERLOAD_FALLBACK = 'gemini-3.5-flash-lite'

/**
 * POSTs to `models/<model>:<method>` with the fastest thinking setting the model accepts for
 * `speed`. If Google still reports the model overloaded after request()'s retries, tries the
 * lighter fallback model once. Errors always describe the chosen model's failure.
 */
export async function geminiRequest(opts: {
  label: string
  base: string
  apiKey: string
  model: string
  method: string
  body: Record<string, unknown>
  speed?: AnswerSpeed
  signal?: AbortSignal
}): Promise<Response> {
  const { label, base, apiKey, body, speed, signal } = opts
  const chosen = opts.model.replace(/^models\//, '')
  const send = (model: string) =>
    sendWithFallback({
      label,
      cacheKey: `gemini|${base}|${model}`,
      candidates: speed ? geminiThinkingConfigs(model, speed) : [],
      isOptionError: (msg) => /think|budget/i.test(msg),
      send: (thinkingConfig) =>
        request(label, `${base}/models/${encodeURIComponent(model)}:${opts.method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(
            thinkingConfig
              ? { ...body, generationConfig: { ...(body.generationConfig as object | undefined), thinkingConfig } }
              : body
          ),
          signal
        })
    })
  const res = await send(chosen)
  if (res.ok || !isRetryableStatus(res.status) || !chosen.startsWith('gemini') || chosen === GEMINI_OVERLOAD_FALLBACK) return res
  const original = await apiError(res, label)
  try {
    const alt = await send(GEMINI_OVERLOAD_FALLBACK)
    if (alt.ok) return alt
    await alt.body?.cancel().catch(() => {})
  } catch (err) {
    if (signal?.aborted) throw err
  }
  throw original
}

/** Google Gemini API (generativelanguage.googleapis.com) with SSE streaming. */
export class GeminiProvider implements AIProvider {
  readonly id = 'gemini'
  readonly name = 'Gemini'
  private readonly cfg: GeminiConfig

  constructor(cfg: GeminiConfig) {
    this.cfg = cfg
  }

  private get base(): string {
    return this.cfg.baseUrl ?? GEMINI_BASE
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', 'x-goog-api-key': this.cfg.apiKey }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.name, `${this.base}/models?pageSize=200`, { headers: this.headers(), signal })
    if (!res.ok) throw await apiError(res, this.name)
    const json = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
    return (json.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, '') }))
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    const res = await geminiRequest({
      label: this.name,
      base: this.base,
      apiKey: this.cfg.apiKey,
      model: this.cfg.model,
      method: 'streamGenerateContent?alt=sse',
      body: toGemini(messages),
      speed: this.cfg.speed,
      signal: options.signal
    })
    if (!res.ok || !res.body) throw await apiError(res, this.name)
    let produced = false
    let blocked: string | undefined
    for await (const ev of readSse(res.body)) {
      const json = JSON.parse(ev.data) as {
        candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]
        promptFeedback?: { blockReason?: string }
        error?: { message?: string }
      }
      if (json.error) throw new Error(`${this.name} error: ${json.error.message ?? 'unknown error'}`)
      blocked ??= json.promptFeedback?.blockReason
      for (const part of json.candidates?.[0]?.content?.parts ?? []) {
        if ('text' in part && part.text && !part.thought) {
          produced = true
          yield part.text
        }
      }
    }
    if (!produced && blocked) throw new Error(`Gemini blocked the request (${blocked}).`)
  }
}

export function toGemini(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const contents: { role: 'user' | 'model'; parts: Part[] }[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    const role = m.role === 'assistant' ? 'model' : 'user'
    const parts: Part[] = [
      ...(m.images ?? []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
      { text: m.content || '…' }
    ]
    const last = contents[contents.length - 1]
    if (last && last.role === role) last.parts.push(...parts)
    else contents.push({ role, parts })
  }
  return { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents }
}
