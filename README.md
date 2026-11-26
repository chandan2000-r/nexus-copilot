# Nexus AI

A floating, always-on-top AI copilot for live conversations on **macOS** and **Windows 10/11**.
It listens to the call, transcribes both sides, spots questions as they are asked, and streams
an answer written from your own resume and the job description. It can also solve whatever is on
your screen (coding problems, slides, error messages). You see the window; it asks the OS to leave
it out of screen shares and recordings.

Works with Zoom, Google Meet, Microsoft Teams, Webex, and any app that plays audio through your computer.

> Capture exclusion uses documented OS mechanisms. Whether a given meeting app respects them
> depends on the app and OS version: read [docs/CAPTURE_EXCLUSION.md](docs/CAPTURE_EXCLUSION.md)
> and record real results in [docs/TEST_MATRIX.md](docs/TEST_MATRIX.md). **Do not assume universal invisibility.**

## Features

| | |
|---|---|
| **Live transcription** | System audio ("Them": the other side of the call) and your microphone ("You"), labelled per speaker. Default: NVIDIA Parakeet **on this computer** (free, no key, words appear while people talk, ~0.1 s per sentence). Also Whisper-compatible APIs (OpenAI, Groq, local servers), Deepgram real-time streaming, or Google Gemini for 25 languages. |
| **Auto-answer** | Detects when the other side finishes a question and streams an answer immediately. Toggle with **⚡ Auto**; or answer on demand with the ⚡ button / shortcut. Newest question always wins. Only the newest question is answered (not remarks before it), a cough or typing after a question does not hold the answer back, and requests for a script, query or command always get code, whatever the answer style. |
| **Answer actions** | Under every answer: **Auto / Quick / Interview / Detailed** (Quick: 2–4 sentences; Interview: a 30–60 s spoken answer; Detailed: commands, configuration, trade-offs). Each version is written once for the same question and transcript and kept, so switching back is instant. Also **Regenerate**, **Bookmark**, **Read aloud** (the system voice; Nexus's own voice is kept out of the transcript) and **Copy**. |
| **Personal answers** | Resume (paste or import PDF / Markdown / text), job description, target role, company and your own instructions go into every request. The prompt forbids inventing employers, numbers or credentials that are not in your profile. |
| **Modes and styles** | Interview, Coding interview, Meeting, Sales call, General. Answer styles: Detailed (default: technical, how it works under the hood, trade-offs, exact commands and config), Concise, STAR, Bullets. Answer language can be fixed or follow the question. |
| **Screen analysis** | One shortcut screenshots the display the overlay is on (the overlay itself is excluded) and sends it to a vision model: approach, code, complexity for coding problems; key points for anything else. |
| **Any model** | OpenAI and any OpenAI-compatible API (Groq, OpenRouter, DeepSeek, Together, LM Studio, vLLM), Anthropic Claude, Google Gemini, or local models through Ollama. "Load" fetches the provider's live model list; "Test connection" checks key + model. **Answer speed** (default: Fastest) turns down the hidden reasoning of GPT-5 / o-series, Gemini and local thinking models so answers start streaming sooner. Local models read the conversation ahead of time, so answers start in well under a second. |
| **Session history** | Transcripts and answers are saved locally per session; browse, **search** (questions, answers, transcripts), a **Bookmarks** view across sessions, export to Markdown (bookmarks marked ★), or delete. |
| **Overlay** | Frameless translucent window, always on top (non-activating panel on macOS, floats over full-screen apps and does not steal focus), opacity, display picker, remembered position, tray / menu-bar menu. |
| **Window sizes** | **Small** (360×460), **Medium** (440×640, default) and **Large** (600×860), switched while Nexus runs: the **S / M / L** button in the title bar (cycles), the shortcut, the tray / menu-bar menu (Window Size) or Settings → General. The top edge and the side nearest the screen edge stay put; Large is reduced to fit smaller screens. Dragging the window edge still sets any size. |
| **Out of recent activity** | On by default (Settings → General, or the menu-bar menu): on macOS Nexus has no Dock icon, so it is not in the Dock, the Dock's recent apps or Cmd+Tab (open it from the menu-bar icon or the shortcut); on Windows it has no taskbar button. Minimise hides the window instead of leaving it in the Dock / taskbar. Resume imports and session exports are not added to recent items, and the app's macOS recent-documents list is cleared at start. The OS's own record that an app was launched is left alone. |
| **Capture exclusion** | `NSWindowSharingNone` on macOS, `WDA_EXCLUDEFROMCAPTURE` on Windows, set by a native addon and **verified by reading the value back**; live status pill. |
| **Private by design** | API keys are encrypted with the OS key store (Keychain / DPAPI) and never reach the UI process. Everything is stored on this computer; audio, transcripts and screenshots go only to the providers you configure. |

### Global shortcuts (configurable in Settings → General)

| Action | Default |
|---|---|
| Start / stop listening | `Cmd/Ctrl + Shift + L` |
| Answer the latest question | `Cmd/Ctrl + Shift + Return` |
| Analyze screen | `Cmd/Ctrl + Shift + H` |
| Show / hide (without taking focus) | `Cmd/Ctrl + Shift + Space` |
| Show and focus the input | `Cmd/Ctrl + Shift + J` |
| Move to next display | `Cmd/Ctrl + Alt + Shift + M` |
| Change window size (Small → Medium → Large) | `Cmd/Ctrl + Alt + Shift + W` |

In the input box: `Enter` sends, `Cmd/Ctrl + Enter` answers the latest question, `Esc` stops an answer.

## Quick start

```bash
npm install      # also builds the native capture-exclusion addon
npm run dev      # start with hot reload
```

0. **Sign in** with your Interview Copilot account (see [Sign-in](#sign-in)).
1. **Settings → AI**: pick a provider, paste its API key, click **Test connection**.
   Fast choices for live answers: `gpt-5-mini` (OpenAI), `claude-haiku-5-5` (Anthropic),
   `gemini-flash-latest` (Google), or Groq's OpenAI-compatible endpoint.
2. **Settings → Audio**: the default engine, **On this computer (NVIDIA Parakeet)**, needs no key:
   the speech model (660 MB) downloads once, the first time you listen. English only. For other
   languages pick a cloud engine:
   * One OpenAI key can run everything (Whisper engine, default base URL).
   * One Google key can run everything (choose Google Gemini in both tabs).
   * Lowest latency: Deepgram (words appear while people talk), or Groq Whisper
     (`https://api.groq.com/openai/v1`, model `whisper-large-v3-turbo`).
3. **Settings → Profile**: import your resume and paste the job description.
4. Join your call, press **Listen** (or `Cmd/Ctrl+Shift+L`).

### Audio setup

* **macOS**: system audio needs macOS 13+ and **Screen & System Audio Recording** permission
  (System Settings → Privacy & Security); macOS asks the first time you press Listen. The
  microphone needs Microphone permission. Restart the app after granting.
  If system audio is not delivered on your setup, install a loopback device such as
  [BlackHole](https://github.com/ExistentialAudio/BlackHole), route the meeting's output to it,
  and choose it under **Them → Capture from**.
* **Windows**: system audio uses WASAPI loopback, no setup needed. VB-Cable also works as a
  "Them" input device.
* Turn on **You** to transcribe your own side. Use headphones, otherwise the microphone also hears
  the other side.

### Local model (no API key, nothing leaves the computer)

```bash
brew install ollama          # or download it from ollama.com
ollama pull qwen2.5:3b       # fastest good choice for live answers on 8 GB Macs
ollama pull gemma3:4b        # optional: lets screenshots work locally (vision)
```

In **Settings → AI** choose **Ollama (local)**, model `qwen2.5:3b`, and click **Test connection**.
The app keeps the model loaded, gives it a fixed 8k-token context, turns thinking off
(Answer speed: Fastest) and lets it read the transcript while people talk. When a question
comes it only has to read the question, so answers start in about 0.3 s instead of 4–10 s
(measured on an 8 GB M1). Screenshots go to an installed vision model automatically.
With the default on-this-computer transcription, nothing leaves the computer at all.

Measured on an 8 GB M1 with `qwen2.5:3b`, playing 36 spoken interview questions (24 different,
six English accents) into the microphone: the first words of the answer appear a median
1.45–1.57 s after the speaker stops (worst 2.0 s): ~0.67 s to be sure they stopped, ~0.15 s to
transcribe, ~0.12 s pause, ~0.5–0.6 s to the model's first word. Words show in the transcript
~0.65 s after someone starts talking. For automatic answers the local model gets the transcript
but not its own earlier answers, at temperature 0.2: small models otherwise blend an earlier
answer into the new one. Answer style **Concise** gives the best spoken answers with 3B models.

### Sign-in

Nexus AI opens with a sign-in page and only works with a signed-in Interview Copilot account
(the same accounts as the website; `ALLOW_REGISTRATION` there decides whether people can sign
up). The server address is `https://copilot.tailccb1cc.ts.net` by default; change it with
**Change** on the sign-in page. If the server requires subscriptions (`SUBSCRIPTION_REQUIRED`),
accounts without an active plan see a "plans" page instead of the app.

* The access token is kept encrypted in the main process (never in the window), and every
  feature (answers, listening, screenshots) checks the sign-in in the main process.
* While the app runs it checks in every 15 minutes, so the server's 2-hour idle limit is not
  hit mid-interview. A network blip does not sign you out; the server ending the sign-in does
  (expiry after `JWT_EXPIRE_MINUTES`, sign-out elsewhere, password change).
* If the server can't be reached at start, the app waits and retries every 30 seconds.
* **Settings → Account** shows who is signed in and has **Sign out** (which also ends the
  sign-in on the server).

### Try it without API keys

```bash
node scripts/mock-ai.mjs   # OpenAI-compatible mock on http://127.0.0.1:8010/v1
```

Set **AI → Base URL** and **Audio → Base URL** to `http://127.0.0.1:8010/v1` and the model to
`mock-fast`. Answers and transcripts are canned, but the whole pipeline runs.

## Requirements

| | macOS | Windows |
|---|---|---|
| Node.js | 20.19+ or 22.12+ | 20.19+ or 22.12+ |
| Native toolchain | Xcode or Command Line Tools (`xcode-select --install`) | Visual Studio 2022 Build Tools with **Desktop development with C++** |
| Python | 3.x (for node-gyp) | 3.x (for node-gyp) |
| OS | macOS 12+ (13+ for system audio) | Windows 10 2004+ for full exclusion. Older builds get the black-box fallback. |

> Running from VS Code's integrated terminal? VS Code sets `ELECTRON_RUN_AS_NODE`, which makes
> Electron start as plain Node. `npm run dev`, `npm start` and the e2e script unset it for you.

If the native addon fails to build, the app still runs; capture exclusion falls back to Electron's
`setContentProtection` and the status shows **Hidden (unverified)**. To check it from outside the
app on macOS: `swift scripts/inspect-windows-mac.swift "Nexus AI"` (`sharingState=NONE` = excluded).

## Tests

```bash
npm test            # unit tests (Vitest): VAD, resampling, WAV, SSE parsing, all four LLM
                    # providers and both transcription APIs against a local HTTP server,
                    # Deepgram streaming, question detection, prompts, Markdown
npm run test:e2e    # builds, then drives the real Electron app with Playwright against
                    # scripts/mock-ai.mjs in a throwaway profile (window shows ~30 s)
```

The e2e test feeds Chromium's fake microphone from a generated WAV and stubs screen capture,
file dialogs and permission checks, so it never triggers OS permission prompts. Screenshots go
to `$E2E_OUT` (default: `<tmp>/nexus-e2e`). `NEXUS_USER_DATA=/some/dir` runs the app with a
separate data folder.

## Build installers

```bash
npm run dist:mac     # → release/Nexus-AI-<version>-mac-<arch>.dmg   (run on a Mac)
npm run dist:win     # → release/Nexus-AI-Setup-<version>-x64.exe   (run on Windows)
```

The native addon is C++/Objective-C++, so each installer must be built **on its own OS**.
`.github/workflows/build.yml` runs the tests and builds both on GitHub Actions (Actions tab, or
push a `v*` tag). For an Intel Mac build from Apple Silicon:
`npm_config_arch=x64 npm run build:native`, then `npx electron-builder --mac --x64`.

macOS builds are **ad-hoc signed** (`identity: "-"`): no Apple certificate, but the bundle is sealed,
so a downloaded copy is not reported as "damaged". The first launch is still blocked: open the app,
dismiss the warning, then **System Settings → Privacy & Security → Open Anyway** (on macOS 14 and
earlier, right-click the app → **Open** also works). Windows builds are unsigned: SmartScreen →
**More info → Run anyway**. To sign properly, set `CSC_LINK`/`CSC_KEY_PASSWORD` (and Apple
notarization variables), replace `identity: "-"` in `electron-builder.yml` and enable
`hardenedRuntime`. Ad-hoc signed builds may need permissions re-granted after each update.

## How it works

```
 system audio ─┐  getDisplayMedia + loopback        ┌─ Parakeet on this computer (sherpa-onnx; live preview + per utterance)
 microphone ───┤  → 16 kHz PCM (renderer) ── IPC ──>├─ Whisper API / Gemini (per utterance, after VAD)
               │                                    ├─ Deepgram (WebSocket stream)           (main)
               │                                    └─> transcript events ──┐
               │                                                            v
               │                   question detector (pause + heuristics) → answer request
 screenshot ───┘  desktopCapturer (main)                                   │
                                                                           v
 resume, job description, mode, style → system prompt → AIService → OpenAI-compatible / Claude / Gemini / Ollama
                                                                     (streamed back to the overlay)
```

All network calls happen in the main process, so API keys never enter the sandboxed renderer and
there is no CORS.

## Project layout

```
src/
  main/              Electron main process
    index.ts           app lifecycle, IPC, settings application
    windowManager.ts   floating window, bounds persistence, displays
    captureGuard.ts    capture-exclusion status and fallbacks
    media.ts           permission handlers, system-audio loopback, mic access, screenshots
    profileImport.ts   resume import (PDF via unpdf, Markdown, text)
    shortcuts.ts       global shortcuts → renderer commands
    tray.ts            tray / menu-bar icon
    preload.ts         contextBridge API (window.nexus)
  renderer/          React entry, styles, audio/capture.ts (MediaStream → PCM)
  components/        LoginPage, TitleBar, ControlBar, TranscriptPanel, AnswerView, ChatInput,
                     Markdown, HistoryPanel, SettingsPanel + settings/ tabs
  services/
    useCopilot.ts      listening, transcript, auto-answer, screen analysis, chat, autosave
    ai/                AIService, provider registry, providers, SSE helpers, context trimming
    account/           AccountService: sign-in, plan check, keep-alive (Interview Copilot API)
    stt/               resampler, WAV, VAD segmenter, Parakeet (localModel) / Whisper / Gemini /
                       Deepgram engines, tech-term fixes, service
    copilot/           prompts, question detector, Markdown parser
  native/            capture-exclusion addon (macOS AppKit, Windows user32), sherpa-onnx loader
  storage/           settings (JSON), API keys (safeStorage), sessions (JSON per session)
  shared/            types shared by main and renderer (settings, IPC, providers, transcript)
tests/               Vitest unit tests
scripts/             native build, e2e test, mock AI server, macOS window inspector
```

## Data on disk

In the user-data folder (`~/Library/Application Support/Nexus AI` on macOS,
`%APPDATA%\Nexus AI` on Windows):

* `settings.json`: settings and profile. Delete it to reset.
* `secrets.json`: API keys and the account sign-in token, encrypted with the OS key store.
* `models/`: the on-this-computer speech model (660 MB). Delete it to free the space; it
  downloads again the next time you listen with that engine.
* `sessions/`: one JSON file per saved session (turn off in Settings → AI → Save sessions).

## Responsible use

Nexus AI helps you think and speak on live calls: interview practice, meetings, sales calls,
language support. Many employers, schools and exam proctors do not allow AI assistance in live
assessments; check the rules before using it in one. The app does not detect screen sharing, hide
itself automatically, or try to defeat monitoring or proctoring software (see
[docs/CAPTURE_EXCLUSION.md](docs/CAPTURE_EXCLUSION.md)).
