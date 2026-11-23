import { apiError, readLines, request, trimSlash } from '../http'
import type { AIProvider, ChatMessage, ChatOptions, ModelInfo } from '../types'

export interface OllamaConfig {
  baseUrl: string
  model: string
  maxTokens: number
}

/** Local models through Ollama (Llama, Qwen, Gemma…). Streams NDJSON from /api/chat. */
export class OllamaProvider implements AIProvider {
  readonly id = 'ollama'
  readonly name = 'Ollama'
  private readonly cfg: OllamaConfig

  constructor(cfg: OllamaConfig) {
    this.cfg = { ...cfg, baseUrl: trimSlash(cfg.baseUrl) }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.name, `${this.cfg.baseUrl}/api/tags`, { signal })
    if (!res.ok) throw await apiError(res, this.name)
    const json = (await res.json()) as { models?: { name: string }[] }
    return (json.models ?? []).map((m) => ({ id: m.name }))
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    const res = await request(this.name, `${this.cfg.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.cfg.model,
        stream: true,
        options: { num_predict: this.cfg.maxTokens },
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.images?.length ? { images: m.images.map((i) => i.data) } : {})
        }))
      }),
      signal: options.signal
    })
    if (!res.ok || !res.body) throw await apiError(res, this.name)
    for await (const line of readLines(res.body)) {
      if (!line.trim()) continue
      const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string }
      if (json.error) throw new Error(`Ollama error: ${json.error}`)
      if (json.message?.content) yield json.message.content
      if (json.done) return
    }
  }
}
