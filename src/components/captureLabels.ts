import type { CaptureStatus } from '../shared/capture'

export function captureLabel(s: CaptureStatus | null): { text: string; tone: 'ok' | 'warn' | 'bad' | 'off' } {
  if (!s) return { text: 'Checking…', tone: 'off' }
  switch (s.level) {
    case 'excluded':
      return { text: 'Hidden from capture', tone: 'ok' }
    case 'partial':
      return { text: 'Partially hidden', tone: 'warn' }
    case 'unverified':
      return { text: 'Hidden (unverified)', tone: 'warn' }
    case 'off':
      return { text: 'Visible in capture', tone: 'off' }
    case 'unsupported':
      return { text: 'Not supported', tone: 'bad' }
    default:
      return { text: 'Exclusion failed', tone: 'bad' }
  }
}
