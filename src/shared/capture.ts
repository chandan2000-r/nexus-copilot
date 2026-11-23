export type CaptureMechanism =
  | 'NSWindowSharingNone' // macOS AppKit
  | 'WDA_EXCLUDEFROMCAPTURE' // Windows 10 2004+ / Windows 11
  | 'WDA_MONITOR' // Older Windows: window shows as a black box in captures
  | 'electron-setContentProtection' // Fallback when the native addon could not load
  | 'none'

export type CaptureLevel =
  | 'excluded' // Native mechanism set and verified by reading it back
  | 'partial' // A mechanism is set, but captures still show something (e.g. a black box)
  | 'unverified' // Applied through a path that cannot be read back
  | 'off' // The user turned exclusion off
  | 'failed'
  | 'unsupported'

export interface CaptureStatus {
  platform: string
  osVersion: string
  requested: boolean
  level: CaptureLevel
  mechanism: CaptureMechanism
  nativeModuleLoaded: boolean
  /** Raw value read back from the OS (sharingType / display affinity), if available. */
  rawValue: number | null
  detail: string
  /** Known limitations for this platform / OS version. */
  caveats: string[]
  checkedAt: number
}
