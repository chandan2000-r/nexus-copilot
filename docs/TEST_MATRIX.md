# Capture-exclusion test matrix

Record **actual** results only. Use these values: **Hidden**, **Visible**,
**Black box**, **Not tested**. Note the app version and OS build. Retest after every
macOS or Windows update and after every meeting-app update.

How to test each row:

1. Start Nexus AI and open Settings. Check that the status card reads
   **Hidden from capture** and write down the mechanism and OS value.
2. Start the share or recording.
3. Look at what the **other side** receives: a second device in the meeting, or the
   recorded file. Your own screen is not a valid check.
4. While sharing, drag, resize and type in Nexus AI. Confirm it stays visible and works
   on your screen.

## macOS

OS version: ________  Mac model: ________  Nexus AI version: 0.1.0

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | Normal desktop: window visible and usable locally | Pass (dev, 2026-11-22) | macOS 26.4, Apple Silicon. Window renders, chat streams, settings work. |
| 2 | Full-screen share: Zoom | Not tested | |
| 3 | Single-window share: Zoom | Not tested | |
| 4 | Full-screen share: Google Meet (Chrome) | Not tested | |
| 5 | Window/tab share: Google Meet (Chrome) | Not tested | |
| 6 | Full-screen share: Microsoft Teams | Not tested | |
| 7 | Single-window share: Microsoft Teams | Not tested | |
| 8 | QuickTime Player: New Screen Recording | Not tested | |
| 9 | `screencapture` CLI / ⌘⇧3 screenshot | Not tested | Dev terminal had no Screen Recording permission |
| 10 | Multiple monitors: share display 2 with Nexus on display 2 | Not tested | |
| 11 | Drag and resize while sharing | Not tested | |

## Windows

OS version / build: ________  Nexus AI version: 0.1.0

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | Normal desktop: window visible and usable locally | Not tested | |
| 2 | Full-screen share: Zoom | Not tested | |
| 3 | Single-window share: Zoom | Not tested | |
| 4 | Full-screen share: Google Meet (Chrome/Edge) | Not tested | |
| 5 | Window share: Google Meet | Not tested | |
| 6 | Full-screen share: Microsoft Teams | Not tested | |
| 7 | Single-window share: Microsoft Teams | Not tested | |
| 8 | Snipping Tool screen recording / Xbox Game Bar (Win+Alt+R) | Not tested | |
| 9 | Print Screen / Snipping Tool screenshot | Not tested | |
| 10 | Multiple monitors | Not tested | |
| 11 | Drag and resize while sharing | Not tested | |
| 12 | Windows build older than 2004 (expect black box) | Not tested | |

## Copilot features (real services)

Fill in with real API keys and a real call. Use: **Pass**, **Fail**, **Not tested**.

| # | Scenario | macOS | Windows | Notes |
|---|---|---|---|---|
| C1 | System audio ("Them") transcribed from Zoom / Meet / Teams | Not tested | Not tested | macOS: needs Screen & System Audio Recording permission |
| C2 | "Them" from a loopback device (BlackHole / VB-Cable) | Not tested | Not tested | |
| C3 | Microphone ("You") transcribed | Not tested | Not tested | |
| C4 | Whisper engine: OpenAI (`gpt-transcribe`) | Not tested | Not tested | |
| C5 | Whisper engine: Groq (`whisper-large-v3-turbo`) | Not tested | Not tested | |
| C6 | Deepgram streaming (`nova-3`) | Not tested | Not tested | |
| C7 | Gemini transcription | Not tested | Not tested | |
| C8 | Answers: OpenAI (`gpt-5-mini`) | Not tested | Not tested | |
| C9 | Answers: Anthropic (`claude-haiku-5-5`) | Not tested | Not tested | |
| C10 | Answers: Gemini (`gemini-flash-latest`) | Not tested | Not tested | |
| C11 | Answers: Ollama with a local model | Not tested | Not tested | |
| C12 | Auto-answer fires on real interviewer questions, not on small talk | Not tested | Not tested | |
| C13 | Analyze screen on a real coding problem (vision model) | Not tested | Not tested | macOS: Screen Recording permission |
| C14 | Global shortcuts work while the meeting app has focus | Not tested | Not tested | |

## Automated checks run during development

See the "Verification log" section at the end of this file.

## Verification log

### 2026-11-22: macOS 26.4 (25E246), Apple Silicon, Electron 45.4.1, dev build

What was checked:

* Native addon built for arm64 and loaded. Status card: `Hidden from capture`,
  mechanism `NSWindowSharingNone`, OS value `0`.
* **Window-server check from another process** (`swift scripts/inspect-windows-mac.swift Electron`):
  `layer=3 bounds=1046,105 400x500 sharingState=NONE (excluded)`. This confirms that
  macOS itself recorded the flag. It does **not** confirm what a ScreenCaptureKit-based
  app sends.
* Turning exclusion off in Settings changes it to `sharingState=READ_ONLY (capturable)`.
  Turning it back on returns `NONE`. UI, native call and window server agree.
* Chat send and streaming (placeholder provider), the settings panel and the status
  card render correctly.

* Packaged app (`release/mac-arm64/Nexus AI.app` from the .dmg build): the addon loads
  from `Resources/native`. The window server reports
  `owner=Nexus AI layer=3 400x500 sharingState=NONE (excluded)`.

What was **not** checked: any real pixel capture. `screencapture` failed because the
terminal had no Screen Recording permission. Zoom, Meet, Teams and QuickTime were not
tested. On macOS 15+ these are the results that matter most. Fill in the macOS table.

Windows: not built or tested yet. It needs a Windows machine or the GitHub Actions workflow.

### 2026-11-23: copilot build, macOS 26.4, Apple Silicon, Electron 45.4.1 (Chrome 156), dev build

* `npm test`: 46 unit tests pass. They cover VAD segmentation, 48/44.1 kHz → 16 kHz resampling,
  WAV encoding, SSE / NDJSON parsing, the OpenAI-compatible, Anthropic, Gemini and Ollama
  providers and the Whisper and Gemini transcription requests (against a local HTTP server),
  Deepgram streaming (fake socket), question detection, prompt building and the Markdown parser.
* `npm run test:e2e`: 13/13 steps pass against `scripts/mock-ai.mjs`. Chromium's fake microphone
  (fed from a WAV) → renderer PCM → IPC → VAD → mock Whisper → transcript; auto-answer on an
  injected interviewer question and no answer on a non-question; the answer-now command; screen
  analysis with a stubbed capture (image reaches the model); model list and connection test;
  PDF resume import; capture-exclusion status `Hidden from capture`; session autosave and history.
* **Not** checked: any real AI provider or transcription service (no API keys were used), real
  system-audio loopback (it needs the OS permission prompt), real screenshots, and global shortcuts
  pressed from another app. Fill in the Copilot table above.
