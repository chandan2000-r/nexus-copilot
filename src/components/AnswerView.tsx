import { useEffect, useRef } from 'react'
import { ANSWER_MODE_LABELS, STYLE_LABELS, tidyAnswer } from '../services/copilot/prompts'
import type { Copilot, UiMessage } from '../services/useCopilot'
import { ANSWER_VERSIONS, type AnswerVersion } from '../shared/copilot'
import type { SecretsStatus } from '../shared/ipc'
import { LLM_PROVIDERS } from '../shared/providers'
import type { Settings } from '../shared/settings'
import { RefreshIcon, SpeakerIcon, StarIcon, StopIcon } from './icons'
import { Markdown, CopyButton } from './Markdown'
import { prettyAccelerator } from './ShortcutRecorder'

interface Props {
  copilot: Copilot
  settings: Settings
  secrets: SecretsStatus | null
  onOpenSettings(): void
}

function UserTurn({ m }: { m: UiMessage }) {
  if (m.kind === 'chat') {
    return (
      <div className="msg user" data-turn={m.id}>
        <div className="bubble">{m.content}</div>
      </div>
    )
  }
  return (
    <div className={`turn-head kind-${m.kind}`} data-turn={m.id}>
      <span className="badge">{m.kind === 'answer' ? 'Q' : 'Screen'}</span>
      <span className="turn-text">{m.content}</span>
      {m.thumb && <img className="thumb" src={m.thumb} alt="Screenshot sent to the AI" />}
    </div>
  )
}

const versionLabel = (v: AnswerVersion) => (v === 'auto' ? 'Auto' : ANSWER_MODE_LABELS[v])

interface TurnProps {
  m: UiMessage
  /** The question this answers (decides which actions apply). */
  asked: UiMessage | undefined
  live: boolean
  copilot: Copilot
  settings: Settings
}

function AssistantTurn({ m, asked, live, copilot, settings }: TurnProps) {
  const isAnswer = asked?.kind === 'answer'
  const canRegenerate = asked?.kind === 'answer' || asked?.kind === 'chat'
  const shown = m.version ?? 'auto'
  const reading = copilot.reading === m.id
  return (
    <div className="msg assistant">
      <div className="answer">
        {m.content ? <Markdown text={tidyAnswer(m.content)} /> : !m.error && <span className="thinking">Thinking…</span>}
        {live && m.content && <span className="caret" />}
        {m.error && <div className="chat-error">{m.error}</div>}
        {(m.content || m.error) && (
          <div className="answer-bar">
            {isAnswer && (
              <div className="versions" role="group" aria-label="Answer version">
                {ANSWER_VERSIONS.map((v) => (
                  <button
                    key={v}
                    className={`version-chip ${shown === v ? 'active' : ''} ${m.versions?.[v] ? 'made' : ''}`}
                    aria-pressed={shown === v}
                    disabled={live}
                    title={
                      v === 'auto'
                        ? `Your answer style (${STYLE_LABELS[settings.copilot.answerStyle]})`
                        : v === 'quick'
                          ? '2–4 sentences'
                          : v === 'interview'
                            ? 'A 30–60 second spoken answer'
                            : 'Commands, configuration, trade-offs'
                    }
                    onClick={() => copilot.answerAs(m.id, v)}
                  >
                    {versionLabel(v)}
                  </button>
                ))}
              </div>
            )}
            <div className="answer-tools">
              {canRegenerate && (
                <button
                  className="copy-btn"
                  title="Regenerate"
                  aria-label="Regenerate"
                  disabled={live}
                  onClick={() => copilot.answerAs(m.id, shown, true)}
                >
                  <RefreshIcon width={13} height={13} />
                </button>
              )}
              <button
                className={`copy-btn ${m.bookmarked ? 'on' : ''}`}
                title={m.bookmarked ? 'Remove bookmark' : 'Bookmark'}
                aria-label={m.bookmarked ? 'Remove bookmark' : 'Bookmark'}
                aria-pressed={!!m.bookmarked}
                onClick={() => copilot.toggleBookmark(m.id)}
              >
                <StarIcon width={13} height={13} filled={!!m.bookmarked} />
              </button>
              {!live && m.content && (
                <button
                  className={`copy-btn ${reading ? 'on' : ''}`}
                  title={reading ? 'Stop reading' : 'Read aloud'}
                  aria-label={reading ? 'Stop reading' : 'Read aloud'}
                  onClick={() => (reading ? copilot.stopReading() : copilot.readAloud(m.id))}
                >
                  {reading ? <StopIcon width={13} height={13} /> : <SpeakerIcon width={13} height={13} />}
                </button>
              )}
              {!live && m.content && <CopyButton text={tidyAnswer(m.content)} label="Copy answer" />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ settings, secrets, onOpenSettings }: Omit<Props, 'copilot'>) {
  const meta = LLM_PROVIDERS[settings.ai.provider]
  const needsKey =
    !!meta.keyName && secrets && !secrets.saved[meta.keyName] && !(meta.keyOptional && !/openai\.com/.test(settings.ai.openaiBaseUrl))
  const sc = settings.shortcuts
  const rows: [string, string][] = [
    ['Start / stop listening', sc.toggleListening],
    ['Answer the latest question', sc.answerNow],
    ['Solve what is on screen', sc.analyzeScreen],
    ['Show / hide this window', sc.toggleWindow]
  ]
  return (
    <div className="empty-state">
      <div className="empty-orb" aria-hidden />
      <h1>Ready when you are</h1>
      <p>Press Listen. Questions from the other side are answered automatically, using your profile.</p>
      {needsKey && (
        <button className="setup-btn" onClick={onOpenSettings}>
          Add your {meta.name} API key to get started
        </button>
      )}
      {!settings.profile.resume.trim() && !needsKey && (
        <button className="setup-btn subtle" onClick={onOpenSettings}>
          Add your resume in Settings → Profile for personal answers
        </button>
      )}
      <dl className="shortcut-list">
        {rows
          .filter(([, acc]) => acc)
          .map(([label, acc]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{prettyAccelerator(acc)}</dd>
            </div>
          ))}
      </dl>
    </div>
  )
}

export function AnswerView({ copilot, settings, secrets, onOpenSettings }: Props) {
  const box = useRef<HTMLElement>(null)
  /** The newest question is pinned to the top so its answer reads from the start while it streams. */
  const pin = useRef<string | null>(null)
  const { messages, streaming } = copilot
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.id

  useEffect(() => {
    pin.current = lastUser ?? null
  }, [lastUser])
  useEffect(() => {
    const el = box.current
    const id = pin.current
    if (!el || !id) return
    const turn = el.querySelector<HTMLElement>(`[data-turn="${id}"]`)
    if (!turn) return
    const target = turn.offsetTop - 8
    if (el.scrollTop < target) el.scrollTop = target
  }, [messages])

  if (messages.length === 0) {
    return (
      <main className="chat empty">
        <EmptyState settings={settings} secrets={secrets} onOpenSettings={onOpenSettings} />
      </main>
    )
  }

  return (
    <main className="chat" ref={box} onWheel={() => (pin.current = null)} aria-live="polite">
      {messages.map((m, i) =>
        m.role === 'user' ? (
          <UserTurn key={m.id} m={m} />
        ) : (
          <AssistantTurn
            key={m.id}
            m={m}
            asked={[...messages.slice(0, i)].reverse().find((x) => x.role === 'user')}
            live={streaming && copilot.generating === m.id}
            copilot={copilot}
            settings={settings}
          />
        )
      )}
    </main>
  )
}
