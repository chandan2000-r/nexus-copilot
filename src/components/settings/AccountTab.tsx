import { useState } from 'react'
import type { AccountState } from '../../shared/account'
import { Row } from './fields'

const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function AccountTab({ account }: { account: AccountState }) {
  const [busy, setBusy] = useState(false)
  return (
    <>
      <h2>Account</h2>
      <Row label="Signed in as" hint={account.user?.name || undefined}>
        <span className="account-email">{account.user?.email}</span>
      </Row>
      <Row label="Server" hint="Your Interview Copilot account server. Change it from the sign-in page after signing out.">
        <span className="account-email">{host(account.server)}</span>
      </Row>
      <div className="test-row">
        <button className="mini-btn" onClick={() => window.nexus.account.openWeb('home')}>
          Manage account
        </button>
        <button
          className="mini-btn danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await window.nexus.account.signOut()
          }}
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
      <p className="section-hint">Signing out stops listening and ends this sign-in on the server too.</p>
    </>
  )
}
