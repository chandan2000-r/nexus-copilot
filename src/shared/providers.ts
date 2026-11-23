/** Static provider metadata shared by the main process and the Settings UI. */
import type { AnswerSpeed, LlmProviderId, SecretName, SttEngineId } from './settings'

export const ANSWER_SPEEDS: Record<AnswerSpeed, string> = {
  fast: 'Fastest (minimal thinking)',
  balanced: 'Balanced',
  thorough: 'Thorough (slowest)'
}

export interface LlmProviderMeta {
  name: string
  /** Secret holding the API key, or null when no key is needed. */
  keyName: SecretName | null
  /** True when an API key is optional (e.g. a local OpenAI-compatible server). */
  keyOptional: boolean
  suggestedModels: string[]
  hint: string
  keyUrl?: string
}

export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderMeta> = {
  openai: {
    name: 'OpenAI-compatible',
    keyName: 'openai',
    keyOptional: true,
    suggestedModels: ['gpt-5-mini', 'gpt-5-nano', 'gpt-5'],
    hint: 'OpenAI, or any OpenAI-compatible API: Groq, OpenRouter, DeepSeek, Together, LM Studio, vLLM. Change the base URL to switch.',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  anthropic: {
    name: 'Anthropic Claude',
    keyName: 'anthropic',
    keyOptional: false,
    suggestedModels: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    hint: 'Haiku is the fastest for live answers; Sonnet and Opus are stronger for hard coding problems.',
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  gemini: {
    name: 'Google Gemini',
    keyName: 'gemini',
    keyOptional: false,
    suggestedModels: ['gemini-flash-latest', 'gemini-pro-latest'],
    hint: 'The "-latest" aliases follow Google\'s newest release. Pin a version (load the list) if you need stable behaviour.',
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  ollama: {
    name: 'Ollama (local)',
    keyName: null,
    keyOptional: true,
    suggestedModels: ['llama3.2', 'qwen3', 'gemma3'],
    hint: 'Runs on this computer; nothing leaves the machine. Screenshots need a vision model (e.g. gemma3, llava, qwen2.5vl).'
  }
}

export interface SttEngineMeta {
  name: string
  keyName: SecretName
  suggestedModels: string[]
  hint: string
}

export const STT_ENGINES: Record<SttEngineId, SttEngineMeta> = {
  whisper: {
    name: 'Whisper API (OpenAI-compatible)',
    keyName: 'whisper',
    suggestedModels: ['gpt-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1', 'whisper-large-v3-turbo'],
    hint: 'Transcribes each utterance after a short pause. Works with OpenAI, Groq (very fast: base URL https://api.groq.com/openai/v1, model whisper-large-v3-turbo) and local Whisper servers. Leave the key empty to reuse the OpenAI-compatible key from the AI tab.'
  },
  deepgram: {
    name: 'Deepgram (real-time streaming)',
    keyName: 'deepgram',
    suggestedModels: ['nova-3', 'nova-2'],
    hint: 'Lowest latency: words appear while people are still talking.'
  },
  gemini: {
    name: 'Google Gemini',
    keyName: 'gemini',
    suggestedModels: ['gemini-flash-latest'],
    hint: 'Transcribes each utterance after a short pause. Uses the Gemini key from the AI tab, so one Google key can run everything.'
  }
}

export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'id', name: 'Indonesian' },
  { code: 'vi', name: 'Vietnamese' }
]
