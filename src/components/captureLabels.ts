import type { CaptureStatus } from '../shared/capture'

/** `short` is shown in the title bar of a narrow window (the full text is in its tooltip). */
export function captureLabel(s: CaptureStatus | null): { text: string; short: string; tone: 'ok' | 'warn' | 'bad' | 'off' } {
  if (!s) return { text: 'Checking…', short: 'Checking…', tone: 'off' }
  switch (s.level) {
    case 'excluded':
      return { text: 'Hidden from capture', short: 'Hidden', tone: 'ok' }
    case 'partial':
      return { text: 'Partially hidden', short: 'Partial', tone: 'warn' }
    case 'unverified':
      return { text: 'Hidden (unverified)', short: 'Unverified', tone: 'warn' }
    case 'off':
      return { text: 'Visible in capture', short: 'Visible', tone: 'off' }
    case 'unsupported':
      return { text: 'Not supported', short: 'No support', tone: 'bad' }
    default:
      return { text: 'Exclusion failed', short: 'Failed', tone: 'bad' }
  }
}
