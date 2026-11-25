import { useState } from 'react'
import type { AccountState } from '../shared/account'
import type { CaptureStatus } from '../shared/capture'
import type { SecretsStatus } from '../shared/ipc'
import type { Settings, SettingsPatch } from '../shared/settings'
import { AccountTab } from './settings/AccountTab'
import { AiTab } from './settings/AiTab'
import { AudioTab } from './settings/AudioTab'
import { GeneralTab } from './settings/GeneralTab'
import { ProfileTab } from './settings/ProfileTab'

type Tab = 'ai' | 'audio' | 'profile' | 'general' | 'account'
const TABS: [Tab, string][] = [
  ['ai', 'AI'],
  ['audio', 'Audio'],
  ['profile', 'Profile'],
  ['general', 'General'],
  ['account', 'Account']
]

interface Props {
  settings: Settings
  capture: CaptureStatus | null
  secrets: SecretsStatus | null
  onSecrets(s: SecretsStatus): void
  account: AccountState
  onClose(): void
}

export function SettingsPanel({ settings, capture, secrets, onSecrets, account, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('ai')
  const update = (patch: SettingsPatch) => window.nexus.updateSettings(patch)
  return (
    <main className="settings">
      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {tab === 'ai' && <AiTab settings={settings} secrets={secrets} onSecrets={onSecrets} update={update} />}
        {tab === 'audio' && <AudioTab settings={settings} secrets={secrets} onSecrets={onSecrets} update={update} />}
        {tab === 'profile' && <ProfileTab settings={settings} update={update} />}
        {tab === 'general' && <GeneralTab settings={settings} capture={capture} update={update} />}
        {tab === 'account' && <AccountTab account={account} />}
        <button className="done-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </main>
  )
}
