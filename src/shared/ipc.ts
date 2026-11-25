import type { AccountState, AccountWebPage, SignInResult } from './account'
import type { CaptureStatus } from './capture'
import type { BookmarkItem, ScreenCapture, SessionRecord, SessionSearchHit, SessionSummary, Speaker, SttEvent, UiCommand } from './copilot'
import type { LlmProviderId, SecretName, Settings, SettingsPatch, ShortcutSettings } from './settings'
import type { ChatMessage } from '../services/ai/types'

export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',
  captureStatus: 'capture:status',
  captureStatusChanged: 'capture:status-changed',
  shortcutStatus: 'shortcuts:status',
  windowHide: 'window:hide',
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
  displaysList: 'displays:list',
  moveToDisplay: 'window:move-to-display',
  uiCommand: 'ui:command',
  aiSend: 'ai:send',
  aiCancel: 'ai:cancel',
  aiEvent: 'ai:event',
  aiModels: 'ai:models',
  aiTest: 'ai:test',
  aiPrefill: 'ai:prefill',
  secretsStatus: 'secrets:status',
  secretsSet: 'secrets:set',
  mediaAccess: 'media:access',
  screenCapture: 'screen:capture',
  sttStart: 'stt:start',
  sttAudio: 'stt:audio',
  sttStop: 'stt:stop',
  sttEvent: 'stt:event',
  sttModelStatus: 'stt:model-status',
  sttModelDownload: 'stt:model-download',
  sessionsList: 'sessions:list',
  sessionsGet: 'sessions:get',
  sessionsSave: 'sessions:save',
  sessionsDelete: 'sessions:delete',
  sessionsExport: 'sessions:export',
  sessionsSearch: 'sessions:search',
  sessionsBookmarks: 'sessions:bookmarks',
  importProfileFile: 'file:import-profile',
  accountState: 'account:state',
  accountChanged: 'account:changed',
  accountSignIn: 'account:sign-in',
  accountSignOut: 'account:sign-out',
  accountRetry: 'account:retry',
  accountOpenWeb: 'account:open-web',
  copyText: 'clipboard:write'
} as const

export interface DisplayInfo {
  id: number
  label: string
  primary: boolean
  current: boolean
  bounds: { x: number; y: number; width: number; height: number }
}

export type ShortcutStatus = Record<keyof ShortcutSettings, { accelerator: string; registered: boolean }>

export interface AISendRequest {
  requestId: string
  messages: ChatMessage[]
}

export type AIStreamEvent =
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'error'; message: string }

export interface SecretsStatus {
  /** Which API keys are saved. The keys themselves never leave the main process. */
  saved: Record<SecretName, boolean>
  /** 'os' = encrypted with the OS keychain / DPAPI; 'plain' = stored unencrypted (no OS support). */
  encryption: 'os' | 'plain'
}

export type ModelListResult = { ok: true; models: string[] } | { ok: false; error: string }
export type ProviderTestResult = { ok: true; ms: number; reply: string } | { ok: false; error: string }
export type MediaAccessResult = { granted: boolean; status: string }
export type SttStartResult = { ok: true } | { ok: false; error: string }

/** The speech model used by on-this-computer transcription. */
export interface LocalModelStatus {
  state: 'missing' | 'downloading' | 'ready' | 'error'
  /** Bytes on disk (or downloaded so far) and the full size. */
  received: number
  total: number
  error?: string
}
export type ImportedFile = { name: string; text: string } | { error: string } | null

/** API exposed on `window.nexus` by the preload script. */
export interface NexusBridge {
  platform: string
  getSettings(): Promise<Settings>
  updateSettings(patch: SettingsPatch): Promise<Settings>
  onSettingsChanged(cb: (s: Settings) => void): () => void
  getCaptureStatus(): Promise<CaptureStatus>
  onCaptureStatus(cb: (s: CaptureStatus) => void): () => void
  getShortcutStatus(): Promise<ShortcutStatus>
  hideWindow(): void
  minimizeWindow(): void
  closeWindow(): void
  listDisplays(): Promise<DisplayInfo[]>
  moveToDisplay(id: number): Promise<void>
  onCommand(cb: (cmd: UiCommand) => void): () => void
  copyText(text: string): void
  ai: {
    send(req: AISendRequest): void
    cancel(requestId: string): void
    onEvent(cb: (e: AIStreamEvent) => void): () => void
    models(provider: LlmProviderId): Promise<ModelListResult>
    test(provider: LlmProviderId): Promise<ProviderTestResult>
    /** Local models: let the model read the start of the next request while people talk. */
    prefill(messages: ChatMessage[]): void
  }
  secrets: {
    status(): Promise<SecretsStatus>
    /** Pass '' to remove the key. */
    set(name: SecretName, value: string): Promise<SecretsStatus>
  }
  media: {
    /** macOS: asks for microphone permission. Other platforms: always granted. */
    requestMicAccess(): Promise<MediaAccessResult>
    captureScreen(): Promise<ScreenCapture>
  }
  stt: {
    start(source: Speaker): Promise<SttStartResult>
    /** 16 kHz mono signed 16-bit PCM. */
    audio(source: Speaker, pcm: ArrayBuffer): void
    stop(source: Speaker): Promise<void>
    onEvent(cb: (e: SttEvent) => void): () => void
    /** On-this-computer transcription: is the speech model downloaded? */
    modelStatus(): Promise<LocalModelStatus>
    /** Starts (or joins) the one-time speech model download. */
    downloadModel(): Promise<LocalModelStatus>
  }
  sessions: {
    list(): Promise<SessionSummary[]>
    get(id: string): Promise<SessionRecord | null>
    save(record: SessionRecord): Promise<void>
    delete(id: string): Promise<void>
    exportMarkdown(id: string): Promise<boolean>
    /** Case-insensitive search through titles, questions, answers and transcripts. */
    search(query: string): Promise<SessionSearchHit[]>
    /** Bookmarked answers across all sessions, newest first. */
    bookmarks(): Promise<BookmarkItem[]>
  }
  importProfileFile(): Promise<ImportedFile>
  account: {
    state(): Promise<AccountState>
    onChanged(cb: (s: AccountState) => void): () => void
    signIn(email: string, password: string): Promise<SignInResult>
    signOut(): Promise<void>
    /** Checks the saved sign-in again (after being offline). */
    retry(): Promise<AccountState>
    /** Opens the account website in the browser (password reset, plans). */
    openWeb(page: AccountWebPage): void
  }
}
