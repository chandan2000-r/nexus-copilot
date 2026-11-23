import { apiError, readSse, request, trimSlash } from '../http'
import { sendWithFallback } from '../speed'
import type { AIProvider, ChatMessage, ChatOptions, ModelInfo } from '../types'

export interface OpenAIConfig {
  baseUrl: string
  apiKey: string | null
  model: string
  maxTokens: number
  /** `reasoning_effort` values to try, fastest first (see speed.ts). Empty = not sent. */
  reasoningEfforts?: string[]
}

/** Any OpenAI-compatible Chat Completions API: OpenAI, Groq, OpenRouter, DeepSeek, LM Studio, vLLM… */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id = 'openai'
  readonly name = 'OpenAI-compatible'
  private readonly cfg: OpenAIConfig

  constructor(cfg: OpenAIConfig) {
    this.cfg = { ...cfg, baseUrl: trimSlash(cfg.baseUrl) }
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {})
    }
  }

  /** api.openai.com rejects max_tokens on current models; most compatible servers only know max_tokens. */
  private get isOpenAI(): boolean {
    return /(^|\.)openai\.com$/.test(new URL(this.cfg.baseUrl).hostname)
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.name, `${this.cfg.baseUrl}/models`, { headers: this.headers(), signal })
    if (!res.ok) throw await apiError(res, this.name)
    const json = (await res.json()) as { data?: { id: string }[] }
    return (json.data ?? []).map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id))
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      stream: true,
      messages: messages.map(toOpenAIMessage),
      [this.isOpenAI ? 'max_completion_tokens' : 'max_tokens']: this.cfg.maxTokens
    }
    const res = await sendWithFallback({
      label: this.name,
      cacheKey: `openai|${this.cfg.baseUrl}|${this.cfg.model}`,
      candidates: this.cfg.reasoningEfforts ?? [],
      isOptionError: (msg) => /reasoning/i.test(msg),
      send: (effort) =>
        request(this.name, `${this.cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(effort ? { ...body, reasoning_effort: effort } : body),
          signal: options.signal
        })
    })
    if (!res.ok || !res.body) throw await apiError(res, this.name)
    for await (const ev of readSse(res.body)) {
      if (ev.data === '[DONE]') return
      const json = JSON.parse(ev.data) as {
        error?: { message?: string }
        choices?: { delta?: { content?: string | null } }[]
      }
      if (json.error) throw new Error(`${this.name} error: ${json.error.message ?? 'unknown error'}`)
      const text = json.choices?.[0]?.delta?.content
      if (text) yield text
    }
  }
}

export function toOpenAIMessage(m: ChatMessage) {
  if (!m.images?.length) return { role: m.role, content: m.content }
  return {
    role: m.role,
    content: [
      { type: 'text', text: m.content },
      ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } }))
    ]
  }
}
