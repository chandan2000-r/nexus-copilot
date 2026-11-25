/** Imports a resume / job description from a PDF, Markdown or text file. */
import { app, type BrowserWindow, dialog } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { ImportedFile } from '../shared/ipc'
import { MAX_PROFILE_FIELD } from '../shared/settings'

const MAX_BYTES = 15 * 1024 * 1024

export async function extractText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase()
  if ((await stat(path)).size > MAX_BYTES) throw new Error('File is larger than 15 MB.')
  if (ext === '.pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)))
    const { text } = await pdfText(pdf, { mergePages: true })
    return text
  }
  return readFile(path, 'utf8')
}

export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_PROFILE_FIELD)
}

export async function importProfileFile(win: BrowserWindow): Promise<ImportedFile> {
  if (process.platform === 'darwin') app.focus({ steal: true })
  const res = await dialog.showOpenDialog(process.platform === 'darwin' ? (undefined as unknown as BrowserWindow) : win, {
    title: 'Import resume or notes',
    // Windows: keep the imported file out of Recent items.
    properties: ['openFile', 'dontAddToRecent'],
    filters: [{ name: 'PDF, Markdown or text', extensions: ['pdf', 'md', 'markdown', 'txt'] }]
  })
  if (res.canceled || !res.filePaths[0]) return null
  const file = res.filePaths[0]
  try {
    const text = tidy(await extractText(file))
    if (!text) return { error: 'No text found in that file. If it is a scanned PDF, copy the text in manually.' }
    return { name: basename(file), text }
  } catch (err) {
    return { error: `Could not read ${basename(file)}: ${(err as Error).message}` }
  }
}
