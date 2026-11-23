/**
 * Renderer-side copilot state: listening, live transcript, auto-answer, screen analysis,
 * chat, and session autosave. Talks to the main process over the preload bridge.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioPump, openSource } from '../renderer/audio/capture'
import type { MessageKind, SessionRecord, Speaker, SttEvent, TranscriptLine } from '../shared/copilot'
import type { Settings } from '../shared/settings'
import type { ImageAttachment } from './ai/types'
import {
  answerPrompt,
  buildMessages,
  chatPrompt,
  formatTranscript,
  screenPrompt,
  systemPrompt
} from './copilot/prompts'
import { looksLikeQuestion, questionSnippet } from './copilot/questionDetector'

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
  at: number
  error?: string
}

type PerSpeaker<T> = Record<Speaker, T>

/** Pause after the other side stops talking before deciding whether to auto-answer. */
const AUTO_ANSWER_DELAY_MS = 1_100
/** Shorter pause when they clearly ended on a question; a follow-up still replaces the answer. */
const AUTO_ANSWER_QUESTION_DELAY_MS = 350
const SAVE_DEBOUNCE_MS = 1_500
const MAX_PENDING = 1_500

const newId = () => crypto.randomUUID()
const both = <T,>(v: T): PerSpeaker<T> => ({ them: v, you: v })

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
  const current = useRef<{ requestId: string; messageId: string } | null>(null)
  const pendingThem = useRef('')
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionStart = useRef(Date.now())
  const listeningRef = useRef(false)

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
          setMessages((ms) => ms.map((m) => (m.id === cur.messageId ? { ...m, content: m.content + ev.text } : m)))
          return
        }
        if (ev.type === 'error') {
          setMessages((ms) => ms.map((m) => (m.id === cur.messageId ? { ...m, error: ev.message } : m)))
        }
        current.current = null
        setStreaming(false)
      }),
    [setMessages]
  )

  const cancel = useCallback(() => {
    if (current.current) window.nexus.ai.cancel(current.current.requestId)
  }, [])

  const ask = useCallback(
    (kind: MessageKind, display: string, prompt: string, images?: ImageAttachment[], thumb?: string) => {
      const s = settingsRef.current
      if (!s) return
      // Newest request wins: a fresh question supersedes the answer still streaming.
      cancel()
      const user: UiMessage = { id: newId(), role: 'user', kind, content: display, prompt, images, thumb, at: Date.now() }
      const reply: UiMessage = { id: newId(), role: 'assistant', kind, content: '', at: Date.now() }
      const history = [...messagesRef.current, user]
      const requestId = newId()
      current.current = { requestId, messageId: reply.id }
      setStreaming(true)
      setNotice(null)
      setMessages((ms) => [...ms, user, reply])
      window.nexus.ai.send({ requestId, messages: buildMessages(systemPrompt(s.copilot, s.profile), history) })
      // The screenshot has been sent; keep only the thumbnail in memory.
      if (images?.length) setMessages((ms) => ms.map((m) => (m.id === user.id ? { ...m, images: undefined } : m)))
    },
    [cancel, setMessages]
  )

  const transcriptText = () => formatTranscript(transcriptRef.current)

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
      if (autoTimer.current) clearTimeout(autoTimer.current)
      ask('answer', questionSnippet(q), answerPrompt(q, transcriptText()))
    },
    [ask]
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
  const scheduleAutoAnswer = useCallback(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current)
    autoTimer.current = setTimeout(() => {
      const s = settingsRef.current
      const pending = pendingThem.current.trim()
      if (!s?.copilot.autoAnswer || !listeningRef.current || !pending) return
      if (looksLikeQuestion(pending)) answer(pending)
    }, /[?？]\s*$/.test(pendingThem.current) ? AUTO_ANSWER_QUESTION_DELAY_MS : AUTO_ANSWER_DELAY_MS)
  }, [answer])

  useEffect(
    () =>
      window.nexus.stt.onEvent((ev: SttEvent) => {
        switch (ev.type) {
          case 'final':
            setTranscript((t) => [...t, ev.line].sort((a, b) => a.at - b.at))
            setPartials((p) => ({ ...p, [ev.source]: '' }))
            if (ev.source === 'them') {
              pendingThem.current = `${pendingThem.current} ${ev.line.text}`.trim().slice(-MAX_PENDING)
              scheduleAutoAnswer()
            } else {
              // You started answering yourself; what they said before is handled.
              pendingThem.current = ''
              if (autoTimer.current) clearTimeout(autoTimer.current)
            }
            break
          case 'partial':
            setPartials((p) => ({ ...p, [ev.source]: ev.text }))
            if (ev.source === 'them' && ev.text && autoTimer.current) clearTimeout(autoTimer.current)
            break
          case 'speech':
            setSpeaking((s) => ({ ...s, [ev.source]: ev.speaking }))
            if (ev.source === 'them' && ev.speaking && autoTimer.current) clearTimeout(autoTimer.current)
            break
          case 'error':
            setNotice(`${ev.source === 'them' ? 'Them' : 'You'}: ${ev.message}`)
            break
          case 'state':
            break
        }
      }),
    [scheduleAutoAnswer, setTranscript]
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
        .map(({ id, role, kind, content, at }) => ({ id, role, kind, content, at }))
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
    analyzeScreen,
    sendChat,
    cancel,
    newSession
  }
}

export type Copilot = ReturnType<typeof useCopilot>
