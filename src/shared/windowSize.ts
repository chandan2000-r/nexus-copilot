import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from './settings'

/** The three window sizes the user can switch between while the app runs. */
export type WindowSizeId = 'small' | 'medium' | 'large'
/** 'custom': the user dragged the window to some other size. */
export type WindowSize = WindowSizeId | 'custom'

export interface Size {
  width: number
  height: number
}
export interface Rect extends Size {
  x: number
  y: number
}

export const WINDOW_SIZES: Record<WindowSizeId, Size & { label: string }> = {
  small: { label: 'Small', width: 360, height: 460 },
  medium: { label: 'Medium', width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  large: { label: 'Large', width: 600, height: 860 }
}
export const WINDOW_SIZE_IDS = Object.keys(WINDOW_SIZES) as WindowSizeId[]

export function isWindowSize(v: unknown): v is WindowSize {
  return v === 'custom' || (typeof v === 'string' && v in WINDOW_SIZES)
}

/**
 * The size after `current` when cycling Small → Medium → Large → Small. From a dragged (custom)
 * size it goes to the first preset wider than the window, so the window always visibly changes.
 */
export function nextWindowSize(current: WindowSize, width: number): WindowSizeId {
  if (current !== 'custom') return WINDOW_SIZE_IDS[(WINDOW_SIZE_IDS.indexOf(current) + 1) % WINDOW_SIZE_IDS.length]
  return WINDOW_SIZE_IDS.find((id) => WINDOW_SIZES[id].width > width + 4) ?? 'small'
}

/** The preset a window of this size was set to, or 'custom' (used for settings saved before presets existed). */
export function presetFor(size: Size | null): WindowSize {
  if (!size) return 'medium'
  const near = (a: number, b: number) => Math.abs(a - b) <= 2
  return WINDOW_SIZE_IDS.find((id) => near(WINDOW_SIZES[id].width, size.width) && near(WINDOW_SIZES[id].height, size.height)) ?? 'custom'
}

/**
 * Where the window goes at a new size. The top edge stays put (the title bar stays under the
 * pointer), and so does the side nearest the screen edge, so a window docked at the right stays
 * docked at the right. The result never exceeds the work area minus `margin` on each side, and is
 * kept fully inside the work area.
 */
export function fitWindow(current: Rect, workArea: Rect, size: Size, margin = 0): Rect {
  const width = Math.min(size.width, workArea.width - margin * 2)
  const height = Math.min(size.height, workArea.height - margin * 2)
  const gapLeft = current.x - workArea.x
  const gapRight = workArea.x + workArea.width - (current.x + current.width)
  const x = gapRight < gapLeft ? current.x + current.width - width : current.x
  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi))
  return {
    x: Math.round(clamp(x, workArea.x, workArea.x + workArea.width - width)),
    y: Math.round(clamp(current.y, workArea.y, workArea.y + workArea.height - height)),
    width: Math.round(width),
    height: Math.round(height)
  }
}
