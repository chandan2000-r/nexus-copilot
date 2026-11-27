import { type BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import type { Settings } from '../shared/settings'
import { WINDOW_SIZE_IDS, WINDOW_SIZES, type WindowSizeId } from '../shared/windowSize'
import { sendCommand } from './shortcuts'
import { moveToNextDisplay, showPassive, toggleVisibility } from './windowManager'

/** Draws a 16×16 ring icon in code so the app ships without image assets. */
function trayIcon() {
  const size = 32 // drawn at 2× for Retina, then marked as scale factor 2
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const ring = d > 9 && d < 14
      const dot = d < 4.5
      const alpha = ring || dot ? 255 : 0
      const i = (y * size + x) * 4
      buf[i] = 0 // B
      buf[i + 1] = 0 // G
      buf[i + 2] = 0 // R
      buf[i + 3] = alpha
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
  if (process.platform === 'darwin') img.setTemplateImage(true)
  return img
}

export interface TrayHandlers {
  setCaptureExclusion(on: boolean): void
  setHideActivity(on: boolean): void
  setWindowSize(size: WindowSizeId): void
  setClickThrough(on: boolean): void
  quit(): void
}

export class AppTray {
  private tray: Tray

  constructor(
    private readonly win: BrowserWindow,
    private readonly handlers: TrayHandlers
  ) {
    this.tray = new Tray(trayIcon())
    this.tray.setToolTip('Nexus AI')
    if (process.platform === 'win32') this.tray.on('click', () => toggleVisibility(this.win))
  }

  update(settings: Settings): void {
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show / Hide Nexus AI', click: () => toggleVisibility(this.win) },
        { label: 'Move to Next Display', click: () => moveToNextDisplay(this.win) },
        {
          label: 'Window Size',
          submenu: WINDOW_SIZE_IDS.map((id) => ({
            label: WINDOW_SIZES[id].label,
            type: 'radio' as const,
            checked: settings.windowSize === id,
            click: () => this.handlers.setWindowSize(id)
          }))
        },
        { type: 'separator' },
        { label: 'Start / Stop Listening', click: () => this.command('listen') },
        { label: 'Answer Latest Question', click: () => this.command('answer') },
        { label: 'Analyze Screen', click: () => this.command('screen') },
        { type: 'separator' },
        {
          label: 'Click-Through (Pointer Passes Through)',
          type: 'checkbox',
          checked: settings.clickThrough,
          click: (item) => this.handlers.setClickThrough(item.checked)
        },
        {
          label: 'Hide from Screen Capture',
          type: 'checkbox',
          checked: settings.captureExclusion,
          click: (item) => this.handlers.setCaptureExclusion(item.checked)
        },
        {
          label: 'Keep Out of Recent Activity',
          type: 'checkbox',
          checked: settings.hideActivity,
          click: (item) => this.handlers.setHideActivity(item.checked)
        },
        { type: 'separator' },
        { label: 'Quit Nexus AI', click: () => this.handlers.quit() }
      ])
    )
  }

  private command(cmd: 'listen' | 'answer' | 'screen'): void {
    showPassive(this.win)
    sendCommand(this.win, cmd)
  }

  destroy(): void {
    this.tray.destroy()
  }
}
