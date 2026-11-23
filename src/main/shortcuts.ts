import { type BrowserWindow, globalShortcut } from 'electron'
import type { UiCommand } from '../shared/copilot'
import { IPC, type ShortcutStatus } from '../shared/ipc'
import type { ShortcutSettings } from '../shared/settings'
import { moveToNextDisplay, showPassive, toggleVisibility } from './windowManager'

let status: ShortcutStatus | null = null

/**
 * Sends a command to the renderer. It runs as a user gesture so the renderer may start
 * audio / screen capture from a global shortcut, which browsers otherwise only allow after a click.
 */
export function sendCommand(win: BrowserWindow, cmd: UiCommand): void {
  if (win.isDestroyed()) return
  const js = `window.dispatchEvent(new CustomEvent('nexus-command', { detail: ${JSON.stringify(cmd)} }))`
  win.webContents.executeJavaScript(js, true).catch(() => win.webContents.send(IPC.uiCommand, cmd))
}

export function registerShortcuts(win: BrowserWindow, shortcuts: ShortcutSettings): ShortcutStatus {
  globalShortcut.unregisterAll()

  const actions: Record<keyof ShortcutSettings, () => void> = {
    toggleWindow: () => toggleVisibility(win),
    focusInput: () => {
      showPassive(win)
      win.focus()
      sendCommand(win, 'focus')
    },
    nextDisplay: () => moveToNextDisplay(win),
    answerNow: () => {
      showPassive(win)
      sendCommand(win, 'answer')
    },
    analyzeScreen: () => {
      showPassive(win)
      sendCommand(win, 'screen')
    },
    toggleListening: () => {
      showPassive(win)
      sendCommand(win, 'listen')
    }
  }

  const result = {} as ShortcutStatus
  for (const key of Object.keys(actions) as (keyof ShortcutSettings)[]) {
    const accelerator = shortcuts[key]
    let registered = false
    if (accelerator) {
      try {
        registered = globalShortcut.register(accelerator, actions[key])
      } catch (err) {
        console.warn(`[shortcuts] invalid accelerator "${accelerator}"`, err)
      }
    }
    if (accelerator && !registered) console.warn(`[shortcuts] could not register ${key}: ${accelerator}`)
    result[key] = { accelerator, registered }
  }
  status = result
  return result
}

export function shortcutStatus(): ShortcutStatus | null {
  return status
}
