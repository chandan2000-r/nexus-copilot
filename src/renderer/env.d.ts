import type { NexusBridge } from '../shared/ipc'

declare global {
  interface Window {
    nexus: NexusBridge
  }
}

export {}
