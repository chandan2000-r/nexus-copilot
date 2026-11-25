import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountService, KEEPALIVE_MS, OFFLINE_RETRY_MS } from '../src/services/account/AccountService'
import { DEFAULT_ACCOUNT_SERVER, normalizeServer, type AccountState } from '../src/shared/account'
import { DEFAULT_SETTINGS } from '../src/shared/settings'

// A small stand-in for the Interview Copilot backend.
const USER = { email: 'asha@example.com', password: 'correct horse', name: 'Asha Rao' }
let server: Server
let base = ''
const live = new Set<string>()
let billing: { required: boolean; access: boolean; reason: string } | null = { required: false, access: true, reason: '' }
let down = false
const calls: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      calls.push(`${req.method} ${req.url}`)
      if (down) return res.writeHead(503).end()
      const json = (code: number, o: unknown) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(o))
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      if (req.url === '/api/auth/login' && req.method === 'POST') {
        const { email, password } = JSON.parse(body)
        if (!String(email).includes('@')) return json(422, { detail: [{ msg: 'value is not a valid email address' }] })
        if (email.toLowerCase() !== USER.email || password !== USER.password) return json(401, { detail: 'Invalid email or password' })
        const t = `tok-${live.size + 1}-${Date.now()}`
        live.add(t)
        return json(200, { access_token: t, token_type: 'bearer', user: { email: USER.email } })
      }
      if (!live.has(token)) return json(401, { detail: 'Not authenticated' })
      if (req.url === '/api/auth/me') return json(200, { id: 'u1', email: USER.email, full_name: USER.name })
      if (req.url === '/api/billing') return billing ? json(200, { ...billing, plans: [] }) : json(404, { detail: 'Not Found' })
      if (req.url === '/api/auth/logout' && req.method === 'POST') {
        live.delete(token)
        return res.writeHead(204).end()
      }
      json(404, { detail: 'Not Found' })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())
beforeEach(() => {
  billing = { required: false, access: true, reason: '' }
  down = false
  calls.length = 0
})

/** Lets real network I/O finish while setTimeout/setInterval are faked (setImmediate is not). */
async function until(cond: () => boolean) {
  for (let i = 0; i < 5_000 && !cond(); i++) await new Promise((r) => setImmediate(r))
  expect(cond()).toBe(true)
}
const meCalls = () => calls.filter((c) => c === 'GET /api/auth/me').length

function make(saved: string | null = null, url = () => base) {
  let token = saved
  const states: AccountState[] = []
  const svc = new AccountService(url, { get: () => token, set: (t) => (token = t || null) }, (s) => states.push(s))
  return { svc, states, token: () => token }
}

describe('account sign-in', () => {
  it('starts signed out without a saved sign-in', async () => {
    const { svc } = make()
    expect(svc.state().status).toBe('checking')
    expect((await svc.init()).status).toBe('signed-out')
    expect(svc.allowed).toBe(false)
  })

  it('signs in, keeps the token in the main process store, and allows the app', async () => {
    const { svc, token, states } = make()
    await svc.init()
    expect(await svc.signIn('  Asha@Example.com ', USER.password)).toEqual({ ok: true })
    expect(token()).toMatch(/^tok-/)
    expect(svc.allowed).toBe(true)
    expect(svc.state()).toMatchObject({ status: 'signed-in', user: { email: USER.email, name: USER.name }, server: base })
    // The state sent to the window never contains the token.
    expect(JSON.stringify(states)).not.toContain('tok-')
    svc.dispose()
  })

  it('explains wrong passwords, bad emails and unreachable servers', async () => {
    const { svc } = make()
    expect(await svc.signIn(USER.email, 'nope')).toEqual({ ok: false, error: 'Wrong email or password.' })
    expect(await svc.signIn('not-an-email', 'x')).toEqual({ ok: false, error: 'Enter a valid email address.' })
    expect(await svc.signIn('', '')).toEqual({ ok: false, error: 'Enter your email and password.' })
    const off = make(null, () => 'http://127.0.0.1:9')
    const r = await off.svc.signIn(USER.email, USER.password)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/^Can't reach 127\.0\.0\.1:9\./)
    expect(svc.allowed).toBe(false)
  })

  it('restores a saved sign-in at start, and drops one the server has ended', async () => {
    const first = make()
    await first.svc.signIn(USER.email, USER.password)
    const saved = first.token()!
    first.svc.dispose()

    const again = make(saved)
    expect((await again.svc.init()).status).toBe('signed-in')
    again.svc.dispose()

    live.delete(saved) // e.g. expired, or signed out on another device
    const ended = make(saved)
    expect(await ended.svc.init()).toMatchObject({ status: 'signed-out', message: 'Your sign-in has ended. Please sign in again.' })
    expect(ended.token()).toBeNull()
  })

  it('applies the plan rule: blocked when subscriptions are required and the account has none', async () => {
    billing = { required: true, access: false, reason: 'Your subscription has ended.' }
    const { svc } = make()
    expect(await svc.signIn(USER.email, USER.password)).toEqual({ ok: true })
    expect(svc.state()).toMatchObject({ status: 'no-access', message: 'Your subscription has ended.' })
    expect(svc.allowed).toBe(false)
    billing = { required: true, access: true, reason: '' }
    await svc.init()
    expect(svc.allowed).toBe(true)
    billing = null // an older server without billing: signing in is enough
    await svc.init()
    expect(svc.allowed).toBe(true)
    svc.dispose()
  })

  it('signs out on the server too', async () => {
    const { svc, token } = make()
    await svc.signIn(USER.email, USER.password)
    const t = token()!
    await svc.signOut()
    expect(token()).toBeNull()
    expect(svc.state().status).toBe('signed-out')
    expect(live.has(t)).toBe(false)
    expect(calls).toContain('POST /api/auth/logout')
  })

  it('forgets the sign-in when the server address changes', async () => {
    const { svc, token } = make()
    await svc.signIn(USER.email, USER.password)
    svc.serverChanged()
    expect(token()).toBeNull()
    expect(svc.allowed).toBe(false)
  })

  it('stays signed in through network blips, but not when the server ends the sign-in', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    try {
      const { svc, token } = make()
      await svc.signIn(USER.email, USER.password)
      const n = meCalls()
      down = true
      await vi.advanceTimersByTimeAsync(KEEPALIVE_MS)
      await until(() => meCalls() === n + 1)
      await new Promise((r) => setImmediate(r))
      expect(svc.allowed).toBe(true) // a 503 during an interview does not lock the user out
      down = false
      await vi.advanceTimersByTimeAsync(KEEPALIVE_MS)
      await until(() => meCalls() === n + 2)
      live.delete(token()!)
      await vi.advanceTimersByTimeAsync(KEEPALIVE_MS)
      await until(() => svc.state().status === 'signed-out')
      expect(svc.state().message).toBe('Your sign-in has ended. Please sign in again.')
      svc.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for the server when it cannot be reached at start, and retries by itself', async () => {
    const first = make()
    await first.svc.signIn(USER.email, USER.password)
    first.svc.dispose()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      down = true
      const { svc } = make(first.token())
      expect((await svc.init()).status).toBe('offline')
      expect(svc.allowed).toBe(false)
      down = false
      await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS)
      await until(() => svc.state().status === 'signed-in')
      svc.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('account server address', () => {
  it('accepts https and local http only', () => {
    expect(normalizeServer('copilot.example.com/')).toBe('https://copilot.example.com')
    expect(normalizeServer(' https://copilot.example.com/app/ ')).toBe('https://copilot.example.com/app')
    expect(normalizeServer('http://localhost:8000')).toBe('http://localhost:8000')
    expect(normalizeServer('http://copilot.example.com')).toBeNull()
    expect(normalizeServer('https://user:pw@copilot.example.com')).toBeNull()
    expect(normalizeServer('')).toBeNull()
    expect(DEFAULT_SETTINGS.accountServer).toBe(DEFAULT_ACCOUNT_SERVER)
  })
})
