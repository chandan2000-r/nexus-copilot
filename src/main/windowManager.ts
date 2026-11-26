import { app, BrowserWindow, type Display, type Rectangle, screen } from 'electron'
import { join } from 'node:path'
import type { DisplayInfo } from '../shared/ipc'
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, type Settings } from '../shared/settings'
import { fitWindow, WINDOW_SIZES, type WindowSizeId } from '../shared/windowSize'
import type { SettingsStore } from '../storage/settingsStore'

const MARGIN = 24
const MIN_WIDTH = 300
const MIN_HEIGHT = 320
const isMac = process.platform === 'darwin'

function intersectionArea(a: Rectangle, b: Rectangle): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** True if enough of the title bar is on some display for the user to grab it. */
function isReachable(bounds: Rectangle): boolean {
  const titleBar = { x: bounds.x, y: bounds.y, width: bounds.width, height: 40 }
  return screen.getAllDisplays().some((d) => intersectionArea(titleBar, d.workArea) >= 80 * 30)
}

function placeOnDisplay(display: Display, width: number, height: number): Rectangle {
  const wa = display.workArea
  const w = Math.min(width, wa.width - MARGIN * 2)
  const h = Math.min(height, wa.height - MARGIN * 2)
  return { x: Math.round(wa.x + wa.width - w - MARGIN), y: Math.round(wa.y + MARGIN * 3), width: w, height: h }
}

function initialBounds(s: Settings): Rectangle {
  const preset = s.windowSize === 'custom' ? null : WINDOW_SIZES[s.windowSize]
  const width = preset?.width ?? s.bounds?.width ?? DEFAULT_WIDTH
  const height = preset?.height ?? s.bounds?.height ?? DEFAULT_HEIGHT
  if (s.rememberPosition && s.bounds && isReachable(s.bounds)) return s.bounds
  const display =
    screen.getAllDisplays().find((d) => d.id === s.displayId) ?? screen.getPrimaryDisplay()
  return placeOnDisplay(display, width, height)
}

/**
 * Keeps the app out of recent activity, or brings it back. macOS: an "accessory" app has no Dock
 * icon, so it is not in the Dock, the Dock's recent apps or the Cmd+Tab switcher (the menu-bar
 * icon and the shortcuts still open it). Windows: no taskbar button. The OS's own record that
 * the app was launched is left alone.
 */
export function applyActivityPrivacy(win: BrowserWindow | null, hide: boolean): void {
  if (isMac) {
    const visible = !!win && !win.isDestroyed() && win.isVisible()
    app.setActivationPolicy(hide ? 'accessory' : 'regular')
    // Changing the policy can hide the app's windows; keep the overlay where it was.
    if (visible) win!.showInactive()
  } else if (win && !win.isDestroyed()) {
    win.setSkipTaskbar(hide)
  }
}

/**
 * Sets the window to one of the size presets while it runs. The top edge and the side nearest the
 * screen edge stay put, and on a small screen the size is reduced to fit. Returns the new bounds.
 */
export function resizeWindow(win: BrowserWindow, size: WindowSizeId): Rectangle {
  const current = win.getBounds()
  const next = fitWindow(current, screen.getDisplayMatching(current).workArea, WINDOW_SIZES[size], MARGIN)
  win.setBounds(next)
  return next
}

/** `onUserResize` runs after the user resizes the window by dragging (not after `resizeWindow`). */
export function createOverlayWindow(store: SettingsStore, onUserResize?: () => void): BrowserWindow {
  const s = store.get()
  const win = new BrowserWindow({
    ...initialBounds(s),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    frame: false,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: s.alwaysOnTop,
    hasShadow: true,
    roundedCorners: true,
    title: 'Nexus AI',
    ...(isMac
      ? {
          // NSPanel with NSWindowStyleMaskNonactivatingPanel: it can float over
          // full-screen apps and does not pull focus away from the meeting app.
          type: 'panel',
          vibrancy: 'hud' as const,
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000'
        }
      : {
          // Windows 11 22H2+ draws acrylic; earlier versions use the solid colour.
          backgroundMaterial: 'acrylic' as const,
          backgroundColor: '#16181d'
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Keep audio capture and the auto-answer timer running at full speed while hidden.
      backgroundThrottling: false
    }
  })

  win.setOpacity(s.opacity)
  applyAlwaysOnTop(win, s.alwaysOnTop)

  // Lock down navigation: the renderer only ever shows our own page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  const persist = () => {
    if (win.isDestroyed() || win.isMinimized()) return
    const bounds = win.getBounds()
    store.set({ bounds, displayId: screen.getDisplayMatching(bounds).id }, { debounce: true })
  }
  win.on('moved', persist)
  win.on('resized', () => {
    persist()
    onUserResize?.()
  })
  win.on('move', persist)

  const rescue = () => {
    if (win.isDestroyed()) return
    if (!isReachable(win.getBounds())) {
      const { width, height } = win.getBounds()
      win.setBounds(placeOnDisplay(screen.getPrimaryDisplay(), width, height))
    }
  }
  screen.on('display-removed', rescue)
  screen.on('display-metrics-changed', rescue)
  win.on('closed', () => {
    screen.removeListener('display-removed', rescue)
    screen.removeListener('display-metrics-changed', rescue)
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}

export function applyAlwaysOnTop(win: BrowserWindow, on: boolean): void {
  if (isMac) {
    win.setAlwaysOnTop(on, 'floating')
    win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on, skipTransformProcessType: true })
  } else {
    win.setAlwaysOnTop(on)
  }
}

/** Shows the window without taking focus from the app the user is in. */
export function showPassive(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.showInactive()
}

export function toggleVisibility(win: BrowserWindow): void {
  if (win.isVisible() && !win.isMinimized()) win.hide()
  else showPassive(win)
}

export function listDisplays(win: BrowserWindow): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  const currentId = screen.getDisplayMatching(win.getBounds()).id
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    primary: d.id === primaryId,
    current: d.id === currentId,
    bounds: d.bounds
  }))
}

export function moveToDisplay(win: BrowserWindow, displayId: number): boolean {
  const target = screen.getAllDisplays().find((d) => d.id === displayId)
  if (!target) return false
  const current = screen.getDisplayMatching(win.getBounds())
  const b = win.getBounds()
  // Keep the same relative position inside the work area.
  const relX = (b.x - current.workArea.x) / Math.max(1, current.workArea.width - b.width)
  const relY = (b.y - current.workArea.y) / Math.max(1, current.workArea.height - b.height)
  const wa = target.workArea
  const width = Math.min(b.width, wa.width - MARGIN * 2)
  const height = Math.min(b.height, wa.height - MARGIN * 2)
  const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 1))
  win.setBounds({
    x: Math.round(wa.x + clamp(relX) * (wa.width - width)),
    y: Math.round(wa.y + clamp(relY) * (wa.height - height)),
    width,
    height
  })
  return true
}

export function moveToNextDisplay(win: BrowserWindow): void {
  const displays = screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
  if (displays.length < 2) return
  const currentId = screen.getDisplayMatching(win.getBounds()).id
  const idx = displays.findIndex((d) => d.id === currentId)
  moveToDisplay(win, displays[(idx + 1) % displays.length].id)
}
