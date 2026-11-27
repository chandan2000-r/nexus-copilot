import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import { fillsWorkArea, fitWindow, nextWindowSize, presetFor, WINDOW_SIZES } from '../src/shared/windowSize'
import { sanitize } from '../src/storage/settingsStore'

// A 1440×900 MacBook screen below a 25 px menu bar.
const WA = { x: 0, y: 25, width: 1440, height: 875 }

describe('window size presets', () => {
  it('cycles Small → Medium → Large → Full → Small', () => {
    expect(nextWindowSize('small', 360)).toBe('medium')
    expect(nextWindowSize('medium', 440)).toBe('large')
    expect(nextWindowSize('large', 600)).toBe('full')
    expect(nextWindowSize('full', 1440)).toBe('small')
  })

  it('Full fills the whole work area of the screen it is on', () => {
    const docked = { x: 1440 - 24 - 440, y: 97, width: 440, height: 640 }
    const full = fitWindow(docked, WA, WINDOW_SIZES.full, 0)
    expect(full).toEqual(WA)
    expect(fillsWorkArea(full, WA)).toBe(true)
    expect(fillsWorkArea(docked, WA)).toBe(false)
    expect(fillsWorkArea({ ...WA, width: WA.width - 1 }, WA)).toBe(true) // rounding
    expect(presetFor({ width: 1440, height: 875 })).toBe('custom') // Full is only ever chosen, not guessed
  })

  it('from a dragged size goes to the next preset wider than the window', () => {
    expect(nextWindowSize('custom', 320)).toBe('small')
    expect(nextWindowSize('custom', 400)).toBe('medium')
    expect(nextWindowSize('custom', 500)).toBe('large')
    expect(nextWindowSize('custom', 900)).toBe('full')
  })

  it('recognises a preset size, allowing for rounding', () => {
    expect(presetFor(null)).toBe('medium')
    expect(presetFor({ width: 440, height: 640 })).toBe('medium')
    expect(presetFor({ width: 601, height: 859 })).toBe('large')
    expect(presetFor({ width: 520, height: 700 })).toBe('custom')
  })

  it('keeps the top edge and the right edge of a window docked at the right', () => {
    const docked = { x: 1440 - 24 - 440, y: 25 + 72, width: 440, height: 640 }
    const small = fitWindow(docked, WA, WINDOW_SIZES.small, 24)
    expect(small).toEqual({ x: 1440 - 24 - 360, y: 97, width: 360, height: 460 })
    expect(small.x + small.width).toBe(docked.x + docked.width)
  })

  it('keeps the left edge of a window on the left side', () => {
    const left = { x: 40, y: 200, width: 440, height: 640 }
    expect(fitWindow(left, WA, WINDOW_SIZES.small, 24)).toMatchObject({ x: 40, y: 200 })
  })

  it('shrinks Large to fit a small screen and keeps it on screen', () => {
    const docked = { x: 1440 - 24 - 440, y: 97, width: 440, height: 640 }
    const large = fitWindow(docked, WA, WINDOW_SIZES.large, 24)
    expect(large.width).toBe(600)
    expect(large.height).toBe(875 - 48) // 860 does not fit
    expect(large.y + large.height).toBeLessThanOrEqual(WA.y + WA.height)
    expect(large.x + large.width).toBe(docked.x + docked.width)
  })

  it('works on a second display to the left with negative coordinates', () => {
    const wa = { x: -1920, y: 0, width: 1920, height: 1080 }
    const win = { x: -1920 + 1920 - 24 - 360, y: 72, width: 360, height: 460 }
    const r = fitWindow(win, wa, WINDOW_SIZES.large, 24)
    expect(r).toEqual({ x: -24 - 600, y: 72, width: 600, height: 860 })
  })
})

describe('window size setting', () => {
  it('defaults to Medium and keeps a valid choice', () => {
    expect(DEFAULT_SETTINGS.windowSize).toBe('medium')
    expect(sanitize({ windowSize: 'large' }).windowSize).toBe('large')
    expect(sanitize({ windowSize: 'custom' }).windowSize).toBe('custom')
    expect(sanitize({ windowSize: 'full' }).windowSize).toBe('full')
  })

  it('works out the size for settings saved before presets existed', () => {
    const at = (width: number, height: number) => ({ bounds: { x: 0, y: 0, width, height } })
    expect(sanitize({}).windowSize).toBe('medium')
    expect(sanitize(at(440, 640)).windowSize).toBe('medium')
    expect(sanitize(at(512, 700)).windowSize).toBe('custom')
    expect(sanitize({ ...at(440, 640), windowSize: 'huge' as never }).windowSize).toBe('medium')
  })

  it('adds the new shortcut to saved shortcuts', () => {
    const s = sanitize({ shortcuts: { ...DEFAULT_SETTINGS.shortcuts, cycleWindowSize: undefined as never } })
    expect(s.shortcuts.cycleWindowSize).toBe('CommandOrControl+Alt+Shift+W')
  })
})
