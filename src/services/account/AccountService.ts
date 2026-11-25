/**
 * Interview Copilot account sign-in, in the main process. The access token never reaches the
 * renderer; it is kept encrypted in the secret store.
 *
 * Server API (Interview Copilot backend):
 *   POST /api/auth/login {email, password} → {access_token}
 *   GET  /api/auth/me      (Bearer) → {email, full_name}      401 = sign-in ended
 *   GET  /api/billing      (Bearer) → {required, access, reason}
 *   POST /api/auth/logout  (Bearer)
 * Sign-ins end after a fixed lifetime or after a period without use, so while the app runs it
 * checks in regularly. A network blip never signs anyone out mid-interview; only the server
 * saying the sign-in has ended does.
 */
import type { AccountState, AccountUser, SignInResult } from '../../shared/account'

export interface TokenStore {
  get(): string | null
  /** '' removes the token. */
  set(token: string): void
}

/** Well inside the server's 120-minute idle limit. */
export const KEEPALIVE_MS = 15 * 60_000
/** While the server can't be reached, check again this often. */
export const OFFLINE_RETRY_MS = 30_000
const TIMEOUT_MS = 15_000

type Mode = 'startup' | 'signin' | 'keepalive'

async function errorDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: unknown }
    return typeof j.detail === 'string' ? j.detail : ''
  } catch {
    return ''
  }
}

export class AccountService {
  private s: AccountState
  private timer: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly server: () => string,
    private readonly tokens: TokenStore,
    private readonly onChange: (s: AccountState) => void,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a)
  ) {
    this.s = { status: 'checking', server: this.base() }
  }

  /** May the app be used right now? Checked by every main-process feature entry point. */
  get allowed(): boolean {
    return this.s.status === 'signed-in'
  }

  state(): AccountState {
    return { ...this.s, server: this.base() }
  }

  private base(): string {
    return this.server().replace(/\/+$/, '')
  }

  private host(): string {
    try {
      return new URL(this.base()).host
    } catch {
      return this.base()
    }
  }

  private set(next: Omit<AccountState, 'server'>): void {
    this.s = { ...next, server: this.base() }
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    if (next.status === 'offline' && this.tokens.get()) {
      this.retry = setTimeout(() => void this.init(), OFFLINE_RETRY_MS)
      this.retry.unref?.()
    }
    this.onChange(this.state())
  }

  private request(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (init.token) headers.Authorization = `Bearer ${init.token}`
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    return this.fetchFn(`${this.base()}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  }

  /** Checks the saved sign-in (app start, or "Try again" after being offline). */
  async init(): Promise<AccountState> {
    const token = this.tokens.get()
    if (!token) {
      this.set({ status: 'signed-out' })
      return this.state()
    }
    this.set({ status: 'checking', user: this.s.user })
    await this.verify(token, 'startup')
    return this.state()
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const e = email.trim()
    if (!e || !password) return { ok: false, error: 'Enter your email and password.' }
    let res: Response
    try {
      res = await this.request('/api/auth/login', { method: 'POST', body: { email: e, password } })
    } catch {
      return { ok: false, error: `Can't reach ${this.host()}. Check your internet connection and try again.` }
    }
    if (!res.ok) {
      const detail = await errorDetail(res)
      if (res.status === 401) return { ok: false, error: 'Wrong email or password.' }
      if (res.status === 422) return { ok: false, error: 'Enter a valid email address.' }
      if (res.status === 429) return { ok: false, error: detail || 'Too many attempts. Wait a minute and try again.' }
      if (res.status === 404) return { ok: false, error: `${this.host()} is not an Interview Copilot server. Check the server address.` }
      return { ok: false, error: detail || `Sign-in failed (server error ${res.status}). Try again in a moment.` }
    }
    let token = ''
    try {
      token = String(((await res.json()) as { access_token?: unknown }).access_token ?? '')
    } catch {
      /* handled below */
    }
    if (!token) return { ok: false, error: `${this.host()} sent an unexpected reply. Check the server address.` }
    this.tokens.set(token)
    await this.verify(token, 'signin')
    if (this.s.status === 'offline') return { ok: false, error: this.s.message ?? 'Could not finish signing in.' }
    return { ok: true }
  }

  async signOut(): Promise<void> {
    const token = this.tokens.get()
    this.forget('signed-out')
    if (token) {
      // Ends the sign-in on the server too, so the token stops working everywhere.
      await this.request('/api/auth/logout', { method: 'POST', token }).catch(() => {})
    }
  }

  /** The server address changed: a token from the old server means nothing to the new one. */
  serverChanged(): void {
    this.forget('signed-out')
  }

  dispose(): void {
    this.stopKeepAlive()
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
  }

  private forget(status: 'signed-out', message?: string): void {
    this.tokens.set('')
    this.stopKeepAlive()
    this.set({ status, ...(message ? { message } : {}) })
  }

  private async verify(token: string, mode: Mode): Promise<void> {
    let me: Response
    try {
      me = await this.request('/api/auth/me', { token })
    } catch {
      if (mode === 'keepalive') return
      this.set({ status: 'offline', message: `Can't reach ${this.host()} to check your sign-in. Check your internet connection, then try again.` })
      return
    }
    if (this.tokens.get() !== token) return // signed out (or in again) meanwhile
    if (me.status === 401) {
      this.forget('signed-out', mode === 'signin' ? 'The server did not accept the sign-in. Try again.' : 'Your sign-in has ended. Please sign in again.')
      return
    }
    if (!me.ok) {
      if (mode === 'keepalive') return
      this.set({ status: 'offline', message: `${this.host()} had a problem (error ${me.status}). Try again in a moment.` })
      return
    }
    let user: AccountUser
    try {
      const j = (await me.json()) as { email?: unknown; full_name?: unknown }
      user = { email: String(j.email ?? ''), name: String(j.full_name ?? '') }
    } catch {
      if (mode !== 'keepalive') this.set({ status: 'offline', message: `${this.host()} sent an unexpected reply.` })
      return
    }

    // The same plan rule as the website: when subscriptions are required, an account needs one.
    let blocked: string | null = null
    try {
      const b = await this.request('/api/billing', { token })
      if (b.ok) {
        const j = (await b.json()) as { required?: unknown; access?: unknown; reason?: unknown }
        if (j.required === true && j.access === false) blocked = String(j.reason || 'Your account does not have an active plan.')
      }
    } catch {
      /* the account was just confirmed; a failed plan check is not a reason to lock anyone out */
    }
    if (this.tokens.get() !== token) return
    this.set(blocked ? { status: 'no-access', user, message: blocked } : { status: 'signed-in', user })
    this.startKeepAlive()
  }

  private startKeepAlive(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      const token = this.tokens.get()
      if (token) void this.verify(token, 'keepalive')
    }, KEEPALIVE_MS)
    this.timer.unref?.()
  }

  private stopKeepAlive(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
