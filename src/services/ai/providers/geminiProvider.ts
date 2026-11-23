import { apiError, readSse, request } from '../http'
import { sendWithFallback } from '../speed'
import type { AIProvider, ChatMessage, ChatOptions, ModelInfo } from '../types'

export interface GeminiConfig {
  apiKey: string
  model: string
  baseUrl?: string
  /** `thinkingConfig` values to try, fastest first (see speed.ts). Empty = model default. */
  thinkingConfigs?: Record<string, unknown>[]
}

type Part = { text: string; thought?: boolean } | { inlineData: { mimeType: string; data: string } }

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

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
    const model = encodeURIComponent(this.cfg.model.replace(/^models\//, ''))
    const body = toGemini(messages)
    const res = await sendWithFallback({
      label: this.name,
      cacheKey: `gemini|${this.base}|${model}`,
      candidates: this.cfg.thinkingConfigs ?? [],
      isOptionError: (msg) => /think|budget/i.test(msg),
      send: (thinkingConfig) =>
        request(this.name, `${this.base}/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(thinkingConfig ? { ...body, generationConfig: { thinkingConfig } } : body),
          signal: options.signal
        })
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
