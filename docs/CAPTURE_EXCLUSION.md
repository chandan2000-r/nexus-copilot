# Screen-capture exclusion

Nexus AI keeps its window visible and usable on your own screen while asking the
operating system to leave it out of screen captures. It uses only documented OS APIs.
It never hides, minimizes or moves the window when a share starts, and it does not try
to detect screen sharing.

## How it works

| Platform | API | Code | How it is checked |
|---|---|---|---|
| macOS | `-[NSWindow setSharingType:NSWindowSharingNone]` (AppKit) | `src/native/macos/capture_guard.mm` | `-[NSWindow sharingType]` is read back after every change |
| Windows 10 2004+ / 11 | `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` | `src/native/windows/capture_guard.cc` | `GetWindowDisplayAffinity` is read back |
| Windows before 10 2004 | `SetWindowDisplayAffinity(hwnd, WDA_MONITOR)` (fallback) | same | Reported as **Partially hidden**: captures show a black box |
| Native addon missing | Electron `BrowserWindow.setContentProtection(true)` | `src/main/captureGuard.ts` | Reported as **Hidden (unverified)** |

The native window handle comes from `BrowserWindow.getNativeWindowHandle()`. On macOS
that is an `NSView*`, and its `window` is the `NSWindow`. On Windows it is the `HWND`.

Exclusion is applied **before the window is first shown**. It is read back every time the
window is shown or the Settings panel asks for status, and re-applied if it has drifted.

The status pill in the title bar and the card at the top of Settings show:

* **Hidden from capture**: the OS reports the exclusion value we set.
* **Partially hidden**: Windows `WDA_MONITOR` fallback (black box).
* **Hidden (unverified)**: set through Electron because the native addon did not load.
* **Visible in capture**: exclusion turned off by the user.
* **Exclusion failed**: the OS call or the read-back failed. The detail line says why.

"Hidden from capture" means the OS accepted the flag. It does **not** prove that a
particular meeting app respects it. Only the test matrix proves that.

## Capture methods that may not respect exclusion

These are known or reported limits. Record what you actually see in
[TEST_MATRIX.md](TEST_MATRIX.md).

### macOS

* **ScreenCaptureKit on macOS 15 and later.** `NSWindowSharingNone` is an older AppKit
  flag. Developers report that windows using it can still appear in ScreenCaptureKit
  captures on macOS 15+. Zoom, Teams, Meet in Chrome and Safari, QuickTime and
  `screencapture` all use ScreenCaptureKit on current macOS. Apple provides no public
  per-window opt-out in ScreenCaptureKit that another process must follow. **Test this on
  your exact macOS version.**
* Older `CGWindowListCreateImage` / `CGDisplayStream` captures on macOS 14 and earlier
  generally respect `NSWindowSharingNone`.
* AirPlay or Sidecar mirroring, and external HDMI capture of a mirrored display, see the
  composited screen.

### Windows

* `WDA_EXCLUDEFROMCAPTURE` needs Windows 10 version 2004 (build 19041) or later.
  Older builds get `WDA_MONITOR`, which shows a black rectangle.
* Tools that capture below the Windows capture APIs can ignore display affinity. That
  includes some GPU and driver-level recorders, hardware encoders fed from the display
  output, and some remote-management, proctoring or anti-cheat software.
* Remote Desktop and virtual-machine consoles: behaviour depends on the host. Test
  separately.

### Everywhere

* Cameras, phones and HDMI capture cards record the physical display.
* Exclusion hides pixels only. Other software can still see that the window exists,
  through window lists and accessibility APIs.

## What Nexus AI deliberately does not do

* It uses no private or undocumented APIs, no injection into other processes, and no
  hooks into meeting apps.
* It does not detect screen sharing or react to it.
* It does not hide or minimize itself automatically.
* It does not try to defeat monitoring, proctoring or security software.
