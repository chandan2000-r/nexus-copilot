import { useEffect, useRef, useState } from 'react'
import { AnswerView } from '../components/AnswerView'
import { ChatInput, type ChatInputHandle } from '../components/ChatInput'
import { ControlBar } from '../components/ControlBar'
import { HistoryPanel } from '../components/HistoryPanel'
import { LoginPage } from '../components/LoginPage'
import { SettingsPanel } from '../components/SettingsPanel'
import { TitleBar, type View } from '../components/TitleBar'
import { TranscriptPanel } from '../components/TranscriptPanel'
import { useCopilot } from '../services/useCopilot'
import type { AccountState } from '../shared/account'
import type { CaptureStatus } from '../shared/capture'
import type { UiCommand } from '../shared/copilot'
import type { SecretsStatus } from '../shared/ipc'
import type { Settings } from '../shared/settings'

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [capture, setCapture] = useState<CaptureStatus | null>(null)
  const [secrets, setSecrets] = useState<SecretsStatus | null>(null)
  const [view, setView] = useState<View>('main')
  const [account, setAccount] = useState<AccountState | null>(null)
  const copilot = useCopilot(settings)
  const signedIn = account?.status === 'signed-in'
  const input = useRef<ChatInputHandle>(null)

  useEffect(() => {
    window.nexus.getSettings().then(setSettings)
    window.nexus.getCaptureStatus().then(setCapture)
    window.nexus.secrets.status().then(setSecrets)
    window.nexus.account.state().then(setAccount)
    const offs = [
      window.nexus.onSettingsChanged(setSettings),
      window.nexus.onCaptureStatus(setCapture),
      window.nexus.account.onChanged(setAccount)
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Commands from global shortcuts and the tray menu.
  const commandRef = useRef<(c: UiCommand) => void>(() => {})
  commandRef.current = (cmd) => {
    if (!signedIn) return
    if (cmd === 'focus') {
      setView('main')
      setTimeout(() => input.current?.focus(), 0)
    } else if (cmd === 'listen') copilot.toggleListening()
    else if (cmd === 'answer') {
      setView('main')
      copilot.answer()
    } else if (cmd === 'screen') {
      setView('main')
      void copilot.analyzeScreen()
    } else if (cmd === 'scrollUp' || cmd === 'scrollDown') {
      setView('main')
      window.dispatchEvent(new CustomEvent('nexus-scroll', { detail: cmd === 'scrollUp' ? -1 : 1 }))
    }
  }
  useEffect(() => {
    const onEvent = (e: Event) => commandRef.current((e as CustomEvent<UiCommand>).detail)
    window.addEventListener('nexus-command', onEvent)
    const off = window.nexus.onCommand((c) => commandRef.current(c))
    return () => {
      window.removeEventListener('nexus-command', onEvent)
      off()
    }
  }, [])

  // Signed out (or blocked) while listening: stop the microphone and system audio here too.
  // Signing out also clears the conversation, so the next person to sign in starts empty.
  // Runs once per change of sign-in state; the ref gives it the latest copilot functions.
  const copilotRef = useRef(copilot)
  copilotRef.current = copilot
  const status = account?.status
  useEffect(() => {
    if (!status || status === 'signed-in' || status === 'checking') return
    const c = copilotRef.current
    c.cancel()
    if (c.listening) c.toggleListening()
    if (status === 'signed-out') c.newSession()
    setView('main')
  }, [status])

  if (!settings || !account) return <div className="shell" />

  if (!signedIn) {
    return (
      <div className="shell">
        <TitleBar
          capture={capture}
          view="main"
          onView={() => {}}
          locked
          windowSize={settings.windowSize}
          opacity={settings.opacity}
          clickThrough={settings.clickThrough ? { shortcut: settings.shortcuts.toggleClickThrough } : undefined}
        />
        <LoginPage account={account} onServer={(server) => window.nexus.updateSettings({ accountServer: server })} />
      </div>
    )
  }

  return (
    <div className="shell">
      <TitleBar
        capture={capture}
        view={view}
        onView={setView}
        windowSize={settings.windowSize}
        opacity={settings.opacity}
        clickThrough={settings.clickThrough ? { shortcut: settings.shortcuts.toggleClickThrough } : undefined}
      />
      {view === 'settings' && (
        <SettingsPanel
          settings={settings}
          capture={capture}
          secrets={secrets}
          onSecrets={setSecrets}
          account={account}
          onClose={() => setView('main')}
        />
      )}
      {view === 'history' && <HistoryPanel />}
      {/* The copilot view stays mounted so listening and streaming continue behind Settings/History. */}
      <div className="main-view" hidden={view !== 'main'}>
        <ControlBar settings={settings} copilot={copilot} />
        <TranscriptPanel copilot={copilot} />
        {copilot.notice && (
          <div className="notice" role="alert">
            <span>{copilot.notice}</span>
            <button className="icon-btn small" onClick={copilot.dismissNotice} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        <AnswerView copilot={copilot} settings={settings} secrets={secrets} onOpenSettings={() => setView('settings')} />
        <ChatInput
          ref={input}
          streaming={copilot.streaming}
          screenBusy={copilot.busy === 'screen'}
          onSend={copilot.sendChat}
          onStop={copilot.cancel}
          onAnswer={copilot.answer}
          onScreen={(t) => void copilot.analyzeScreen(t)}
        />
      </div>
    </div>
  )
}
