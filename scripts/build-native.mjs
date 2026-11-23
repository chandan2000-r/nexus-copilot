// Builds src/native against the installed Electron's headers.
// The addon only uses Node-API, so the binary does not need rebuilding when Electron updates.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

if (!['darwin', 'win32'].includes(process.platform)) {
  console.log(`[native] skipping: no capture-exclusion API on ${process.platform}`)
  process.exit(0)
}

const electronVersion = require('electron/package.json').version
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
const arch = process.env.npm_config_arch || process.arch

console.log(`[native] building for Electron ${electronVersion} (${process.platform}/${arch})`)
execFileSync(
  process.execPath,
  [
    nodeGyp,
    'rebuild',
    `--directory=${join(root, 'src', 'native')}`,
    `--target=${electronVersion}`,
    `--arch=${arch}`,
    '--dist-url=https://electronjs.org/headers'
  ],
  { stdio: 'inherit', cwd: root }
)
console.log('[native] done → src/native/build/Release/nexus_native.node')
