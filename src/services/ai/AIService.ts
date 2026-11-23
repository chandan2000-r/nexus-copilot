import type { ModelListResult, ProviderTestResult } from '../../shared/ipc'
import { isLocalModel } from '../../shared/providers'
import type { LlmProviderId, Settings } from '../../shared/settings'
import { LOCAL_BUDGET_CHARS, trimToBudget } from './contextWindow'
import { createProvider, type SecretLookup } from './registry'
import type { ChatMessage } from './types'

/** A repeated identical prefill is skipped unless this long has passed (the model may have been unloaded). */
const PREFILL_REFRESH_MS = 20 * 60_000

/** Local models get a smaller budget that keeps its start stable (prompt cache). */
const fitToModel = (s: Settings, messages: ChatMessage[]) =>
  isLocalModel(s.ai) ? trimToBudget(messages, LOCAL_BUDGET_CHARS, true) : trimToBudget(messages)

export interface StreamHandlers {
  onDelta(text: string): void
  onDone(): void
  onError(message: string): void
}

/**
 * Routes chat requests to the provider chosen in Settings. Lives in the main process, so
 * API keys never reach the renderer and requests are not subject to renderer CORS.
 */
export class AIService {
  private inflight = new Map<string, AbortController>()
  private prefillNext: ChatMessage[] | null = null
  private prefillRunning = false
  private lastPrefill = { key: '', at: 0 }

  constructor(
    private readonly settings: () => Settings,
    private readonly secret: SecretLookup
  ) {}

  async send(requestId: string, messages: ChatMessage[], handlers: StreamHandlers): Promise<void> {
    const controller = new AbortController()
    this.inflight.set(requestId, controller)
    this.prefillNext = null
    try {
      const s = this.settings()
      const provider = createProvider(s.ai.provider, s, this.secret)
      for await (const delta of provider.chat(fitToModel(s, messages), { signal: controller.signal })) {
        if (controller.signal.aborted) break
        handlers.onDelta(delta)
      }
      handlers.onDone()
    } catch (err) {
      if (controller.signal.aborted) handlers.onDone()
      else handlers.onError((err as Error).message)
    } finally {
      this.inflight.delete(requestId)
    }
  }

  /**
   * Local models: process the start of the next request in the background (see useCopilot), so
   * the answer only waits for the question itself. One at a time; a newer call replaces a queued
   * one, and nothing is sent while an answer is streaming. Best effort: errors show up on the
   * real request instead.
   */
  prefill(messages: ChatMessage[]): void {
    this.prefillNext = messages
    if (!this.prefillRunning) void this.runPrefills()
  }

  private async runPrefills(): Promise<void> {
    this.prefillRunning = true
    try {
      for (let msgs = this.prefillNext; msgs; msgs = this.prefillNext) {
        this.prefillNext = null
        if (this.inflight.size) continue
        try {
          const s = this.settings()
          if (!isLocalModel(s.ai)) continue
          const provider = createProvider(s.ai.provider, s, this.secret)
          if (!provider.prefill) continue
          const fitted = fitToModel(s, msgs)
          const key = JSON.stringify([s.ai.provider, s.ai.models[s.ai.provider], s.ai.ollamaBaseUrl, s.ai.speed, fitted])
          if (key === this.lastPrefill.key && Date.now() - this.lastPrefill.at < PREFILL_REFRESH_MS) continue
          await provider.prefill(fitted, AbortSignal.timeout(120_000))
          this.lastPrefill = { key, at: Date.now() }
        } catch {
          /* best effort */
        }
      }
    } finally {
      this.prefillRunning = false
    }
  }

  async listModels(id: LlmProviderId): Promise<ModelListResult> {
    try {
      const s = this.settings()
      // Listing models does not need a model to be chosen yet.
      const withModel = { ...s, ai: { ...s.ai, models: { ...s.ai.models, [id]: s.ai.models[id] || 'x' } } }
      const models = await createProvider(id, withModel, this.secret).listModels(AbortSignal.timeout(15_000))
      return { ok: true, models: models.map((m) => m.id) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /** Sends a tiny prompt to check the key, model and endpoint. */
  async test(id: LlmProviderId): Promise<ProviderTestResult> {
    const started = Date.now()
    try {
      const provider = createProvider(id, this.settings(), this.secret)
      let reply = ''
      const signal = AbortSignal.timeout(45_000)
      for await (const d of provider.chat([{ role: 'user', content: 'Reply with exactly: OK' }], { signal })) {
        reply += d
        if (reply.length > 200) break
      }
      if (!reply.trim()) return { ok: false, error: 'The model returned an empty reply. Try a larger max tokens value or another model.' }
      return { ok: true, ms: Date.now() - started, reply: reply.trim().slice(0, 200) }
    } catch (err) {
      const e = err as Error
      return { ok: false, error: e.name === 'TimeoutError' ? 'Timed out after 45 s.' : e.message }
    }
  }

  cancel(requestId: string): void {
    this.inflight.get(requestId)?.abort()
  }

  cancelAll(): void {
    for (const c of this.inflight.values()) c.abort()
  }
}
