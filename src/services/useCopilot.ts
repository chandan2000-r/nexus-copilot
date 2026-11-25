/**
 * Renderer-side copilot state: listening, live transcript, auto-answer, screen analysis,
 * chat, and session autosave. Talks to the main process over the preload bridge.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioPump, openSource } from '../renderer/audio/capture'
import type { AnswerVersion, MessageKind, SessionRecord, Speaker, SttEvent, TranscriptLine } from '../shared/copilot'
import { isLocalModel } from '../shared/providers'
import type { Settings } from '../shared/settings'
import type { ImageAttachment } from './ai/types'
import {
  answerPrompt,
  buildMessages,
  chatPrompt,
  formatTranscript,
  LOCAL_TRANSCRIPT_CHARS,
  screenPrompt,
  systemPrompt,
  transcriptBlock
} from './copilot/prompts'
import { latestQuestion, looksLikeQuestion, questionSnippet } from './copilot/questionDetector'

export interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  kind: MessageKind
  content: string
  /** Full prompt sent for this user turn (transcript + instructions). Not saved. */
  prompt?: string
  images?: ImageAttachment[]
  /** Small preview of an attached screenshot. Not saved. */
  thumb?: string
  /** Answer turns: the question answered and the transcript it was answered with (for other versions). Not saved. */
  question?: string
  context?: string
  at: number
  error?: string
  /** Assistant turns: every version made so far, and the one on show (also in `content`). */
  versions?: Partial<Record<AnswerVersion, string>>
  version?: AnswerVersion
  bookmarked?: boolean
}

type PerSpeaker<T> = Record<Speaker, T>

/**
 * Extra pause after a finished line before auto-answering (the transcription engine has already
 * waited for silence). A follow-up still replaces the answer, so these lean towards speed.
 */
const AUTO_ANSWER_DELAY_MS = 1_100
/** They ended on a question mark. */
const AUTO_ANSWER_QUESTION_DELAY_MS = 120
/** A question without a question mark ("Explain how Kafka orders messages."). */
const AUTO_ANSWER_LIKELY_DELAY_MS = 450
/** After a sound that produced no words, answer the question still waiting this much later. */
const RESUME_AFTER_NOISE_MS = 700
const SAVE_DEBOUNCE_MS = 1_500
/** After reading an answer aloud, lines heard this long afterwards are still Nexus's own voice. */
const READ_ALOUD_TAIL_MS = 1_200
/** Quiet time before a local model is handed the latest transcript to read ahead. */
const PREFILL_DELAY_MS = 600
const MAX_PENDING = 1_500

const newId = () => crypto.randomUUID()
const both = <T,>(v: T): PerSpeaker<T> => ({ them: v, you: v })

export function autoAnswerDelay(pending: string): number {
  if (/[?？]\s*$/.test(pending)) return AUTO_ANSWER_QUESTION_DELAY_MS
  return looksLikeQuestion(pending) ? AUTO_ANSWER_LIKELY_DELAY_MS : AUTO_ANSWER_DELAY_MS
}

/** Answer text as it should sound: no Markdown symbols, code blocks summarised. */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' (code shown on screen) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/[*_~>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanError(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function useCopilot(settings: Settings | null) {
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const [messages, setMessagesState] = useState<UiMessage[]>([])
  const [transcript, setTranscriptState] = useState<TranscriptLine[]>([])
  const [partials, setPartials] = useState<PerSpeaker<string>>(both(''))
  const [speaking, setSpeaking] = useState<PerSpeaker<boolean>>(both(false))
  const [levels, setLevels] = useState<PerSpeaker<number>>(both(0))
  const [active, setActive] = useState<PerSpeaker<boolean>>(both(false))
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [busy, setBusy] = useState<'screen' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState(newId)

  const messagesRef = useRef<UiMessage[]>([])
  const transcriptRef = useRef<TranscriptLine[]>([])
  const pumps = useRef(new Map<Speaker, AudioPump>())
  const current = useRef<{ requestId: string; messageId: string; version: AnswerVersion } | null>(null)
  /** The answer being written (for the caret and the actions), or null. */
  const [generating, setGenerating] = useState<string | null>(null)
  /** The answer being read aloud, and until when heard speech is Nexus's own voice. */
  const [reading, setReading] = useState<string | null>(null)
  const muteUntil = useRef(0)
  const pendingThem = useRef('')
  /** Who said the pending question. */
  const pendingFrom = useRef<Speaker | null>(null)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionStart = useRef(Date.now())
  const listeningRef = useRef(false)
  /** The last progress message shown, so clearing it does not wipe an unrelated notice. */
  const statusShown = useRef<string | null>(null)

  const setMessages = useCallback((fn: (m: UiMessage[]) => UiMessage[]) => {
    messagesRef.current = fn(messagesRef.current)
    setMessagesState(messagesRef.current)
  }, [])
  const setTranscript = useCallback((fn: (t: TranscriptLine[]) => TranscriptLine[]) => {
    transcriptRef.current = fn(transcriptRef.current)
    setTranscriptState(transcriptRef.current)
  }, [])

  // ---------- AI streaming ----------
  useEffect(
    () =>
      window.nexus.ai.onEvent((ev) => {
        const cur = current.current
        if (!cur || ev.requestId !== cur.requestId) return
        if (ev.type === 'delta') {
          setMessages((ms) =>
            ms.map((m) => {
              if (m.id !== cur.messageId) return m
              const text = (m.versions?.[cur.version] ?? '') + ev.text
              return { ...m, versions: { ...m.versions, [cur.version]: text }, ...(m.version === cur.version ? { content: text } : {}) }
            })
          )
          return
        }
        if (ev.type === 'error') {
          setMessages((ms) => ms.map((m) => (m.id === cur.messageId ? { ...m, error: ev.message } : m)))
        }
        current.current = null
        setStreaming(false)
        setGenerating(null)
      }),
    [setMessages]
  )

  const cancel = useCallback(() => {
    if (current.current) window.nexus.ai.cancel(current.current.requestId)
  }, [])

  const ask = useCallback(
    (
      kind: MessageKind,
      display: string,
      prompt: string,
      images?: ImageAttachment[],
      thumb?: string,
      asked?: { question: string; context: string }
    ) => {
      const s = settingsRef.current
      if (!s) return
      // Newest request wins: a fresh question supersedes the answer still streaming.
      cancel()
      const user: UiMessage = { id: newId(), role: 'user', kind, content: display, prompt, images, thumb, at: Date.now(), ...asked }
      const reply: UiMessage = { id: newId(), role: 'assistant', kind, content: '', at: Date.now(), version: 'auto', versions: { auto: '' } }
      // Small local models tend to blend an earlier answer into the new one, so automatic answers
      // get only the transcript (which already holds the conversation). Typed chat keeps the
      // earlier turns for follow-ups like "make it shorter".
      const history = isLocalModel(s.ai) && kind !== 'chat' ? [user] : [...messagesRef.current, user]
      const requestId = newId()
      current.current = { requestId, messageId: reply.id, version: 'auto' }
      setStreaming(true)
      setGenerating(reply.id)
      setNotice(null)
      setMessages((ms) => [...ms, user, reply])
      window.nexus.ai.send({ requestId, messages: buildMessages(systemPrompt(s.copilot, s.profile), history) })
      // The screenshot has been sent; keep only the thumbnail in memory.
      if (images?.length) setMessages((ms) => ms.map((m) => (m.id === user.id ? { ...m, images: undefined } : m)))
    },
    [cancel, setMessages]
  )

  // Local models get only the last few lines (see LOCAL_TRANSCRIPT_CHARS); the read-ahead uses
  // the same text so it matches the start of the real request.
  const transcriptText = () => {
    const s = settingsRef.current
    return formatTranscript(transcriptRef.current, s && isLocalModel(s.ai) ? LOCAL_TRANSCRIPT_CHARS : undefined)
  }

  const answer = useCallback(
    (questionText?: string) => {
      let q = (questionText ?? pendingThem.current).trim()
      if (!q) {
        // Nothing new since the last answer: use the latest thing the other side said.
        const lastThem = [...transcriptRef.current].reverse().find((l) => l.source === 'them')
        const lastAny = transcriptRef.current[transcriptRef.current.length - 1]
        q = (lastThem ?? lastAny)?.text ?? ''
      }
      if (!q) {
        setNotice('Nothing heard yet. Start listening, or type the question below.')
        return
      }
      pendingThem.current = ''
      pendingFrom.current = null
      if (autoTimer.current) clearTimeout(autoTimer.current)
      q = latestQuestion(q)
      const context = transcriptText()
      ask('answer', questionSnippet(q), answerPrompt(q, context, settingsRef.current?.copilot.answerStyle), undefined, undefined, {
        question: q,
        context
      })
    },
    [ask]
  )

  /**
   * Shows another version of an answer: Quick / Interview / Detailed, or the automatic one.
   * A version made before is shown at once; otherwise (or with `regenerate`) it is written now,
   * for the same question and the same transcript as the original. Chat replies can only be
   * regenerated; screenshot replies cannot (the image is not kept).
   */
  const answerAs = useCallback(
    (replyId: string, version: AnswerVersion, regenerate = false) => {
      const s = settingsRef.current
      const ms = messagesRef.current
      const at = ms.findIndex((m) => m.id === replyId)
      const reply = ms[at]
      const userAt = ms.slice(0, at).map((m) => m.role).lastIndexOf('user')
      const user = ms[userAt]
      if (!s || !reply || !user || user.kind === 'screen') return
      if (user.kind === 'chat' && version !== 'auto') return
      const made = reply.versions?.[version]
      if (!regenerate && made) {
        setMessages((all) => all.map((m) => (m.id === replyId ? { ...m, version, content: made, error: undefined } : m)))
        return
      }
      cancel()
      const prompt =
        user.kind === 'answer'
          ? answerPrompt(user.question ?? user.content, user.context ?? '', s.copilot.answerStyle, version === 'auto' ? undefined : version)
          : (user.prompt ?? user.content)
      // As for the first answer: local models answer from the transcript, without earlier turns.
      const earlier = isLocalModel(s.ai) && user.kind !== 'chat' ? [] : ms.slice(0, userAt)
      const requestId = newId()
      current.current = { requestId, messageId: replyId, version }
      setStreaming(true)
      setGenerating(replyId)
      setNotice(null)
      setMessages((all) =>
        all.map((m) => (m.id === replyId ? { ...m, version, versions: { ...m.versions, [version]: '' }, content: '', error: undefined } : m))
      )
      window.nexus.ai.send({ requestId, messages: buildMessages(systemPrompt(s.copilot, s.profile), [...earlier, { ...user, prompt }]) })
    },
    [cancel, setMessages]
  )

  const toggleBookmark = useCallback(
    (replyId: string) => setMessages((ms) => ms.map((m) => (m.id === replyId ? { ...m, bookmarked: !m.bookmarked } : m))),
    [setMessages]
  )

  /** Reads an answer aloud with the system voice. Nexus's own voice is kept out of the transcript. */
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const stopReading = useCallback(() => {
    utterance.current = null
    window.speechSynthesis?.cancel()
    setReading(null)
    muteUntil.current = Date.now() + READ_ALOUD_TAIL_MS
  }, [])
  const readAloud = useCallback(
    (replyId: string) => {
      const synth = window.speechSynthesis
      const m = messagesRef.current.find((x) => x.id === replyId)
      if (!synth || !m?.content) return
      synth.cancel()
      if (reading === replyId) return stopReading()
      const u = new SpeechSynthesisUtterance(speakable(m.content))
      u.onend = u.onerror = () => {
        // A cancelled earlier utterance also ends: only the current one may unmute.
        if (utterance.current !== u) return
        utterance.current = null
        setReading((r) => (r === replyId ? null : r))
        muteUntil.current = Date.now() + READ_ALOUD_TAIL_MS
      }
      utterance.current = u
      muteUntil.current = Number.MAX_SAFE_INTEGER
      setReading(replyId)
      synth.speak(u)
    },
    [reading, stopReading]
  )

  const sendChat = useCallback((text: string) => {
    const t = text.trim()
    if (t) ask('chat', t, chatPrompt(t, transcriptText()))
  }, [ask])

  const analyzeScreen = useCallback(
    async (instruction = '') => {
      if (busy) return
      setBusy('screen')
      setNotice(null)
      try {
        const shot = await window.nexus.media.captureScreen()
        const image = { mimeType: shot.mimeType, data: shot.data }
        ask(
          'screen',
          instruction.trim() || 'Analyze my screen',
          screenPrompt(instruction, transcriptText()),
          [image],
          `data:${shot.mimeType};base64,${shot.data}`
        )
      } catch (err) {
        setNotice(cleanError(err))
      } finally {
        setBusy(null)
      }
    },
    [ask, busy]
  )

  // ---------- Transcription ----------
  /** `minDelay`: wait at least this long (e.g. for a line that may still be on its way). */
  const scheduleAutoAnswer = useCallback(
    (minDelay = 0) => {
      if (autoTimer.current) clearTimeout(autoTimer.current)
      autoTimer.current = setTimeout(
        () => {
          const s = settingsRef.current
          const pending = pendingThem.current.trim()
          if (!s?.copilot.autoAnswer || !listeningRef.current || !pending) return
          if (looksLikeQuestion(pending)) answer(pending)
        },
        Math.max(minDelay, autoAnswerDelay(pendingThem.current))
      )
    },
    [answer]
  )

  /**
   * Whose questions get answered. Normally the other side's. With nobody else in the conversation
   * ("Them" is off, or nothing heard from them yet, e.g. trying the app alone or an in-person
   * interview through the microphone) your own spoken questions are answered too. The first words
   * from "Them" switch that off, so in a call your speech counts as you answering.
   */
  const asksQuestions = useCallback(
    (source: Speaker) =>
      source === 'them' || !settingsRef.current?.stt.captureThem || !transcriptRef.current.some((l) => l.source === 'them'),
    []
  )

  /**
   * Only the person who asked can delay the answer by talking on. Sound on the other source
   * (music or a notification through the speakers while you practise alone) must not.
   */
  const holdsAnswer = useCallback(
    (source: Speaker) => asksQuestions(source) && (!pendingFrom.current || pendingFrom.current === source),
    [asksQuestions]
  )

  useEffect(
    () =>
      window.nexus.stt.onEvent((ev: SttEvent) => {
        // While an answer is read aloud, the microphone and system audio hear Nexus itself.
        if ((ev.type === 'final' || ev.type === 'partial') && Date.now() < muteUntil.current) return
        switch (ev.type) {
          case 'final':
            setTranscript((t) => [...t, ev.line].sort((a, b) => a.at - b.at))
            setPartials((p) => ({ ...p, [ev.source]: '' }))
            if (asksQuestions(ev.source)) {
              pendingThem.current = `${pendingThem.current} ${ev.line.text}`.trim().slice(-MAX_PENDING)
              pendingFrom.current = ev.source
              scheduleAutoAnswer()
            } else {
              // You started answering yourself; what they said before is handled.
              pendingThem.current = ''
              pendingFrom.current = null
              if (autoTimer.current) clearTimeout(autoTimer.current)
            }
            break
          case 'partial':
            setPartials((p) => ({ ...p, [ev.source]: ev.text }))
            if (holdsAnswer(ev.source) && ev.text && autoTimer.current) clearTimeout(autoTimer.current)
            break
          case 'speech':
            setSpeaking((s) => ({ ...s, [ev.source]: ev.speaking }))
            if (!holdsAnswer(ev.source)) break
            if (ev.speaking) {
              // They are still talking: hold the answer until they finish.
              if (autoTimer.current) clearTimeout(autoTimer.current)
            } else if (pendingThem.current) {
              // They stopped. If that sound gave no new line (a cough, typing, "um"), the question
              // heard before it must still be answered. A real line arrives within ~0.2 s and
              // reschedules with its own delay, so wait a little longer than that here.
              scheduleAutoAnswer(RESUME_AFTER_NOISE_MS)
            }
            break
          case 'error':
            setNotice(`${ev.source === 'them' ? 'Them' : 'You'}: ${ev.message}`)
            break
          case 'status': {
            const prev = statusShown.current
            statusShown.current = ev.message
            setNotice((n) => ev.message ?? (n === prev ? null : n))
            break
          }
          case 'state':
            break
        }
      }),
    [asksQuestions, holdsAnswer, scheduleAutoAnswer, setTranscript]
  )

  const stopSource = useCallback(async (source: Speaker) => {
    pumps.current.get(source)?.stop()
    pumps.current.delete(source)
    setActive((a) => ({ ...a, [source]: false }))
    setLevels((l) => ({ ...l, [source]: 0 }))
    setSpeaking((s) => ({ ...s, [source]: false }))
    setPartials((p) => ({ ...p, [source]: '' }))
    await window.nexus.stt.stop(source)
  }, [])

  const stopListening = useCallback(async () => {
    listeningRef.current = false
    setStartedAt(null)
    await Promise.all((['them', 'you'] as Speaker[]).map(stopSource))
  }, [stopSource])

  const startSource = useCallback(
    async (source: Speaker): Promise<boolean> => {
      const s = settingsRef.current
      if (!s || pumps.current.has(source)) return true
      const started = await window.nexus.stt.start(source)
      if (!started.ok) {
        setNotice(started.error)
        return false
      }
      try {
        const stream = await openSource(source, source === 'them' ? s.stt.themDevice : s.stt.micDevice)
        const pump = new AudioPump(
          stream,
          (pcm) => window.nexus.stt.audio(source, pcm.buffer as ArrayBuffer),
          (level) => setLevels((l) => (Math.abs(l[source] - level) < 0.02 ? l : { ...l, [source]: level })),
          () => {
            setNotice(`${source === 'them' ? 'System audio' : 'Microphone'} stopped (device removed or permission revoked).`)
            void stopSource(source)
          }
        )
        if (!listeningRef.current) {
          // Listening was stopped while this source was still starting.
          pump.stop()
          await window.nexus.stt.stop(source)
          return false
        }
        pumps.current.set(source, pump)
        setActive((a) => ({ ...a, [source]: true }))
        return true
      } catch (err) {
        await window.nexus.stt.stop(source)
        setNotice(cleanError(err))
        return false
      }
    },
    [stopSource]
  )

  const startListening = useCallback(async () => {
    const s = settingsRef.current
    if (!s || listeningRef.current) return
    const sources = (['them', 'you'] as Speaker[]).filter((x) => (x === 'them' ? s.stt.captureThem : s.stt.captureYou))
    if (!sources.length) {
      setNotice('Turn on "Them" or "You" to choose what to transcribe.')
      return
    }
    setNotice(null)
    listeningRef.current = true
    setStartedAt(Date.now())
    const results = await Promise.all(sources.map(startSource))
    if (!results.some(Boolean)) {
      listeningRef.current = false
      setStartedAt(null)
    }
  }, [startSource])

  const toggleListening = useCallback(() => {
    if (listeningRef.current) void stopListening()
    else void startListening()
  }, [startListening, stopListening])

  /** Turns a source on/off; applies immediately while listening. */
  const setSourceEnabled = useCallback(
    async (source: Speaker, on: boolean) => {
      await window.nexus.updateSettings({ stt: source === 'them' ? { captureThem: on } : { captureYou: on } })
      if (!listeningRef.current) return
      if (on) await startSource(source)
      else await stopSource(source)
      if (!pumps.current.size) {
        listeningRef.current = false
        setStartedAt(null)
      }
    },
    [startSource, stopSource]
  )

  useEffect(() => () => void stopListening(), [stopListening])

  // ---------- Local model read-ahead ----------
  // A model on this computer reads the whole prompt before its first word: seconds for a long
  // transcript. While people talk, hand it everything the next request will start with (system
  // prompt, transcript), so when a question comes only the question is new.
  useEffect(() => {
    if (!settings || !isLocalModel(settings.ai) || streaming) return
    const t = setTimeout(() => {
      const prefix = transcriptBlock(transcriptText())
      // A placeholder for the next question, built as the next automatic answer will be built
      // (local models answer from the transcript alone, without earlier turns).
      const msgs = buildMessages(systemPrompt(settings.copilot, settings.profile), [
        { role: 'user', kind: 'answer', content: '', prompt: prefix }
      ])
      if (!prefix) msgs.pop()
      window.nexus.ai.prefill(msgs)
    }, PREFILL_DELAY_MS)
    return () => clearTimeout(t)
  }, [settings, transcript, streaming, startedAt])

  // ---------- Sessions ----------
  const record = useCallback((): SessionRecord | null => {
    const ms = messagesRef.current
    const tr = transcriptRef.current
    if (!ms.length && !tr.length) return null
    const firstQ = ms.find((m) => m.role === 'user')?.content
    const title = firstQ
      ? firstQ.slice(0, 80)
      : `Session ${new Date(sessionStart.current).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
    return {
      id: sessionId,
      title,
      mode: settingsRef.current?.copilot.mode ?? 'general',
      startedAt: sessionStart.current,
      updatedAt: Date.now(),
      transcript: tr,
      messages: ms
        .filter((m) => m.content.trim() || m.role === 'user')
        .map(({ id, role, kind, content, at, bookmarked, versions, version }) => ({
          id,
          role,
          kind,
          content,
          at,
          ...(role === 'assistant' ? { bookmarked: !!bookmarked, versions, version } : {})
        }))
    }
  }, [sessionId])

  useEffect(() => {
    if (!settingsRef.current?.copilot.saveSessions) return
    const t = setTimeout(() => {
      const r = record()
      if (r) void window.nexus.sessions.save(r)
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [messages, transcript, record])

  const newSession = useCallback(() => {
    cancel()
    const r = record()
    if (r && settingsRef.current?.copilot.saveSessions) void window.nexus.sessions.save(r)
    setMessages(() => [])
    setTranscript(() => [])
    setPartials(both(''))
    pendingThem.current = ''
    pendingFrom.current = null
    sessionStart.current = Date.now()
    setSessionId(newId())
    setNotice(null)
  }, [cancel, record, setMessages, setTranscript])

  return {
    messages,
    transcript,
    partials,
    speaking,
    levels,
    active,
    listening: startedAt !== null,
    startedAt,
    streaming,
    busy,
    notice,
    dismissNotice: () => setNotice(null),
    toggleListening,
    setSourceEnabled,
    answer: () => answer(),
    generating,
    answerAs,
    toggleBookmark,
    reading,
    readAloud,
    stopReading,
    analyzeScreen,
    sendChat,
    cancel,
    newSession
  }
}

export type Copilot = ReturnType<typeof useCopilot>
