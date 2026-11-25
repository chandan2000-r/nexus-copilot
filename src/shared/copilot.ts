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
  /** Progress the user should see (e.g. the one-time speech model download). null clears it. */
  | { type: 'status'; source: Speaker; message: string | null }

export type MessageKind = 'chat' | 'answer' | 'screen'

/** Versions of one answer: 'auto' (the answer style from Settings) and the three answer modes. */
export type AnswerMode = 'quick' | 'interview' | 'detailed'
export type AnswerVersion = 'auto' | AnswerMode
export const ANSWER_VERSIONS: AnswerVersion[] = ['auto', 'quick', 'interview', 'detailed']

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  kind: MessageKind
  /** For answers: the version on show (versions[version]). */
  content: string
  at: number
  /** Answers only. */
  bookmarked?: boolean
  versions?: Partial<Record<AnswerVersion, string>>
  version?: AnswerVersion
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
  bookmarks: number
}

/** A history search match. */
export interface SessionSearchHit {
  sessionId: string
  title: string
  startedAt: number
  where: 'title' | 'question' | 'answer' | 'transcript'
  /** The matching text, shortened around the match. */
  snippet: string
}

/** A bookmarked answer with its question, across all saved sessions. */
export interface BookmarkItem {
  sessionId: string
  sessionTitle: string
  messageId: string
  question: string
  answer: string
  at: number
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
