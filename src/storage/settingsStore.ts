/**
 * Settings persistence. Settings are a small document, so they live in a JSON file in the
 * user-data folder (written atomically). API keys are NOT stored here; see secretStore.ts.
 */
import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normalizeServer } from '../shared/account'
import { ANSWER_SPEEDS, LLM_PROVIDERS, STT_ENGINES } from '../shared/providers'
import {
  DEFAULT_SETTINGS,
  MAX_PROFILE_FIELD,
  MIN_OPACITY,
  mergeSettings,
  type Settings,
  type SettingsPatch
} from '../shared/settings'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const MODES = ['interview', 'coding', 'meeting', 'sales', 'general']
const STYLES = ['concise', 'detailed', 'star', 'bullets']

function str(v: unknown, fallback: string, max = 2_000): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback
}

export function sanitize(raw: Partial<Settings>): Settings {
  const s = mergeSettings(DEFAULT_SETTINGS, (raw ?? {}) as SettingsPatch)
  s.bounds = raw?.bounds ?? null
  s.opacity = clamp(Number(s.opacity) || DEFAULT_SETTINGS.opacity, MIN_OPACITY, 1)
  if (s.bounds) {
    const { x, y, width, height } = s.bounds
    if (![x, y, width, height].every(Number.isFinite)) s.bounds = null
  }
  const d = DEFAULT_SETTINGS
  s.accountServer = normalizeServer(str(s.accountServer, d.accountServer, 500)) ?? d.accountServer
  if (!(s.ai.provider in LLM_PROVIDERS)) s.ai.provider = d.ai.provider
  for (const id of Object.keys(LLM_PROVIDERS) as (keyof typeof LLM_PROVIDERS)[]) {
    s.ai.models[id] = str(s.ai.models[id], d.ai.models[id], 200).trim()
  }
  s.ai.openaiBaseUrl = str(s.ai.openaiBaseUrl, d.ai.openaiBaseUrl, 500).trim() || d.ai.openaiBaseUrl
  s.ai.ollamaBaseUrl = str(s.ai.ollamaBaseUrl, d.ai.ollamaBaseUrl, 500).trim() || d.ai.ollamaBaseUrl
  s.ai.maxTokens = Math.round(clamp(Number(s.ai.maxTokens) || d.ai.maxTokens, 256, 32_000))
  if (!(s.ai.speed in ANSWER_SPEEDS)) s.ai.speed = d.ai.speed
  if (!(s.stt.engine in STT_ENGINES)) s.stt.engine = d.stt.engine
  s.stt.whisperBaseUrl = str(s.stt.whisperBaseUrl, d.stt.whisperBaseUrl, 500).trim() || d.stt.whisperBaseUrl
  for (const k of ['whisperModel', 'deepgramModel', 'geminiModel', 'language', 'themDevice', 'micDevice'] as const) {
    s.stt[k] = str(s.stt[k], d.stt[k], 300)
  }
  s.stt.themDevice ||= 'system'
  s.stt.language ||= 'auto'
  if (!MODES.includes(s.copilot.mode)) s.copilot.mode = d.copilot.mode
  if (!STYLES.includes(s.copilot.answerStyle)) s.copilot.answerStyle = d.copilot.answerStyle
  s.copilot.responseLanguage = str(s.copilot.responseLanguage, '', 60)
  for (const k of ['role', 'company', 'resume', 'jobDescription', 'instructions'] as const) {
    s.profile[k] = str(s.profile[k], '', MAX_PROFILE_FIELD)
  }
  for (const k of Object.keys(d.shortcuts) as (keyof Settings['shortcuts'])[]) {
    s.shortcuts[k] = str(s.shortcuts[k], d.shortcuts[k], 100)
  }
  for (const k of ['alwaysOnTop', 'captureExclusion', 'hideActivity', 'launchAtLogin', 'startHidden', 'rememberPosition'] as const) {
    s[k] = typeof s[k] === 'boolean' ? s[k] : d[k]
  }
  return s
}

export class SettingsStore {
  private readonly file: string
  private data: Settings
  private timer: NodeJS.Timeout | null = null

  constructor(file = join(app.getPath('userData'), 'settings.json')) {
    this.file = file
    this.data = this.read()
  }

  get(): Settings {
    return structuredClone(this.data)
  }

  set(patch: Partial<Settings>, { debounce = false } = {}): Settings {
    this.data = sanitize({ ...this.data, ...patch })
    if (debounce) {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.flush(), 400)
    } else {
      this.flush()
    }
    return this.get()
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('[settings] write failed', err)
    }
  }

  private read(): Settings {
    try {
      return sanitize(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      return structuredClone(DEFAULT_SETTINGS)
    }
  }
}
