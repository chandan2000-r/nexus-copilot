import type { AnswerSpeed } from '../../../shared/settings'
import { apiError, readLines, request, trimSlash } from '../http'
import { sendWithFallback } from '../speed'
import type { AIProvider, ChatMessage, ChatOptions, ModelInfo } from '../types'

export interface OllamaConfig {
  baseUrl: string
  model: string
  maxTokens: number
  speed?: AnswerSpeed
}

/** Keeps the model in memory between answers; loading it again costs seconds on every question. */
export const OLLAMA_KEEP_ALIVE = '30m'
/**
 * Context window for every request: room for the profile, transcript and answer (see
 * LOCAL_BUDGET_CHARS). It must be the same on every call, or Ollama reloads the model.
 */
export const OLLAMA_NUM_CTX = 8192
/**
 * Small local models drift (mixing in an earlier answer, inventing details) at their default
 * temperature (~0.7–0.8). 0.2 keeps live answers on the question; measured on qwen2.5:3b.
 */
export const OLLAMA_TEMPERATURE = 0.2

/** `think` values to try, fastest first; empty = model default. Models that never think accept `false`. */
export function ollamaThinkValues(model: string, speed: AnswerSpeed = 'fast'): (boolean | string)[] {
  if (speed === 'thorough') return []
  // gpt-oss cannot switch thinking off; 'low' is its fastest level.
  return /^gpt-oss/i.test(model.trim()) ? ['low'] : [false]
}

interface InstalledModel {
  name: string
  capabilities?: string[]
}

/** "llama3.2" and "llama3.2:latest" are the same model. */
const sameModel = (a: string, b: string) => {
  const norm = (m: string) => (m.includes(':') ? m : `${m}:latest`).toLowerCase()
  return norm(a.trim()) === norm(b.trim())
}

/** Local models through Ollama (Llama, Qwen, Gemma…). Streams NDJSON from /api/chat. */
export class OllamaProvider implements AIProvider {
  readonly id = 'ollama'
  readonly name = 'Ollama'
  private readonly cfg: OllamaConfig

  constructor(cfg: OllamaConfig) {
    this.cfg = { ...cfg, baseUrl: trimSlash(cfg.baseUrl) }
  }

  private async installed(signal?: AbortSignal): Promise<InstalledModel[]> {
    const res = await this.call(`${this.cfg.baseUrl}/api/tags`, { signal })
    if (!res.ok) throw await apiError(res, this.name)
    const json = (await res.json()) as { models?: InstalledModel[] }
    return json.models ?? []
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    return (await this.installed(signal)).map((m) => ({ id: m.name }))
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    const model = await this.modelFor(messages, options.signal)
    const res = await this.post(model, messages, this.cfg.maxTokens, true, options.signal)
    if (!res.ok || !res.body) throw await this.error(res, model, options.signal)
    for await (const line of readLines(res.body)) {
      if (!line.trim()) continue
      const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string }
      if (json.error) throw new Error(`Ollama error: ${json.error}`)
      if (json.message?.content) yield json.message.content
      if (json.done) return
    }
  }

  /**
   * Loads the model and processes `messages` without answering, so a following request that
   * starts with the same messages only has to read what is new (Ollama reuses the cached prefix).
   */
  async prefill(messages: ChatMessage[], signal: AbortSignal): Promise<void> {
    const res = await this.post(this.cfg.model, messages.map(({ role, content }) => ({ role, content })), 1, false, signal)
    await res.text().catch(() => '')
  }

  private async post(model: string, messages: ChatMessage[], numPredict: number, stream: boolean, signal: AbortSignal) {
    return sendWithFallback<boolean | string>({
      label: this.name,
      cacheKey: `ollama|${this.cfg.baseUrl}|${model}`,
      candidates: ollamaThinkValues(model, this.cfg.speed),
      isOptionError: (m) => /think/i.test(m),
      send: (think) =>
        this.call(`${this.cfg.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream,
            keep_alive: OLLAMA_KEEP_ALIVE,
            ...(think === undefined ? {} : { think }),
            options: { num_ctx: OLLAMA_NUM_CTX, num_predict: numPredict, temperature: OLLAMA_TEMPERATURE },
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
              ...(m.images?.length ? { images: m.images.map((i) => i.data) } : {})
            }))
          }),
          signal
        })
    })
  }

  /** Screenshots need a vision model: if the chosen one cannot see, use an installed one that can. */
  private async modelFor(messages: ChatMessage[], signal: AbortSignal): Promise<string> {
    const model = this.cfg.model
    if (!messages.some((m) => m.images?.length)) return model
    const installed = await this.installed(signal).catch(() => null)
    const caps = installed?.find((m) => sameModel(m.name, model))?.capabilities
    // Older Ollama versions do not report capabilities: send as is.
    if (!installed || !caps || caps.includes('vision')) return model
    const vision = installed.find((m) => m.capabilities?.includes('vision'))
    if (!vision) {
      throw new Error(
        `${model} cannot read screenshots. Install a vision model (in Terminal: ollama pull gemma3:4b) and try again, or choose one in Settings → AI.`
      )
    }
    return vision.name
  }

  private async error(res: Response, model: string, signal: AbortSignal): Promise<Error> {
    const err = await apiError(res, this.name)
    if (res.status !== 404 || !/not found/i.test(err.message)) return err
    const names = (await this.installed(signal).catch(() => [])).map((m) => m.name)
    return new Error(
      `Ollama has no model "${model}". ` +
        (names.length ? `Installed: ${names.join(', ')}. Choose one in Settings → AI, or run` : 'In Terminal, run') +
        ` "ollama pull ${model}".`
    )
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await request(this.name, url, init)
    } catch (err) {
      const e = err as Error
      if (e.name === 'AbortError' || e.name === 'TimeoutError' || !e.message.startsWith('Could not reach')) throw err
      throw new Error(`${e.message} Start Ollama (open the Ollama app, or run "ollama serve" in Terminal).`)
    }
  }
}
