/**
 * API keys, encrypted with Electron safeStorage (macOS Keychain, Windows DPAPI).
 * Keys stay in the main process: the renderer can only ask whether a key is saved.
 */
import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SecretsStatus } from '../shared/ipc'
import type { SecretName } from '../shared/settings'

const NAMES: SecretName[] = ['openai', 'anthropic', 'gemini', 'deepgram', 'whisper']
/** Secrets only the main process uses: the renderer can neither set nor see them. */
export type InternalSecret = 'accountToken'
type Stored = SecretName | InternalSecret
type Entry = { enc: 'os' | 'plain'; v: string }

export class SecretStore {
  private readonly file = join(app.getPath('userData'), 'secrets.json')
  private data: Partial<Record<Stored, Entry>> = {}
  private cache = new Map<Stored, string>()

  constructor() {
    try {
      this.data = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      this.data = {}
    }
  }

  static isName(name: unknown): name is SecretName {
    return typeof name === 'string' && (NAMES as string[]).includes(name)
  }

  private get canEncrypt(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  get(name: Stored): string | null {
    if (this.cache.has(name)) return this.cache.get(name)!
    const e = this.data[name]
    if (!e) return null
    try {
      const value = e.enc === 'os' ? safeStorage.decryptString(Buffer.from(e.v, 'base64')) : e.v
      this.cache.set(name, value)
      return value
    } catch (err) {
      console.warn(`[secrets] could not decrypt ${name}`, err)
      return null
    }
  }

  set(name: Stored, value: string): void {
    const v = value.trim()
    this.cache.delete(name)
    if (!v) delete this.data[name]
    else if (this.canEncrypt) this.data[name] = { enc: 'os', v: safeStorage.encryptString(v).toString('base64') }
    else this.data[name] = { enc: 'plain', v }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  status(): SecretsStatus {
    const saved = Object.fromEntries(NAMES.map((n) => [n, !!this.data[n]])) as Record<SecretName, boolean>
    return { saved, encryption: this.canEncrypt ? 'os' : 'plain' }
  }
}
