import { apiError, readSse, request } from '../http'
import type { AIProvider, ChatMessage, ChatOptions, ModelInfo } from '../types'

export interface AnthropicConfig {
  apiKey: string
  model: string
  maxTokens: number
  baseUrl?: string
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/** Anthropic Messages API with streaming. */
export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic'
  readonly name = 'Anthropic'
  private readonly cfg: AnthropicConfig

  constructor(cfg: AnthropicConfig) {
    this.cfg = cfg
  }

  private get base(): string {
    return this.cfg.baseUrl ?? 'https://api.anthropic.com'
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01' }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.name, `${this.base}/v1/models?limit=100`, { headers: this.headers(), signal })
    if (!res.ok) throw await apiError(res, this.name)
    const json = (await res.json()) as { data?: { id: string }[] }
    return (json.data ?? []).map((m) => ({ id: m.id }))
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    const { system, turns } = toAnthropic(messages)
    const res = await request(this.name, `${this.base}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: this.cfg.maxTokens,
        ...(system ? { system } : {}),
        messages: turns,
        stream: true
      }),
      signal: options.signal
    })
    if (!res.ok || !res.body) throw await apiError(res, this.name)
    for await (const ev of readSse(res.body)) {
      const json = JSON.parse(ev.data) as {
        type: string
        delta?: { type?: string; text?: string }
        error?: { message?: string }
      }
      if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' && json.delta.text) yield json.delta.text
      else if (json.type === 'error') throw new Error(`${this.name} error: ${json.error?.message ?? 'unknown error'}`)
      else if (json.type === 'message_stop') return
    }
  }
}

/** System messages go to the top-level `system` field; turns must start with the user. */
export function toAnthropic(messages: ChatMessage[]): {
  system: string
  turns: { role: 'user' | 'assistant'; content: Block[] }[]
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const turns: { role: 'user' | 'assistant'; content: Block[] }[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (turns.length === 0 && m.role === 'assistant') continue
    const blocks: Block[] = [
      ...(m.images ?? []).map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mimeType, data: img.data }
      })),
      { type: 'text', text: m.content || '…' }
    ]
    const last = turns[turns.length - 1]
    if (last && last.role === m.role) last.content.push(...blocks)
    else turns.push({ role: m.role, content: blocks })
  }
  return { system, turns }
}
