/** Types for live transcription and saved sessions, shared by main and renderer. */
import type { CopilotMode } from './settings'

/** 'them' = the other side of the call (system audio), 'you' = your microphone. */
export type Speaker = 'them' | 'you'

export interface TranscriptLine {
  id: string
  source: Speaker
  text: string
  /** Epoch ms when the utterance started. */
  at: number
}

export type SttEvent =
  | { type: 'state'; source: Speaker; state: 'starting' | 'listening' | 'stopped' }
  /** Voice activity: someone started or stopped talking on this source. */
  | { type: 'speech'; source: Speaker; speaking: boolean }
  /** Streaming engines only: text of the utterance in progress. */
  | { type: 'partial'; source: Speaker; text: string }
  | { type: 'final'; source: Speaker; line: TranscriptLine }
  | { type: 'error'; source: Speaker; message: string }

export type MessageKind = 'chat' | 'answer' | 'screen'

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  kind: MessageKind
  content: string
  at: number
}

export interface SessionRecord {
  id: string
  title: string
  mode: CopilotMode
  startedAt: number
  updatedAt: number
  transcript: TranscriptLine[]
  messages: SessionMessage[]
}

export interface SessionSummary {
  id: string
  title: string
  mode: CopilotMode
  startedAt: number
  updatedAt: number
  questions: number
  lines: number
}

export interface ScreenCapture {
  mimeType: string
  /** Base64 image data. */
  data: string
  width: number
  height: number
}

/** Commands sent from global shortcuts / tray to the renderer. */
export type UiCommand = 'answer' | 'screen' | 'listen' | 'focus'
