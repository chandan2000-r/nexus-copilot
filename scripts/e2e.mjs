#!/usr/bin/env node
// End-to-end check of the built app (run `npm run test:e2e`, or `node scripts/e2e.mjs` after `npm run build`).
// Drives the real Electron app with Playwright against scripts/mock-ai.mjs, in a throwaway
// user-data folder. To stay free of OS permission prompts it feeds Chromium's fake
// microphone from a generated WAV and stubs screen capture / file dialogs / permission
// checks in the main process. The window appears on screen for ~30 s while it runs.
import electronPath from 'electron'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { startMockServer } from './mock-ai.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.E2E_OUT ?? join(tmpdir(), 'nexus-e2e')
mkdirSync(out, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'nexus-e2e-data-'))

// ---------- fixtures ----------
function wav(parts, rate = 16_000) {
  const samples = []
  for (const [ms, amp] of parts) {
    const n = Math.round((rate * ms) / 1000)
    for (let i = 0; i < n; i++) {
      const env = 0.6 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / rate)
      samples.push(Math.round(amp * 32767 * env * Math.sin((2 * Math.PI * 220 * i) / rate)))
    }
  }
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((s, i) => buf.writeInt16LE(s, 44 + i * 2))
  return buf
}

function pdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let s = '%PDF-1.4\n'
  const offsets = objs.map((o, i) => {
    const at = s.length
    s += `${i + 1} 0 obj\n${o}\nendobj\n`
    return at
  })
  const xref = s.length
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(s, 'latin1')
}

const audioFile = join(userData, 'fake-mic.wav')
writeFileSync(audioFile, wav([[1200, 0.001], [1500, 0.2], [6000, 0.001]]))
const pdfFile = join(userData, 'resume.pdf')
writeFileSync(pdfFile, pdf('Jane Doe - Site Reliability Engineer - Kubernetes, Terraform, Go'))

// ---------- run ----------
const mock = await startMockServer(0)
writeFileSync(
  join(userData, 'settings.json'),
  JSON.stringify({
    ai: { provider: 'openai', openaiBaseUrl: mock.url, models: { openai: 'mock-fast' } },
    stt: { engine: 'whisper', whisperBaseUrl: mock.url, whisperModel: 'whisper-1', captureThem: false, captureYou: true },
    copilot: { mode: 'interview', autoAnswer: true },
    profile: { role: 'Senior SRE', resume: 'Senior SRE at Acme. Cut p99 latency 40%.' }
  })
)

const env = { ...process.env, NEXUS_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE

let failures = 0
const results = []
async function step(name, fn) {
  const t = Date.now()
  try {
    await fn()
    results.push(`PASS  ${name} (${Date.now() - t} ms)`)
  } catch (err) {
    failures++
    results.push(`FAIL  ${name}: ${err.message.split('\n')[0]}`)
  }
  console.log(results.at(-1))
}

// NEXUS_APP=<path to packaged binary> runs the same checks against a built installer's app.
const packaged = process.env.NEXUS_APP
const app = await electron.launch({
  executablePath: packaged ?? electronPath,
  args: [
    ...(packaged ? [] : [root]),
    '--use-mock-keychain',
    '--use-fake-device-for-media-stream',
    // Lets the (normally sandboxed) audio service read the fake-mic WAV file.
    '--disable-features=AudioServiceSandbox,AudioServiceOutOfProcess',
    `--use-file-for-fake-audio-capture=${audioFile}%noloop`
  ],
  cwd: root,
  env
})
const logs = []
app.process().stdout?.on('data', (d) => logs.push(String(d)))
app.process().stderr?.on('data', (d) => logs.push(String(d)))

// Stub OS-level pieces that would show permission prompts or dialogs.
await app.evaluate(({ systemPreferences, desktopCapturer, dialog, nativeImage, screen }, pdfPath) => {
  systemPreferences.getMediaAccessStatus = () => 'granted'
  systemPreferences.askForMediaAccess = async () => true
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdfPath] })
  const size = 64
  const bmp = Buffer.alloc(size * size * 4, 200)
  desktopCapturer.getSources = async () => [
    { id: 'screen:1', name: 'Fake screen', display_id: String(screen.getPrimaryDisplay().id), thumbnail: nativeImage.createFromBitmap(bmp, { width: size, height: size }) }
  ]
}, pdfFile)

const page = await app.firstWindow()
await page.waitForSelector('.controlbar', { timeout: 20_000 })
const shot = (name) => page.screenshot({ path: join(out, name) })
const expectText = async (selector, text, timeout = 15_000) =>
  page.waitForFunction(
    ([s, t]) => [...document.querySelectorAll(s)].some((el) => el.textContent?.includes(t) || el.value?.includes?.(t)),
    [selector, text],
    { timeout }
  )
const idle = () => page.waitForSelector('.send-btn[aria-label="Send"]', { timeout: 15_000 })

await step('empty state renders with shortcuts and no key warning', async () => {
  await expectText('.empty-state h1', 'Ready when you are')
  if (await page.$('.setup-btn:not(.subtle)')) throw new Error('unexpected "add API key" prompt')
  await shot('01-empty.png')
})

await step('typed question streams a Markdown answer with profile context', async () => {
  await page.fill('.composer textarea', 'What is a mutex?')
  await page.keyboard.press('Enter')
  await expectText('.answer .md', 'Mock answer')
  await idle()
  if (!(await page.$('.answer .md-code'))) throw new Error('code block not rendered')
  const sys = mock.stats.lastChat.messages[0].content
  if (!sys.includes('Senior SRE at Acme')) throw new Error('resume missing from system prompt')
})

await step('listening: mic audio → VAD → transcription → transcript line', async () => {
  await page.click('.listen-btn')
  await page.waitForSelector('.listen-btn.live', { timeout: 5_000 })
  await page.waitForSelector('.line.you', { timeout: 20_000 })
  if (mock.stats.transcriptions < 1) throw new Error('no transcription request reached the server')
  await shot('02-listening.png')
})

await step('auto-answer fires when the other side asks a question', async () => {
  const before = await page.$$eval('.turn-head.kind-answer', (n) => n.length)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('stt:event', {
      type: 'final',
      source: 'them',
      line: { id: 'them-e2e-1', source: 'them', text: 'Great. Can you walk me through how you would debug a memory leak in production?', at: Date.now() }
    })
  })
  await page.waitForFunction((n) => document.querySelectorAll('.turn-head.kind-answer').length > n, before, { timeout: 10_000 })
  await expectText('.turn-head.kind-answer', 'memory leak')
  await idle()
  const lastUser = mock.stats.lastChat.messages.at(-1).content
  if (!lastUser.includes('Live transcript')) throw new Error('transcript not sent with the question')
  const visible = await page.evaluate(() => {
    const box = document.querySelector('.chat').getBoundingClientRect()
    const q = [...document.querySelectorAll('.turn-head.kind-answer')].at(-1).getBoundingClientRect()
    return q.top >= box.top && q.bottom <= box.bottom
  })
  if (!visible) throw new Error('newest question scrolled out of view')
  await shot('03-auto-answer.png')
})

await step('non-questions do not trigger an answer', async () => {
  const before = await page.$$eval('.turn-head.kind-answer', (n) => n.length)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('stt:event', {
      type: 'final',
      source: 'them',
      line: { id: 'them-e2e-2', source: 'them', text: 'Okay, that makes sense.', at: Date.now() }
    })
  })
  await page.waitForTimeout(2_000)
  const after = await page.$$eval('.turn-head.kind-answer', (n) => n.length)
  if (after !== before) throw new Error('answered a non-question')
})

await step('answer-now command (global shortcut path) answers on demand', async () => {
  const before = await page.$$eval('.turn-head.kind-answer', (n) => n.length)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus-command', { detail: 'answer' })))
  await page.waitForFunction((n) => document.querySelectorAll('.turn-head.kind-answer').length > n, before, { timeout: 10_000 })
  await idle()
})

await step('stop listening', async () => {
  await page.click('.listen-btn')
  await page.waitForSelector('.listen-btn:not(.live)', { timeout: 5_000 })
})

await step('analyze screen sends a screenshot to the model', async () => {
  await page.click('button[aria-label="Analyze screen"]')
  await page.waitForSelector('.turn-head.kind-screen', { timeout: 10_000 })
  await expectText('.answer .md', 'I can see your screenshot')
  await idle()
  const parts = mock.stats.lastChat.messages.at(-1).content
  if (!Array.isArray(parts) || !parts.some((p) => p.type === 'image_url')) throw new Error('no image in request')
})

await step('settings → AI: load models and test connection', async () => {
  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('.tabs')
  await page.click('text=Load')
  await expectText('.field-hint', '2 models available')
  await page.click('text=Test connection')
  await expectText('.test-ok', 'Works')
  await shot('04-settings-ai.png')
})

await step('settings → Audio tab renders', async () => {
  await page.click('.tabs button:has-text("Audio")')
  await expectText('.settings-body', 'Spoken language')
  await shot('05-settings-audio.png')
})

await step('settings → Profile: import a PDF resume', async () => {
  await page.click('.tabs button:has-text("Profile")')
  await page.click('text=Import PDF / text…')
  await expectText('textarea[aria-label="Resume"]', 'Kubernetes')
  await shot('06-settings-profile.png')
})

await step('settings → General: capture exclusion verified', async () => {
  await page.click('.tabs button:has-text("General")')
  await expectText('.status-card', 'Hidden from capture')
  await shot('07-settings-general.png')
  await page.click('.done-btn')
})

await step('history: session was autosaved and opens', async () => {
  await page.waitForTimeout(2_000)
  await page.click('button[aria-label="Session history"]')
  await page.waitForSelector('.session-list li button', { timeout: 5_000 })
  await page.click('.session-list li button')
  await page.waitForSelector('.history-body .turn-head', { timeout: 5_000 })
  const h = await page.$eval('.history-body .turn-head .turn-text', (el) => [el.textContent, el.getBoundingClientRect().height])
  if (!h[0].includes('What is a mutex?') || h[1] < 10) throw new Error(`history question not shown: ${JSON.stringify(h)}`)
  await shot('08-history.png')
  await page.click('.tabs button:has-text("Transcript")')
  await page.waitForSelector('.history-body .line', { timeout: 5_000 })
})

await app.close()
mock.server.close()
rmSync(userData, { recursive: true, force: true })

console.log(`\n${results.length - failures}/${results.length} passed. Screenshots: ${out}`)
if (failures) {
  console.log('\n--- app log ---\n' + logs.join('').slice(-4000))
  process.exit(1)
}
