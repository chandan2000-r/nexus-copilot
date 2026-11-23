/**
 * Capture exclusion for the overlay window.
 *
 * Primary path: our native addon (src/native) calls the OS API directly and reads the
 * value back, so the status shown in Settings is the real OS state.
 * Fallback: Electron's setContentProtection(), used only if the addon fails to load.
 * In that case the status is reported as "unverified".
 *
 * The window is never hidden, minimized or moved because of screen sharing. This module
 * does not detect screen sharing at all.
 */
import type { BrowserWindow } from 'electron'
import { release } from 'node:os'
import { loadNativeModule, type NativeCaptureResult, type NativeLoadResult } from '../native'
import type { CaptureMechanism, CaptureStatus } from '../shared/capture'

let nativeCache: NativeLoadResult | null = null
/** Loaded on first use (after app 'ready'), not at import time. */
function nativeAddon(): NativeLoadResult {
  if (!nativeCache) {
    nativeCache = loadNativeModule()
    if (nativeCache.error) console.warn('[capture] native module unavailable:', nativeCache.error)
  }
  return nativeCache
}

function majorVersion(v: string): number {
  return Number.parseInt(v.split('.')[0] ?? '0', 10) || 0
}

function caveatsFor(osVersion: string, mechanism: CaptureMechanism): string[] {
  const common = [
    'Cameras, phones and HDMI capture cards record the physical screen. Software settings cannot hide the window from them.',
    'Exclusion only affects the image other apps get from the OS capture APIs. Other apps can still see that the window exists, for example through window lists or accessibility APIs.'
  ]
  if (process.platform === 'darwin') {
    const mac: string[] = []
    if (majorVersion(osVersion) >= 15) {
      mac.push(
        'macOS 15 and later: developers report that ScreenCaptureKit, the capture API most meeting apps now use, may still capture windows set to NSWindowSharingNone. Check each meeting app with docs/TEST_MATRIX.md.'
      )
    }
    return [...mac, ...common]
  }
  if (process.platform === 'win32') {
    const win: string[] = []
    if (mechanism === 'WDA_MONITOR') {
      win.push('This Windows build is older than 10 version 2004. Captures show a black rectangle where the window is, not the desktop behind it.')
    }
    win.push(
      'Capture tools that read the display output below the Windows capture APIs (some drivers, remote-management and proctoring tools) can ignore display affinity.'
    )
    return [...win, ...common]
  }
  return common
}

export class CaptureGuard {
  private status: CaptureStatus

  constructor(private readonly win: BrowserWindow) {
    this.status = this.makeStatus(false, null, 'not applied yet')
  }

  get current(): CaptureStatus {
    return this.status
  }

  /** Turns exclusion on or off and returns the verified status. */
  apply(requested: boolean): CaptureStatus {
    if (this.win.isDestroyed()) return this.status
    const native = nativeAddon()
    if (native.module) {
      const res = native.module.setCaptureExcluded(this.win.getNativeWindowHandle(), requested)
      this.status = this.makeStatus(requested, res, res.detail)
    } else if (process.platform === 'darwin' || process.platform === 'win32') {
      this.win.setContentProtection(requested)
      this.status = this.makeStatus(requested, null, `native module unavailable (${native.error}); used Electron setContentProtection`)
    } else {
      this.status = this.makeStatus(requested, null, `no capture-exclusion API on ${process.platform}`)
    }
    console.info('[capture]', this.status.level, this.status.mechanism, '-', this.status.detail)
    return this.status
  }

  /** Reads the OS state back and re-applies it if it has drifted. */
  verify(): CaptureStatus {
    const native = nativeAddon()
    if (this.win.isDestroyed() || !native.module) return this.status
    const res = native.module.getCaptureState(this.win.getNativeWindowHandle())
    if (res.ok && res.excluded !== this.status.requested) {
      console.warn('[capture] state drifted, re-applying')
      return this.apply(this.status.requested)
    }
    this.status = this.makeStatus(this.status.requested, res, this.status.detail)
    return this.status
  }

  private makeStatus(requested: boolean, res: NativeCaptureResult | null, detail: string): CaptureStatus {
    const osVersion =
      res?.osVersion ?? (process.platform === 'darwin' ? process.getSystemVersion() : release())
    let mechanism: CaptureMechanism = 'none'
    let level: CaptureStatus['level']

    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      level = 'unsupported'
    } else if (res) {
      mechanism = (res.mechanism as CaptureMechanism) ?? 'none'
      if (!res.ok) level = 'failed'
      else if (!requested) level = 'off'
      else if (res.excluded) level = 'excluded'
      else if (mechanism === 'WDA_MONITOR') level = 'partial'
      else level = 'failed'
      if (!requested) mechanism = 'none'
    } else if (detail === 'not applied yet') {
      level = requested ? 'failed' : 'off'
    } else {
      mechanism = requested ? 'electron-setContentProtection' : 'none'
      level = requested ? 'unverified' : 'off'
    }

    return {
      platform: process.platform,
      osVersion,
      requested,
      level,
      mechanism,
      nativeModuleLoaded: nativeAddon().module !== null,
      rawValue: res?.rawValue ?? null,
      detail,
      caveats: requested ? caveatsFor(osVersion, mechanism) : [],
      checkedAt: Date.now()
    }
  }
}

