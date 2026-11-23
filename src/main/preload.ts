import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type NexusBridge } from '../shared/ipc'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const bridge: NexusBridge = {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  onSettingsChanged: (cb) => subscribe(IPC.settingsChanged, cb),
  getCaptureStatus: () => ipcRenderer.invoke(IPC.captureStatus),
  onCaptureStatus: (cb) => subscribe(IPC.captureStatusChanged, cb),
  getShortcutStatus: () => ipcRenderer.invoke(IPC.shortcutStatus),
  hideWindow: () => ipcRenderer.send(IPC.windowHide),
  minimizeWindow: () => ipcRenderer.send(IPC.windowMinimize),
  closeWindow: () => ipcRenderer.send(IPC.windowClose),
  listDisplays: () => ipcRenderer.invoke(IPC.displaysList),
  moveToDisplay: (id) => ipcRenderer.invoke(IPC.moveToDisplay, id),
  onCommand: (cb) => subscribe(IPC.uiCommand, cb),
  copyText: (text) => ipcRenderer.send(IPC.copyText, text),
  ai: {
    send: (req) => ipcRenderer.send(IPC.aiSend, req),
    cancel: (id) => ipcRenderer.send(IPC.aiCancel, id),
    onEvent: (cb) => subscribe(IPC.aiEvent, cb),
    models: (provider) => ipcRenderer.invoke(IPC.aiModels, provider),
    test: (provider) => ipcRenderer.invoke(IPC.aiTest, provider)
  },
  secrets: {
    status: () => ipcRenderer.invoke(IPC.secretsStatus),
    set: (name, value) => ipcRenderer.invoke(IPC.secretsSet, name, value)
  },
  media: {
    requestMicAccess: () => ipcRenderer.invoke(IPC.mediaAccess),
    captureScreen: () => ipcRenderer.invoke(IPC.screenCapture)
  },
  stt: {
    start: (source) => ipcRenderer.invoke(IPC.sttStart, source),
    audio: (source, pcm) => ipcRenderer.send(IPC.sttAudio, source, pcm),
    stop: (source) => ipcRenderer.invoke(IPC.sttStop, source),
    onEvent: (cb) => subscribe(IPC.sttEvent, cb)
  },
  sessions: {
    list: () => ipcRenderer.invoke(IPC.sessionsList),
    get: (id) => ipcRenderer.invoke(IPC.sessionsGet, id),
    save: (record) => ipcRenderer.invoke(IPC.sessionsSave, record),
    delete: (id) => ipcRenderer.invoke(IPC.sessionsDelete, id),
    exportMarkdown: (id) => ipcRenderer.invoke(IPC.sessionsExport, id)
  },
  importProfileFile: () => ipcRenderer.invoke(IPC.importProfileFile)
}

contextBridge.exposeInMainWorld('nexus', bridge)
