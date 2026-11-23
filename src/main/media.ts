/**
 * Audio / screen access for the copilot:
 *  - permission handlers that only grant media to the overlay window,
 *  - getDisplayMedia → the screen plus system-audio loopback (the other side of the call),
 *  - microphone permission on macOS,
 *  - screenshots for "analyze screen".
 */
import { type BrowserWindow, desktopCapturer, screen, systemPreferences } from 'electron'
import type { ScreenCapture } from '../shared/copilot'
import type { MediaAccessResult } from '../shared/ipc'

const GRANTED = new Set(['media', 'display-capture', 'clipboard-sanitized-write'])

export function setupMediaPermissions(win: BrowserWindow): void {
  const ses = win.webContents.session
  const isOverlay = (wc: Electron.WebContents | null) => !!wc && !win.isDestroyed() && wc.id === win.webContents.id

  ses.setPermissionRequestHandler((wc, permission, callback) => callback(isOverlay(wc) && GRANTED.has(permission)))
  ses.setPermissionCheckHandler((wc, permission) => isOverlay(wc) && GRANTED.has(permission))

  // The renderer calls getDisplayMedia({ audio: true, video: true }) to get system audio.
  // We answer with the primary screen and 'loopback' audio; the renderer drops the video track.
  // Loopback audio: Windows 10+, and macOS 13+ in current Chromium (ScreenCaptureKit / Core Audio taps).
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      const frame = request.frame
      const main = win.isDestroyed() ? null : win.webContents.mainFrame
      if (!frame || !main || frame.processId !== main.processId || frame.routingId !== main.routingId) {
        return callback({})
      }
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const primary = String(screen.getPrimaryDisplay().id)
          const source = sources.find((s) => s.display_id === primary) ?? sources[0]
          if (!source) return callback({})
          callback({ video: source, audio: 'loopback' })
        })
        .catch((err) => {
          console.warn('[media] getSources failed', err)
          callback({})
        })
    },
    { useSystemPicker: false }
  )
}

export async function requestMicAccess(): Promise<MediaAccessResult> {
  if (process.platform !== 'darwin') return { granted: true, status: 'granted' }
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return { granted: true, status }
  if (status === 'not-determined') {
    const granted = await systemPreferences.askForMediaAccess('microphone')
    return { granted, status: granted ? 'granted' : 'denied' }
  }
  return { granted: false, status }
}

const MAX_EDGE = 1920

/** Captures the display the overlay is on. The overlay itself is excluded when capture exclusion is on. */
export async function captureScreen(win: BrowserWindow): Promise<ScreenCapture> {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen')
    if (status === 'denied' || status === 'restricted') {
      throw new Error(
        'Screen Recording permission is off. Turn it on for Nexus AI in System Settings → Privacy & Security → Screen & System Audio Recording, then restart the app.'
      )
    }
  }
  const display = screen.getDisplayMatching(win.getBounds())
  const w = display.size.width * display.scaleFactor
  const h = display.size.height * display.scaleFactor
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(w * scale), height: Math.round(h * scale) }
  })
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error(
      process.platform === 'darwin'
        ? 'The screenshot came back empty. Allow Screen Recording for Nexus AI in System Settings → Privacy & Security, then restart the app.'
        : 'The screenshot came back empty.'
    )
  }
  const size = source.thumbnail.getSize()
  return {
    mimeType: 'image/jpeg',
    data: source.thumbnail.toJPEG(85).toString('base64'),
    width: size.width,
    height: size.height
  }
}
