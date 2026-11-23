import { LLM_PROVIDERS } from '../../shared/providers'
import type { LlmProviderId, SecretName, Settings } from '../../shared/settings'
import { AnthropicProvider } from './providers/anthropicProvider'
import { GeminiProvider } from './providers/geminiProvider'
import { OllamaProvider } from './providers/ollamaProvider'
import { OpenAICompatibleProvider } from './providers/openaiProvider'
import { geminiThinkingConfigs, openaiReasoningEfforts } from './speed'
import type { AIProvider } from './types'

export type SecretLookup = (name: SecretName) => string | null

/** Builds a provider from current settings. Throws a user-facing message when a key is missing. */
export function createProvider(id: LlmProviderId, settings: Settings, secret: SecretLookup): AIProvider {
  const meta = LLM_PROVIDERS[id]
  const key = meta.keyName ? secret(meta.keyName) : null
  const model = settings.ai.models[id]?.trim()
  if (!model) throw new Error(`Choose a model for ${meta.name} in Settings → AI.`)
  if (meta.keyName && !key && !meta.keyOptional) {
    throw new Error(`Add your ${meta.name} API key in Settings → AI.`)
  }
  const { maxTokens, speed } = settings.ai
  switch (id) {
    case 'openai': {
      const baseUrl = settings.ai.openaiBaseUrl
      if (!key && /(^|\.)openai\.com/.test(baseUrl)) throw new Error('Add your OpenAI API key in Settings → AI.')
      const reasoningEfforts = openaiReasoningEfforts(baseUrl, model, speed)
      return new OpenAICompatibleProvider({ baseUrl, apiKey: key, model, maxTokens, reasoningEfforts })
    }
    case 'anthropic':
      return new AnthropicProvider({ apiKey: key!, model, maxTokens })
    case 'gemini':
      return new GeminiProvider({ apiKey: key!, model, thinkingConfigs: geminiThinkingConfigs(model, speed) })
    case 'ollama':
      return new OllamaProvider({ baseUrl: settings.ai.ollamaBaseUrl, model, maxTokens })
  }
}
