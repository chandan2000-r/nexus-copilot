import {
  app,
  type BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { writeFile } from 'node:fs/promises'
import { AIService } from '../services/ai/AIService'
import { asInt16 } from '../services/stt/audio'
import { TranscriptionService } from '../services/stt/TranscriptionService'
import type { SessionRecord, Speaker } from '../shared/copilot'
import { IPC, type AISendRequest, type AIStreamEvent } from '../shared/ipc'
import { LLM_PROVIDERS } from '../shared/providers'
import { mergeSettings, type LlmProviderId, type Settings, type SettingsPatch } from '../shared/settings'
import { SecretStore } from '../storage/secretStore'
import { SessionStore, sessionToMarkdown } from '../storage/sessionStore'
import { SettingsStore } from '../storage/settingsStore'
import { CaptureGuard } from './captureGuard'
import { captureScreen, requestMicAccess, setupMediaPermissions } from './media'
import { importProfileFile } from './profileImport'
import { registerShortcuts, shortcutStatus } from './shortcuts'
import { AppTray } from './tray'
import {
  applyAlwaysOnTop,
  createOverlayWindow,
  listDisplays,
  moveToDisplay,
  showPassive
} from './windowManager'

// Separate data folder for tests and side-by-side dev profiles.
if (process.env.NEXUS_USER_DATA) app.setPath('userData', process.env.NEXUS_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let win: BrowserWindow | null = null
  let guard: CaptureGuard | null = null
  let tray: AppTray | null = null
  let store: SettingsStore
  let secrets: SecretStore
  let sessions: SessionStore
  let ai: AIService
  let transcription: TranscriptionService

  const fromOverlay = (e: IpcMainEvent | IpcMainInvokeEvent) => !!win && e.sender === win.webContents
  const isSpeaker = (s: unknown): s is Speaker => s === 'them' || s === 'you'
  const isProvider = (p: unknown): p is LlmProviderId => typeof p === 'string' && p in LLM_PROVIDERS

  function applyLoginItem(s: Settings) {
    if (!app.isPackaged) return // would register the bare Electron binary in dev
    if (app.getLoginItemSettings().openAtLogin === s.launchAtLogin) return
    try {
      app.setLoginItemSettings({ openAtLogin: s.launchAtLogin })
    } catch (err) {
      console.warn('[startup] could not update login item', err)
    }
  }

  function updateSettings(patch: SettingsPatch): Settings {
    const prev = store.get()
    const next = store.set(mergeSettings(prev, patch))
    if (!win) return next

    if (next.alwaysOnTop !== prev.alwaysOnTop) applyAlwaysOnTop(win, next.alwaysOnTop)
    if (next.opacity !== prev.opacity) win.setOpacity(next.opacity)
    if (next.captureExclusion !== prev.captureExclusion) {
      win.webContents.send(IPC.captureStatusChanged, guard!.apply(next.captureExclusion))
    }
    if (JSON.stringify(next.shortcuts) !== JSON.stringify(prev.shortcuts)) registerShortcuts(win, next.shortcuts)
    if (next.launchAtLogin !== prev.launchAtLogin) applyLoginItem(next)
    tray?.update(next)
    win.webContents.send(IPC.settingsChanged, next)
    return next
  }

  async function exportSession(id: string): Promise<boolean> {
    const rec = sessions.get(id)
    if (!rec || !win) return false
    if (process.platform === 'darwin') app.focus({ steal: true })
    const day = new Date(rec.startedAt).toISOString().slice(0, 10)
    const res = await dialog.showSaveDialog({
      title: 'Export session',
      defaultPath: `nexus-session-${day}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (res.canceled || !res.filePath) return false
    await writeFile(res.filePath, sessionToMarkdown(rec), 'utf8')
    return true
  }

  function registerIpc() {
    ipcMain.handle(IPC.settingsGet, (e) => (fromOverlay(e) ? store.get() : null))
    ipcMain.handle(IPC.settingsUpdate, (e, patch: SettingsPatch) => (fromOverlay(e) ? updateSettings(patch) : null))
    ipcMain.handle(IPC.captureStatus, (e) => (fromOverlay(e) ? guard!.verify() : null))
    ipcMain.handle(IPC.shortcutStatus, (e) => (fromOverlay(e) ? shortcutStatus() : null))
    ipcMain.handle(IPC.displaysList, (e) => (fromOverlay(e) && win ? listDisplays(win) : []))
    ipcMain.handle(IPC.moveToDisplay, (e, id: number) => {
      if (fromOverlay(e) && win && moveToDisplay(win, id)) store.set({ displayId: id })
    })
    ipcMain.on(IPC.windowHide, (e) => fromOverlay(e) && win?.hide())
    ipcMain.on(IPC.windowMinimize, (e) => fromOverlay(e) && win?.minimize())
    ipcMain.on(IPC.windowClose, (e) => fromOverlay(e) && app.quit())
    ipcMain.on(IPC.copyText, (e, text: unknown) => fromOverlay(e) && typeof text === 'string' && clipboard.writeText(text))

    // AI
    ipcMain.on(IPC.aiCancel, (e, requestId: string) => fromOverlay(e) && ai.cancel(requestId))
    ipcMain.on(IPC.aiSend, (e, req: AISendRequest) => {
      if (!fromOverlay(e)) return
      const emit = (ev: AIStreamEvent) => !e.sender.isDestroyed() && e.sender.send(IPC.aiEvent, ev)
      void ai.send(req.requestId, req.messages, {
        onDelta: (text) => emit({ requestId: req.requestId, type: 'delta', text }),
        onDone: () => emit({ requestId: req.requestId, type: 'done' }),
        onError: (message) => emit({ requestId: req.requestId, type: 'error', message })
      })
    })
    ipcMain.on(IPC.aiPrefill, (e, messages: unknown) => fromOverlay(e) && Array.isArray(messages) && ai.prefill(messages))
    ipcMain.handle(IPC.aiModels, (e, id: unknown) =>
      fromOverlay(e) && isProvider(id) ? ai.listModels(id) : { ok: false, error: 'unknown provider' }
    )
    ipcMain.handle(IPC.aiTest, (e, id: unknown) =>
      fromOverlay(e) && isProvider(id) ? ai.test(id) : { ok: false, error: 'unknown provider' }
    )

    // API keys: write-only from the renderer's point of view.
    ipcMain.handle(IPC.secretsStatus, (e) => (fromOverlay(e) ? secrets.status() : null))
    ipcMain.handle(IPC.secretsSet, (e, name: unknown, value: unknown) => {
      if (!fromOverlay(e) || !SecretStore.isName(name) || typeof value !== 'string') return secrets.status()
      secrets.set(name, value.slice(0, 1_000))
      return secrets.status()
    })

    // Media
    ipcMain.handle(IPC.mediaAccess, (e) => (fromOverlay(e) ? requestMicAccess() : { granted: false, status: 'denied' }))
    ipcMain.handle(IPC.screenCapture, (e) => {
      if (!fromOverlay(e) || !win) throw new Error('not allowed')
      return captureScreen(win)
    })

    // Transcription
    ipcMain.handle(IPC.sttStart, (e, source: unknown) =>
      fromOverlay(e) && isSpeaker(source) ? transcription.start(source) : { ok: false, error: 'not allowed' }
    )
    ipcMain.handle(IPC.sttStop, (e, source: unknown) => {
      if (fromOverlay(e) && isSpeaker(source)) return transcription.stop(source)
    })
    ipcMain.on(IPC.sttAudio, (e, source: unknown, data: ArrayBuffer | ArrayBufferView) => {
      if (fromOverlay(e) && isSpeaker(source) && data) transcription.audio(source, asInt16(data))
    })

    // Sessions
    ipcMain.handle(IPC.sessionsList, (e) => (fromOverlay(e) ? sessions.list() : []))
    ipcMain.handle(IPC.sessionsGet, (e, id: string) => (fromOverlay(e) ? sessions.get(id) : null))
    ipcMain.handle(IPC.sessionsSave, (e, rec: SessionRecord) => {
      if (fromOverlay(e) && store.get().copilot.saveSessions) sessions.save(rec)
    })
    ipcMain.handle(IPC.sessionsDelete, (e, id: string) => {
      if (fromOverlay(e)) sessions.delete(id)
    })
    ipcMain.handle(IPC.sessionsExport, (e, id: string) => (fromOverlay(e) ? exportSession(id) : false))
    ipcMain.handle(IPC.importProfileFile, (e) => (fromOverlay(e) && win ? importProfileFile(win) : null))
  }

  app.on('second-instance', () => win && showPassive(win))
  app.on('activate', () => win && showPassive(win))

  app.whenReady().then(() => {
    store = new SettingsStore()
    secrets = new SecretStore()
    sessions = new SessionStore()
    ai = new AIService(() => store.get(), (n) => secrets.get(n))
    transcription = new TranscriptionService(
      () => store.get(),
      (n) => secrets.get(n),
      (ev) => win && !win.isDestroyed() && win.webContents.send(IPC.sttEvent, ev)
    )
    const settings = store.get()

    win = createOverlayWindow(store)
    guard = new CaptureGuard(win)
    // Exclude from capture before the window is ever shown.
    guard.apply(settings.captureExclusion)
    setupMediaPermissions(win)

    registerIpc()
    registerShortcuts(win, settings.shortcuts)
    applyLoginItem(settings)

    tray = new AppTray(win, {
      setCaptureExclusion: (on) => updateSettings({ captureExclusion: on }),
      quit: () => app.quit()
    })
    tray.update(settings)

    win.once('ready-to-show', () => {
      if (!win) return
      win.webContents.send(IPC.captureStatusChanged, guard!.verify())
      if (!settings.startHidden) showPassive(win)
    })
    // Keep the reported status honest: re-read (and re-apply if needed) whenever it is shown.
    win.on('show', () => win && win.webContents.send(IPC.captureStatusChanged, guard!.verify()))
    win.on('closed', () => {
      win = null
      app.quit()
    })
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    ai?.cancelAll()
    void transcription?.stopAll()
    store?.flush()
    tray?.destroy()
  })

  app.on('window-all-closed', () => app.quit())
}
