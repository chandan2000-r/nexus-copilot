/**
 * Sign-in with an Interview Copilot account. The account server checks the email and password,
 * and whether the account may use the app (the same plan rules as the website).
 */

export const DEFAULT_ACCOUNT_SERVER = 'https://copilot.tailccb1cc.ts.net'

/**
 * 'checking' = verifying a saved sign-in; 'offline' = the server could not be reached to verify it;
 * 'no-access' = signed in, but the account's plan does not allow using the app.
 */
export type AccountStatus = 'checking' | 'signed-out' | 'signed-in' | 'no-access' | 'offline'

export interface AccountUser {
  email: string
  name: string
}

export interface AccountState {
  status: AccountStatus
  /** Account server address, e.g. https://copilot.example.com */
  server: string
  user?: AccountUser
  /** Why the user is signed out / blocked / offline, shown on the sign-in page. */
  message?: string
}

export type SignInResult = { ok: true } | { ok: false; error: string }

/** Pages of the account website the app can open in the browser. */
export type AccountWebPage = 'home' | 'billing'

/**
 * Cleans up a server address. Accepts https://, and http:// only for this computer (a development
 * server). Returns null when it is not usable.
 */
export function normalizeServer(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
    if (u.username || u.password || u.search || u.hash) return null
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}
