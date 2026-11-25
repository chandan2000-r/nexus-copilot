/** Prompt construction for the copilot. Pure functions, used by the renderer. */
import type { AnswerMode, MessageKind, TranscriptLine } from '../../shared/copilot'
import type { AnswerStyle, CopilotMode, CopilotSettings, ProfileSettings } from '../../shared/settings'
import { windowStart } from '../ai/contextWindow'
import type { ChatMessage, ImageAttachment } from '../ai/types'

export const MODE_LABELS: Record<CopilotMode, string> = {
  interview: 'Interview',
  coding: 'Coding interview',
  meeting: 'Meeting',
  sales: 'Sales call',
  general: 'General'
}

export const STYLE_LABELS: Record<AnswerStyle, string> = {
  concise: 'Concise',
  detailed: 'Detailed',
  star: 'STAR (behavioural)',
  bullets: 'Bullet points'
}

const ROLE: Record<CopilotMode, string> = {
  interview:
    'The user is the candidate in a live job interview. "Them" in the transcript is the interviewer, "You" is the user. ' +
    'Write the answer the user can say out loud, in the first person, in a natural spoken tone.',
  coding:
    'The user is the candidate in a live technical / coding interview. "Them" is the interviewer. ' +
    'For coding problems: state the approach in 1–2 sentences, give clean working code in a fenced block (Python unless another language is visible or requested), ' +
    'then time and space complexity, then one line on edge cases. For conceptual questions, answer as the candidate would say it.',
  meeting:
    'The user is in a live meeting. "Them" is the other participants, "You" is the user. ' +
    'Give the user the most useful thing to say next: a direct answer, a clarifying question, or a crisp summary of a decision.',
  sales:
    'The user is on a live sales call. "Them" is the prospect, "You" is the user. ' +
    'Suggest what to say next: handle objections honestly, ask good discovery questions, and move toward a clear next step. Never invent product facts.',
  general: 'The user is in a live conversation. Help them understand and respond to what is being discussed.'
}

const STYLE: Record<AnswerStyle, string> = {
  concise: 'Keep it short: 2–4 sentences, or up to 4 short bullets. It must be readable at a glance in about 10 seconds.',
  detailed:
    'Give a complete, technical answer of about 120–220 words: precise terms, how it works under the hood, the key trade-off or failure mode, and exact commands, configuration or code in fenced code blocks when they help.',
  star:
    'For behavioural questions use STAR: **Situation**, **Task**, **Action**, **Result**, one or two sentences each, with a measurable result where the profile supports it. For other questions be concise.',
  bullets: 'Answer only in bullet points: at most 6 bullets, each under 15 words.'
}

export function systemPrompt(copilot: CopilotSettings, profile: ProfileSettings): string {
  const parts = [
    'You are Nexus, a real-time conversation copilot. The user reads your output on a small overlay while they are talking, so:',
    '- Put the answer first. No preamble, no "Great question", no restating the question.',
    '- Use Markdown sparingly: short paragraphs, bullets, **bold** key terms, fenced code blocks for code.',
    `- ${STYLE[copilot.answerStyle]}`,
    '- Be accurate. Use specifics from the user\'s profile below; never invent employers, titles, dates, numbers or credentials that are not in it. If a detail is missing, answer from general experience or leave a short [placeholder] for the user to fill.',
    '- Technical questions (programming, frameworks, system design, databases, cloud, DevOps, data, ML, networking, security): open with the precise, correct answer in one sentence, then the specifics an expert interviewer listens for: how it works, the key trade-off or when to use it, and a concrete example (from the profile when one fits). Use exact names of technologies, APIs and complexities; no vague filler. Add a short code snippet only when it makes the point faster.',
    '- The transcript comes from speech recognition and may contain mistakes, especially in technical terms (e.g. "cube control" for kubectl, "post gress" for Postgres); infer the intended words and use the correct terms in your answer.',
    copilot.responseLanguage
      ? `- Always respond in ${copilot.responseLanguage}.`
      : '- Respond in the language the question was asked in.',
    '',
    ROLE[copilot.mode]
  ]
  const ctx: string[] = []
  if (profile.role.trim()) ctx.push(`Target role: ${profile.role.trim()}`)
  if (profile.company.trim()) ctx.push(`Company: ${profile.company.trim()}`)
  if (profile.resume.trim()) ctx.push(`<resume>\n${profile.resume.trim()}\n</resume>`)
  if (profile.jobDescription.trim()) ctx.push(`<job_description>\n${profile.jobDescription.trim()}\n</job_description>`)
  if (profile.instructions.trim()) ctx.push(`<user_instructions>\n${profile.instructions.trim()}\n</user_instructions>`)
  if (ctx.length) parts.push('', 'About the user:', ...ctx)
  return parts.join('\n')
}

/**
 * Recent transcript as "Them: …" / "You: …" lines, newest last, capped to `maxChars`. The window
 * start moves in steps (between 2/3 and all of `maxChars` is kept), so consecutive requests begin
 * with the same text and local models can reuse their prompt cache.
 */
export function formatTranscript(lines: TranscriptLine[], maxChars = 6_000): string {
  const out = lines.map((l) => `${l.source === 'them' ? 'Them' : 'You'}: ${l.text}`)
  const start = windowStart(
    out.map((l) => l.length + 1),
    maxChars,
    Math.floor(maxChars / 3)
  )
  return out.slice(start).join('\n')
}

/**
 * Opening shared by every request type. A local model processes it while people talk
 * (useCopilot prefill), so when the question comes only the question is left to read.
 */
export function transcriptBlock(transcript: string): string {
  return transcript ? `Live transcript so far (newest last):\n${transcript}\n` : ''
}

/**
 * The shape of an automatic answer, per answer style. Stated right after the question because
 * small local models follow the end of the prompt most closely: without it qwen2.5:3b answered
 * "How does HTTPS keep data secure?" with one bare sentence. Worded as plain instructions,
 * not labels, so they are not copied into the answer.
 */
const ANSWER_SHAPE: Record<AnswerStyle, string> = {
  concise:
    "Write the user's reply now, as they would say it: the answer in the first sentence, then two or three sentences on how it works, with a concrete example.",
  detailed:
    "Write the user's reply now. Open with the direct answer, then explain how it works under the hood (name the exact components, commands, settings or APIs), the key trade-off or failure mode, and a concrete example; put any command, configuration or code in a fenced code block. No labels such as 'Answer:' or 'The answer in one sentence:'.",
  star: "Write the user's reply now, as they would say it: for a behavioural question a short STAR story; otherwise the answer in the first sentence, then how it works, with a concrete example.",
  bullets:
    "Write the user's reply now as 3 to 5 short bullet points to glance at while speaking: the answer first, then how it works, then a concrete example. For a question about the user, the points are their own answer in the first person."
}

/** "Write a Python script for log rotation", "give me the kubectl command", "SQL query for…" */
const CODE_REQUEST = /\b(script|code|program|function|query|regex|snippet|dockerfile|manifest|yaml|commands?)\b|\bwrite (?:a|an|me|the|some)\b/i

export function wantsCode(question: string): boolean {
  return CODE_REQUEST.test(question)
}

/** Whatever the answer style: bullet points cannot hold the script someone asked for. */
const CODE_SHAPE = 'Write the code they asked for now, complete and runnable, in a fenced code block, then one or two lines on how it works.'
/** "Give me the kubectl command…": the command itself, not a program that runs it. */
const COMMAND_SHAPE = 'Give the exact command or commands now in a fenced code block (no script around them), then one line on what each does.'
const COMMAND_REQUEST = /\bcommands?\b/i
const codeShape = (question: string) => (COMMAND_REQUEST.test(question) ? COMMAND_SHAPE : CODE_SHAPE)

export const ANSWER_MODE_LABELS: Record<AnswerMode, string> = { quick: 'Quick', interview: 'Interview', detailed: 'Detailed' }

/** Per-answer modes (the answer actions): switch an answer to another length and depth. */
const MODE_SHAPE: Record<AnswerMode, string> = {
  quick: "Write the user's reply now in 2 to 4 sentences: the answer first, then the one detail that matters most.",
  interview:
    "Write the user's reply now as a 30 to 60 second spoken answer in the first person: the answer first, then how it works, then a concrete example (from their own experience when the profile has one).",
  detailed:
    'Write a detailed answer now: the answer first, then how it works step by step, the key trade-offs, and the exact commands, configuration or code in fenced code blocks where they help.'
}
const codeModeShape = (question: string, mode: AnswerMode) =>
  mode === 'quick'
    ? 'Write only the essential code or command they asked for, in a fenced code block, with one line on how it works.'
    : mode === 'detailed'
      ? `${codeShape(question)} Then explain each part and how to run it.`
      : codeShape(question)

/**
 * The request for an answer. `mode` set: a version made with the answer actions (Quick /
 * Interview / Detailed); otherwise the automatic answer in the answer style from Settings.
 */
export function answerPrompt(question: string, transcript: string, style: AnswerStyle = 'concise', mode?: AnswerMode): string {
  const code = wantsCode(question)
  const shape = mode ? (code ? codeModeShape(question, mode) : MODE_SHAPE[mode]) : code ? codeShape(question) : ANSWER_SHAPE[style]
  // Small local models tend to just repeat a quoted question back; saying what to write stops that.
  return [transcriptBlock(transcript), `"Them" just said: "${question}"\n${shape} Do not repeat the question.`]
    .filter(Boolean)
    .join('\n')
}

/**
 * Transcript kept in requests to a model on this computer. Measured on a real session with
 * qwen2.5:3b: with the full transcript it answered "Can you provide a Python script for log
 * rotation?" about the VPC discussed a minute earlier (2 of 3 times); with the last few lines
 * it answered every question on topic and still followed up on "What should I do after that?".
 */
export const LOCAL_TRANSCRIPT_CHARS = 700

export function screenPrompt(instruction: string, transcript: string): string {
  return [
    transcriptBlock(transcript),
    'The attached image is a screenshot of the user\'s screen.',
    'If it shows a coding or technical problem, solve it (approach, code in a fenced block, complexity). ' +
      'If it shows a question, slide, document or error, explain the key points and what the user should say or do next.',
    instruction.trim() ? `The user adds: ${instruction.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function chatPrompt(text: string, transcript: string): string {
  if (!transcript) return text
  return `${transcriptBlock(transcript)}\nThe user asks: ${text}`
}

export interface HistoryItem {
  role: 'user' | 'assistant'
  kind: MessageKind
  /** What the user sees (the question, or their typed message). */
  content: string
  /** What was actually sent for this turn (with transcript and instructions). */
  prompt?: string
  images?: ImageAttachment[]
}

/**
 * Builds the request: system prompt, earlier turns in compact form (so the transcript is
 * not repeated in every turn), and the newest user turn in full.
 */
export function buildMessages(system: string, history: HistoryItem[]): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: 'system', content: system }]
  // The newest user turn (an empty, in-flight assistant reply may come after it).
  const newestUser = history.map((h) => h.role).lastIndexOf('user')
  history.forEach((h, i) => {
    const last = i === newestUser
    if (h.role === 'assistant') {
      if (h.content.trim()) msgs.push({ role: 'assistant', content: h.content })
      return
    }
    if (last) {
      msgs.push({ role: 'user', content: h.prompt ?? h.content, ...(h.images?.length ? { images: h.images } : {}) })
    } else {
      const compact =
        h.kind === 'answer' ? `They asked: "${h.content}"` : h.kind === 'screen' ? `[Shared a screenshot] ${h.content}` : h.content
      msgs.push({ role: 'user', content: compact })
    }
  })
  return msgs
}

/**
 * Removes the scaffolding small models copy from the instructions into the answer: a leading
 * "Answer:" / "The precise, correct answer in one sentence:" and lines that are only such a label.
 */
export function tidyAnswer(text: string): string {
  const label = /(?:\*\*)?(?:answer|the (?:direct |precise(?:, correct)? )?answer(?: in (?:one|the first) sentence)?)\s*:(?:\*\*)?/i
  return text
    .replace(new RegExp(`^\\s*${label.source}[ \\t]*\\n?`, 'i'), '')
    .replace(new RegExp(`^[ \\t]*${label.source}[ \\t]*$\\n?`, 'gim'), '')
}

