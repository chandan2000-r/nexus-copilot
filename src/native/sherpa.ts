/**
 * Loads the sherpa-onnx Node addon (speech recognition on this computer). Packaged builds ship
 * the platform package (addon + onnxruntime libraries) in resources/sherpa (electron-builder.yml);
 * in development it comes from node_modules. The addon only uses Node-API, so it works in Electron.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { SherpaAddon } from '../services/stt/localModel'

const FILE = 'sherpa-onnx.node'

function candidatePaths(): string[] {
  const platform = process.platform === 'win32' ? 'win' : process.platform
  const pkg = `sherpa-onnx-${platform}-${process.arch}`
  if (app.isPackaged) return [join(process.resourcesPath, 'sherpa', FILE)]
  return [join(app.getAppPath(), 'node_modules', pkg, FILE)]
}

export function loadSherpaAddon(): SherpaAddon {
  const nodeRequire = createRequire(__filename)
  const errors: string[] = []
  for (const p of candidatePaths()) {
    if (!existsSync(p)) {
      errors.push(`not found: ${p}`)
      continue
    }
    try {
      const mod = nodeRequire(p) as SherpaAddon
      if (typeof mod.createOfflineRecognizerAsync === 'function') return mod
      errors.push(`${p} is not the sherpa-onnx addon`)
    } catch (err) {
      errors.push(`${p}: ${(err as Error).message}`)
    }
  }
  throw new Error(`the speech engine is missing from this build (${errors.join('; ')})`)
}
