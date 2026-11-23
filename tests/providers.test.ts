import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AnthropicProvider } from '../src/services/ai/providers/anthropicProvider'
import { GeminiProvider } from '../src/services/ai/providers/geminiProvider'
import { OllamaProvider } from '../src/services/ai/providers/ollamaProvider'
import { OpenAICompatibleProvider } from '../src/services/ai/providers/openaiProvider'
import { geminiThinkingConfigs, openaiReasoningEfforts, resetSpeedCache } from '../src/services/ai/speed'
import type { AIProvider, ChatMessage } from '../src/services/ai/types'
import { cleanTranscript, geminiTranscriber, whisperTranscriber } from '../src/services/stt/engines'

type Seen = { method: string; url: string; headers: IncomingMessage['headers']; body: string }
let server: Server
let base = ''
const seen: Seen[] = []
let handler: (req: Seen, res: ServerResponse) => void = () => {}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const s = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString('latin1') }
      seen.push(s)
      handler(s, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

const sse = (res: ServerResponse, events: string[]) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  // Split each event across writes to exercise line buffering.
  for (const e of events) {
    const half = Math.floor(e.length / 2)
    res.write(e.slice(0, half))
    res.write(`${e.slice(half)}\n\n`)
  }
  res.end()
}

const collect = async (p: AIProvider, msgs: ChatMessage[]) => {
  let out = ''
  for await (const d of p.chat(msgs, { signal: AbortSignal.timeout(5000) })) out += d
  return out
}

const img = [{ mimeType: 'image/jpeg', data: 'QUJD' }]
const msgs: ChatMessage[] = [
  { role: 'system', content: 'SYS' },
  { role: 'user', content: 'hi', images: img }
]

describe('OpenAI-compatible provider', () => {
  it('streams deltas and sends images as data URLs', async () => {
    handler = (_req, res) =>
      sse(res, [
        'data: {"choices":[{"delta":{"role":"assistant"}}]}',
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        'data: [DONE]'
      ])
    const p = new OpenAICompatibleProvider({ baseUrl: `${base}/v1/`, apiKey: 'sk-test', model: 'm', maxTokens: 50 })
    expect(await collect(p, msgs)).toBe('Hello')
    const req = seen.at(-1)!
    expect(req.url).toBe('/v1/chat/completions')
    expect(req.headers.authorization).toBe('Bearer sk-test')
    const body = JSON.parse(req.body)
    expect(body.max_tokens).toBe(50) // not api.openai.com → max_tokens
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,QUJD')
  })

  it('reports API errors with a hint', async () => {
    handler = (_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Incorrect API key' } }))
    }
    const p = new OpenAICompatibleProvider({ baseUrl: base, apiKey: 'bad', model: 'm', maxTokens: 5 })
    await expect(collect(p, msgs)).rejects.toThrow(/401: Incorrect API key.*Check the API key/)
  })

  it('lists models', async () => {
    handler = (_req, res) => res.end(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }] }))
    const p = new OpenAICompatibleProvider({ baseUrl: base, apiKey: null, model: 'm', maxTokens: 5 })
    expect((await p.listModels()).map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('Anthropic provider', () => {
  it('moves system to the top level and streams text deltas', async () => {
    handler = (_req, res) =>
      sse(res, [
        'event: message_start\ndata: {"type":"message_start","message":{}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi "}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"there"}}',
        'event: message_stop\ndata: {"type":"message_stop"}'
      ])
    const p = new AnthropicProvider({ apiKey: 'k', model: 'claude-haiku-5-5', maxTokens: 64, baseUrl: base })
    expect(await collect(p, msgs)).toBe('Hi there')
    const req = seen.at(-1)!
    expect(req.url).toBe('/v1/messages')
    expect(req.headers['x-api-key']).toBe('k')
    expect(req.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(req.body)
    expect(body.system).toBe('SYS')
    expect(body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } })
    expect(body.messages[0].content[1]).toEqual({ type: 'text', text: 'hi' })
  })

  it('throws on stream error events', async () => {
    handler = (_req, res) => sse(res, ['event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'])
    const p = new AnthropicProvider({ apiKey: 'k', model: 'm', maxTokens: 64, baseUrl: base })
    await expect(collect(p, msgs)).rejects.toThrow('Overloaded')
  })
})

describe('Gemini provider', () => {
  it('uses systemInstruction, inlineData and skips thought parts', async () => {
    handler = (_req, res) =>
      sse(res, [
        'data: {"candidates":[{"content":{"parts":[{"text":"thinking…","thought":true}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":"Ans"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":"wer"}]},"finishReason":"STOP"}]}'
      ])
    const p = new GeminiProvider({ apiKey: 'g', model: 'gemini-flash-latest', baseUrl: base })
    expect(await collect(p, msgs)).toBe('Answer')
    const req = seen.at(-1)!
    expect(req.url).toBe('/models/gemini-flash-latest:streamGenerateContent?alt=sse')
    expect(req.headers['x-goog-api-key']).toBe('g')
    const body = JSON.parse(req.body)
    expect(body.systemInstruction.parts[0].text).toBe('SYS')
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } })
  })
})

describe('Ollama provider', () => {
  it('streams NDJSON and passes images as base64', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write('{"message":{"content":"lo"},"done":false}\n{"message":{"content":"cal"},')
      res.end('"done":false}\n{"message":{"content":""},"done":true}\n')
    }
    const p = new OllamaProvider({ baseUrl: base, model: 'llama3.2', maxTokens: 10 })
    expect(await collect(p, msgs)).toBe('local')
    const body = JSON.parse(seen.at(-1)!.body)
    expect(body.messages[1].images).toEqual(['QUJD'])
  })
})

describe('transcription engines', () => {
  it('posts multipart audio to an OpenAI-compatible endpoint', async () => {
    handler = (_req, res) => res.end(JSON.stringify({ text: ' Tell me about yourself. ' }))
    const t = whisperTranscriber({ baseUrl: `${base}/v1`, apiKey: 'w', model: 'whisper-1', language: 'en' })
    const text = await t(new Uint8Array([82, 73, 70, 70]), { prompt: 'earlier', signal: AbortSignal.timeout(5000) })
    expect(text.trim()).toBe('Tell me about yourself.')
    const req = seen.at(-1)!
    expect(req.url).toBe('/v1/audio/transcriptions')
    expect(req.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    for (const field of ['name="file"; filename="utterance.wav"', 'name="model"', 'name="language"', 'name="prompt"']) {
      expect(req.body).toContain(field)
    }
  })

  it('omits language when auto-detecting and uses Gemini inline audio', async () => {
    handler = (_req, res) => res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hola' }] } }] }))
    const t = geminiTranscriber({ apiKey: 'g', model: 'gemini-flash-latest', language: 'auto', baseUrl: base })
    expect(await t(new Uint8Array([1, 2, 3]), { prompt: '', signal: AbortSignal.timeout(5000) })).toBe('Hola')
    const body = JSON.parse(seen.at(-1)!.body)
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: 'audio/wav', data: 'AQID' })
  })

  it('filters Whisper hallucinations on short audio only', () => {
    expect(cleanTranscript('Thank you.', 600)).toBe('')
    expect(cleanTranscript('[Music]', 5000)).toBe('')
    expect(cleanTranscript('Thank you.', 4000)).toBe('Thank you.')
    expect(cleanTranscript('  What   is a\nmutex? ', 900)).toBe('What is a mutex?')
  })
})

describe('answer speed', () => {
  const OPENAI = 'https://api.openai.com/v1'

  it('picks the fastest reasoning_effort each OpenAI model family accepts', () => {
    expect(openaiReasoningEfforts(OPENAI, 'gpt-5-mini', 'fast')).toEqual(['minimal', 'low'])
    expect(openaiReasoningEfforts(OPENAI, 'gpt-5-2025-08-07', 'fast')).toEqual(['minimal', 'low'])
    expect(openaiReasoningEfforts(OPENAI, 'gpt-5.1', 'fast')).toEqual(['none', 'minimal', 'low'])
    expect(openaiReasoningEfforts(OPENAI, 'o4-mini', 'fast')).toEqual(['low'])
    expect(openaiReasoningEfforts(OPENAI, 'gpt-5-mini', 'balanced')).toEqual(['low'])
    expect(openaiReasoningEfforts(OPENAI, 'gpt-5-mini', 'thorough')).toEqual(['medium'])
    // Not a reasoning model, a chat alias, or not api.openai.com: leave the request alone.
    expect(openaiReasoningEfforts(OPENAI, 'gpt-4.1-mini', 'fast')).toEqual([])
    expect(openaiReasoningEfforts(OPENAI, 'gpt-5-chat-latest', 'fast')).toEqual([])
    expect(openaiReasoningEfforts('https://api.groq.com/openai/v1', 'gpt-5-mini', 'fast')).toEqual([])
  })

  it('picks thinkingLevel for Gemini 3 / -latest and thinkingBudget for 2.5', () => {
    expect(geminiThinkingConfigs('gemini-flash-latest', 'fast')[0]).toEqual({ thinkingLevel: 'minimal' })
    expect(geminiThinkingConfigs('models/gemini-3-pro-preview', 'balanced')[0]).toEqual({ thinkingLevel: 'low' })
    expect(geminiThinkingConfigs('gemini-2.5-flash', 'fast')).toEqual([{ thinkingBudget: 0 }, { thinkingBudget: 128 }])
    expect(geminiThinkingConfigs('gemini-2.5-pro', 'fast')).toEqual([{ thinkingBudget: 128 }])
    expect(geminiThinkingConfigs('gemini-2.0-flash', 'fast')).toEqual([])
    expect(geminiThinkingConfigs('gemini-flash-latest', 'thorough')).toEqual([])
  })

  const reject400 = (res: ServerResponse, message: string) => {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message } }))
  }
  const okStream = (res: ServerResponse) => sse(res, ['data: {"choices":[{"delta":{"content":"Hi"}}]}', 'data: [DONE]'])

  it('falls back to the next reasoning_effort and remembers the one that worked', async () => {
    resetSpeedCache()
    handler = (req, res) => {
      const effort = JSON.parse(req.body).reasoning_effort
      if (effort === 'none') reject400(res, "Unsupported value: 'reasoning_effort' does not support 'none' with this model.")
      else okStream(res)
    }
    const p = new OpenAICompatibleProvider({ baseUrl: base, apiKey: 'k', model: 'gpt-x', maxTokens: 50, reasoningEfforts: ['none', 'minimal'] })
    const before = seen.length
    expect(await collect(p, msgs)).toBe('Hi')
    expect(seen.slice(before).map((r) => JSON.parse(r.body).reasoning_effort)).toEqual(['none', 'minimal'])
    // Second answer goes straight to the accepted value: no extra round trip.
    const mid = seen.length
    expect(await collect(p, msgs)).toBe('Hi')
    expect(seen.slice(mid).map((r) => JSON.parse(r.body).reasoning_effort)).toEqual(['minimal'])
  })

  it('drops the parameter when the model rejects every value', async () => {
    resetSpeedCache()
    handler = (req, res) => {
      if ('reasoning_effort' in JSON.parse(req.body)) reject400(res, "Unsupported parameter: 'reasoning_effort' is not supported with this model.")
      else okStream(res)
    }
    const p = new OpenAICompatibleProvider({ baseUrl: base, apiKey: 'k', model: 'gpt-y', maxTokens: 50, reasoningEfforts: ['low'] })
    const before = seen.length
    expect(await collect(p, msgs)).toBe('Hi')
    expect(seen.slice(before).map((r) => JSON.parse(r.body).reasoning_effort)).toEqual(['low', undefined])
  })

  it('does not retry on unrelated 400 errors', async () => {
    resetSpeedCache()
    handler = (_req, res) => reject400(res, 'Image too large')
    const p = new OpenAICompatibleProvider({ baseUrl: base, apiKey: 'k', model: 'gpt-z', maxTokens: 50, reasoningEfforts: ['none', 'low'] })
    const before = seen.length
    await expect(collect(p, msgs)).rejects.toThrow(/400: Image too large/)
    expect(seen.length - before).toBe(1)
  })

  it('sends Gemini thinkingConfig and falls back when a field is unknown', async () => {
    resetSpeedCache()
    handler = (req, res) => {
      const cfg = JSON.parse(req.body).generationConfig?.thinkingConfig
      if (cfg && 'thinkingLevel' in cfg) reject400(res, 'Invalid JSON payload received. Unknown name "thinkingLevel" at \'generation_config.thinking_config\'')
      else sse(res, ['data: {"candidates":[{"content":{"parts":[{"text":"Fast"}]},"finishReason":"STOP"}]}'])
    }
    const p = new GeminiProvider({ apiKey: 'g', model: 'gemini-flash-latest', baseUrl: base, thinkingConfigs: geminiThinkingConfigs('gemini-flash-latest', 'fast') })
    const before = seen.length
    expect(await collect(p, msgs)).toBe('Fast')
    expect(seen.slice(before).map((r) => JSON.parse(r.body).generationConfig?.thinkingConfig)).toEqual([
      { thinkingLevel: 'minimal' },
      { thinkingLevel: 'low' },
      { thinkingBudget: 0 }
    ])
  })
})
