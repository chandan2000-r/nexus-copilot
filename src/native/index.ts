/**
 * Loader for the platform-specific native addon (src/native/{macos,windows}).
 * Everything OS-specific stays behind this interface.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

export interface NativeCaptureResult {
  ok: boolean
  excluded: boolean
  mechanism: string
  rawValue: number | null
  osVersion: string
  detail: string
}

export interface NativeCaptureModule {
  platform: string
  setCaptureExcluded(handle: Buffer, excluded: boolean): NativeCaptureResult
  getCaptureState(handle: Buffer): NativeCaptureResult
  /** Windows only: keep the window out of Alt+Tab, Task View and the taskbar. Returns the style read back. */
  setToolWindow?(handle: Buffer, on: boolean): boolean
}

export interface NativeLoadResult {
  module: NativeCaptureModule | null
  error: string | null
}

function candidatePaths(): string[] {
  const file = 'nexus_native.node'
  if (app.isPackaged) return [join(process.resourcesPath, 'native', file)]
  return [join(app.getAppPath(), 'src', 'native', 'build', 'Release', file)]
}

export function loadNativeModule(): NativeLoadResult {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return { module: null, error: `no native capture API on ${process.platform}` }
  }
  const nodeRequire = createRequire(__filename)
  const errors: string[] = []
  for (const p of candidatePaths()) {
    if (!existsSync(p)) {
      errors.push(`not found: ${p}`)
      continue
    }
    try {
      const mod = nodeRequire(p) as NativeCaptureModule
      if (typeof mod.setCaptureExcluded === 'function') return { module: mod, error: null }
      errors.push(`${p} does not export setCaptureExcluded`)
    } catch (err) {
      errors.push(`${p}: ${(err as Error).message}`)
    }
  }
  return { module: null, error: errors.join('; ') }
}
