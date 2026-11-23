export type ChatRole = 'system' | 'user' | 'assistant'

export interface ImageAttachment {
  mimeType: string
  /** Base64 data, no data: prefix. */
  data: string
}

export interface ChatMessage {
  role: ChatRole
  content: string
  /** Screenshots attached to a user message. Only providers with vision models use them. */
  images?: ImageAttachment[]
}

export interface ChatOptions {
  signal: AbortSignal
}

export interface ModelInfo {
  id: string
}

/**
 * Every LLM provider (OpenAI-compatible, Anthropic, Gemini, Ollama) implements this.
 * The UI only talks to the AIService, so providers can be added without UI changes.
 */
export interface AIProvider {
  readonly id: string
  readonly name: string
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
  /** Streams the assistant reply as text deltas. Must stop when `options.signal` aborts. */
  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string>
}
