import { type KeyboardEvent, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { BoltIcon, MonitorIcon, SendIcon, StopIcon } from './icons'

interface Props {
  streaming: boolean
  screenBusy: boolean
  onSend(text: string): void
  onStop(): void
  onAnswer(): void
  onScreen(instruction: string): void
}

export interface ChatInputHandle {
  focus(): void
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(
  { streaming, screenBusy, onSend, onStop, onAnswer, onScreen },
  handle
) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(handle, () => ({ focus: () => ref.current?.focus() }), [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [text])

  const submit = () => {
    if (!text.trim()) return
    onSend(text)
    setText('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onAnswer()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape' && streaming) {
      onStop()
    }
  }

  return (
    <footer className="composer">
      <button
        className="icon-btn tool"
        onClick={() => {
          onScreen(text)
          setText('')
        }}
        disabled={screenBusy}
        title="Analyze screen: screenshot → solution (text in the box is sent as an instruction)"
        aria-label="Analyze screen"
      >
        <MonitorIcon />
      </button>
      <button className="icon-btn tool" onClick={onAnswer} title="Answer the latest question now (⌘/Ctrl+Enter)" aria-label="Answer now">
        <BoltIcon />
      </button>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={screenBusy ? 'Capturing screen…' : 'Ask anything, or paste a question…'}
        aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {streaming ? (
        <button className="send-btn" onClick={onStop} title="Stop (Esc)" aria-label="Stop">
          <StopIcon />
        </button>
      ) : (
        <button className="send-btn" onClick={submit} disabled={!text.trim()} title="Send (Enter)" aria-label="Send">
          <SendIcon />
        </button>
      )}
    </footer>
  )
})
