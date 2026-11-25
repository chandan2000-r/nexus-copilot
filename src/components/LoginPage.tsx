import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AccountState } from '../shared/account'
import { normalizeServer } from '../shared/account'

interface Props {
  account: AccountState
  onServer(server: string): Promise<unknown>
}

const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Shown instead of the app until an Interview Copilot account is signed in and allowed. */
export function LoginPage({ account, onServer }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editServer, setEditServer] = useState(false)
  const [server, setServer] = useState(account.server)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => setServer(account.server), [account.server])
  useEffect(() => {
    if (account.status === 'signed-out') emailRef.current?.focus()
  }, [account.status])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await window.nexus.account.signIn(email, password).catch((err: Error) => ({ ok: false as const, error: err.message }))
    setBusy(false)
    if (res.ok) setPassword('')
    else setError(res.error)
  }

  const saveServer = async () => {
    const s = normalizeServer(server)
    if (!s) {
      setError('Enter the server address, e.g. https://copilot.example.com')
      return
    }
    setError(null)
    await onServer(s)
    setEditServer(false)
  }

  const head = (
    <div className="login-head">
      <span className="brand-mark login-mark" aria-hidden />
      <h1>Sign in to Nexus AI</h1>
      <p>Use your Interview Copilot account.</p>
    </div>
  )

  if (account.status === 'checking') {
    return (
      <div className="login">
        {head}
        <p className="login-status">Checking your sign-in…</p>
      </div>
    )
  }

  if (account.status === 'offline') {
    return (
      <div className="login">
        {head}
        <p className="login-error" role="alert">
          {account.message}
        </p>
        <p className="login-status">Trying again automatically every 30 seconds.</p>
        <div className="login-actions">
          <button className="mini-btn primary" onClick={() => void window.nexus.account.retry()}>
            Try again now
          </button>
          <button className="mini-btn" onClick={() => void window.nexus.account.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (account.status === 'no-access') {
    return (
      <div className="login">
        {head}
        <p className="login-status">
          Signed in as <b>{account.user?.email}</b>
        </p>
        <p className="login-error" role="alert">
          {account.message}
        </p>
        <div className="login-actions">
          <button className="mini-btn primary" onClick={() => window.nexus.account.openWeb('billing')}>
            Open plans
          </button>
          <button className="mini-btn" onClick={() => void window.nexus.account.retry()}>
            Check again
          </button>
          <button className="mini-btn" onClick={() => void window.nexus.account.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <form className="login" onSubmit={submit}>
      {head}
      {account.message && !error && <p className="login-status">{account.message}</p>}
      <label className="login-field">
        <span>Email</span>
        <input
          ref={emailRef}
          className="field"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          required
        />
      </label>
      <label className="login-field">
        <span>Password</span>
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          required
        />
      </label>
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      <button className="mini-btn primary login-submit" type="submit" disabled={busy || !email.trim() || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="login-links">
        <button type="button" className="link-btn" onClick={() => window.nexus.account.openWeb('home')}>
          Forgot password?
        </button>
        <span>No account? Ask your administrator.</span>
      </p>
      <div className="login-server">
        {editServer ? (
          <>
            <input
              className="field mono"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              aria-label="Account server"
              spellCheck={false}
            />
            <button type="button" className="mini-btn" onClick={() => void saveServer()}>
              Save
            </button>
          </>
        ) : (
          <>
            <span>Server: {host(account.server)}</span>
            <button type="button" className="link-btn" onClick={() => setEditServer(true)}>
              Change
            </button>
          </>
        )}
      </div>
    </form>
  )
}
