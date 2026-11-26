import { DEFAULT_ACCOUNT_SERVER } from './account'
import type { WindowSize } from './windowSize'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ShortcutSettings {
  /** Show / hide the overlay without stealing focus. */
  toggleWindow: string
  /** Show the overlay and focus the chat input. */
  focusInput: string
  /** Move the overlay to the next display. */
  nextDisplay: string
  /** Answer the latest question heard in the transcript. */
  answerNow: string
  /** Capture the screen and ask the AI about it (coding problems, slides, errors). */
  analyzeScreen: string
  /** Start or stop listening. */
  toggleListening: string
  /** Switch the window between the small, medium and large sizes. */
  cycleWindowSize: string
}

/** Chat / answer providers. 'openai' is any OpenAI-compatible API (OpenAI, Groq, OpenRouter, LM Studio…). */
export type LlmProviderId = 'openai' | 'anthropic' | 'gemini' | 'ollama'
/**
 * Speech-to-text engines. 'local' runs NVIDIA Parakeet on this computer (no key, no network after a
 * one-time model download). 'whisper' is any OpenAI-compatible /audio/transcriptions API.
 */
export type SttEngineId = 'local' | 'whisper' | 'deepgram' | 'gemini'
/** Names of API keys kept in the encrypted secret store (never sent to the renderer). */
export type SecretName = 'openai' | 'anthropic' | 'gemini' | 'deepgram' | 'whisper'

export type CopilotMode = 'interview' | 'coding' | 'meeting' | 'sales' | 'general'
export type AnswerStyle = 'concise' | 'detailed' | 'star' | 'bullets'

/**
 * How long thinking models (OpenAI GPT-5 / o-series, Gemini) reason before answering.
 * 'fast' = the least the model allows, so the first words appear quickly.
 */
export type AnswerSpeed = 'fast' | 'balanced' | 'thorough'

export interface AiSettings {
  provider: LlmProviderId
  /** Model per provider, so switching providers keeps each one's choice. */
  models: Record<LlmProviderId, string>
  openaiBaseUrl: string
  ollamaBaseUrl: string
  maxTokens: number
  speed: AnswerSpeed
}

export interface SttSettings {
  engine: SttEngineId
  whisperBaseUrl: string
  whisperModel: string
  deepgramModel: string
  geminiModel: string
  /** ISO 639-1 code, or 'auto'. */
  language: string
  /** Transcribe the other side of the call. */
  captureThem: boolean
  /** 'system' = system audio loopback; otherwise an audio input deviceId (e.g. BlackHole, VB-Cable). */
  themDevice: string
  /** Transcribe your own microphone. */
  captureYou: boolean
  /** Microphone deviceId, '' = system default. */
  micDevice: string
}

export interface CopilotSettings {
  mode: CopilotMode
  /** Answer automatically when the other side finishes asking a question. */
  autoAnswer: boolean
  answerStyle: AnswerStyle
  /** Language for answers. '' = the language the question was asked in. */
  responseLanguage: string
  saveSessions: boolean
}

export interface ProfileSettings {
  role: string
  company: string
  resume: string
  jobDescription: string
  instructions: string
}

export interface Settings {
  /** Interview Copilot server that accounts sign in to (see shared/account.ts). */
  accountServer: string
  alwaysOnTop: boolean
  captureExclusion: boolean
  /**
   * Keep the app out of recent activity: no Dock icon / Cmd+Tab entry / Dock recent apps on
   * macOS, no taskbar button on Windows, and its recent-documents list cleared.
   */
  hideActivity: boolean
  /** 0.3 – 1.0 */
  opacity: number
  /** Window size preset in use, or 'custom' after the window was resized by dragging. */
  windowSize: WindowSize
  shortcuts: ShortcutSettings
  launchAtLogin: boolean
  startHidden: boolean
  rememberPosition: boolean
  /** Display the window was last placed on (Electron display id). */
  displayId: number | null
  bounds: WindowBounds | null
  ai: AiSettings
  stt: SttSettings
  copilot: CopilotSettings
  profile: ProfileSettings
}

export const DEFAULT_WIDTH = 440
export const DEFAULT_HEIGHT = 640
export const MIN_OPACITY = 0.3
export const MAX_PROFILE_FIELD = 40_000

export const DEFAULT_SETTINGS: Settings = {
  accountServer: DEFAULT_ACCOUNT_SERVER,
  alwaysOnTop: true,
  captureExclusion: true,
  hideActivity: true,
  opacity: 0.96,
  windowSize: 'medium',
  shortcuts: {
    toggleWindow: 'CommandOrControl+Shift+Space',
    focusInput: 'CommandOrControl+Shift+J',
    nextDisplay: 'CommandOrControl+Alt+Shift+M',
    answerNow: 'CommandOrControl+Shift+Return',
    analyzeScreen: 'CommandOrControl+Shift+H',
    toggleListening: 'CommandOrControl+Shift+L',
    cycleWindowSize: 'CommandOrControl+Alt+Shift+W'
  },
  launchAtLogin: false,
  startHidden: false,
  rememberPosition: true,
  displayId: null,
  bounds: null,
  ai: {
    provider: 'openai',
    models: {
      openai: 'gpt-5-mini',
      anthropic: 'claude-haiku-5-5',
      gemini: 'gemini-flash-latest',
      ollama: 'qwen2.5:3b'
    },
    openaiBaseUrl: 'https://api.openai.com/v1',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    maxTokens: 4096,
    speed: 'fast'
  },
  stt: {
    engine: 'local',
    whisperBaseUrl: 'https://api.openai.com/v1',
    whisperModel: 'gpt-transcribe',
    deepgramModel: 'nova-3',
    geminiModel: 'gemini-flash-latest',
    language: 'auto',
    captureThem: true,
    themDevice: 'system',
    captureYou: false,
    micDevice: ''
  },
  copilot: {
    mode: 'interview',
    autoAnswer: true,
    answerStyle: 'detailed',
    responseLanguage: '',
    saveSessions: true
  },
  profile: {
    role: '',
    company: '',
    resume: '',
    jobDescription: '',
    instructions: ''
  }
}

type Nested = 'shortcuts' | 'ai' | 'stt' | 'copilot' | 'profile'

/** Settings the renderer is allowed to change directly. Nested groups are merged, not replaced. */
export type SettingsPatch = Partial<Omit<Settings, 'bounds' | Nested>> & {
  shortcuts?: Partial<ShortcutSettings>
  ai?: Partial<Omit<AiSettings, 'models'>> & { models?: Partial<AiSettings['models']> }
  stt?: Partial<SttSettings>
  copilot?: Partial<CopilotSettings>
  profile?: Partial<ProfileSettings>
}

/** Applies a patch on top of current settings, merging the nested groups. */
export function mergeSettings(prev: Settings, patch: SettingsPatch): Settings {
  return {
    ...prev,
    ...patch,
    shortcuts: { ...prev.shortcuts, ...(patch.shortcuts ?? {}) },
    ai: {
      ...prev.ai,
      ...(patch.ai ?? {}),
      models: { ...prev.ai.models, ...(patch.ai?.models ?? {}) }
    },
    stt: { ...prev.stt, ...(patch.stt ?? {}) },
    copilot: { ...prev.copilot, ...(patch.copilot ?? {}) },
    profile: { ...prev.profile, ...(patch.profile ?? {}) },
    bounds: prev.bounds
  }
}
