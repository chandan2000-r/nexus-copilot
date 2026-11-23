import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AnthropicProvider } from '../src/services/ai/providers/anthropicProvider'
import { GEMINI_OVERLOAD_FALLBACK, GeminiProvider } from '../src/services/ai/providers/geminiProvider'
import { AIService } from '../src/services/ai/AIService'
import { OLLAMA_KEEP_ALIVE, OLLAMA_NUM_CTX, OllamaProvider, ollamaThinkValues } from '../src/services/ai/providers/ollamaProvider'
import { OpenAICompatibleProvider } from '../src/services/ai/providers/openaiProvider'
import { geminiThinkingConfigs, openaiReasoningEfforts, resetSpeedCache } from '../src/services/ai/speed'
import { apiError, request, RETRY } from '../src/services/ai/http'
import type { AIProvider, ChatMessage } from '../src/services/ai/types'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/shared/settings'
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
  RETRY.delaysMs = [1, 1] // keep retry waits out of test time
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
  const ndjson = (res: ServerResponse, parts: string[]) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.end(parts.map((p) => `${p}\n`).join(''))
  }
  const tags = (res: ServerResponse) =>
    res.end(
      JSON.stringify({
        models: [
          { name: 'qwen2.5:3b', capabilities: ['completion', 'tools'] },
          { name: 'gemma3:4b', capabilities: ['completion', 'vision'] }
        ]
      })
    )
  const chats = () => seen.filter((r) => r.url === '/api/chat').map((r) => JSON.parse(r.body))

  it('streams NDJSON, keeps the model loaded, fixes the context size and turns thinking off', async () => {
    resetSpeedCache()
    seen.length = 0
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write('{"message":{"content":"lo"},"done":false}\n{"message":{"content":"cal"},')
      res.end('"done":false}\n{"message":{"content":""},"done":true}\n')
    }
    const p = new OllamaProvider({ baseUrl: base, model: 'qwen2.5:3b', maxTokens: 10, speed: 'fast' })
    expect(await collect(p, [msgs[0], { role: 'user', content: 'hi' }])).toBe('local')
    const [body] = chats()
    expect(body).toMatchObject({ model: 'qwen2.5:3b', stream: true, keep_alive: OLLAMA_KEEP_ALIVE, think: false })
    expect(body.options).toEqual({ num_ctx: OLLAMA_NUM_CTX, num_predict: 10 })
  })

  it('drops think when the model rejects it, and leaves it out for Thorough', async () => {
    resetSpeedCache()
    seen.length = 0
    handler = (req, res) => {
      if (JSON.parse(req.body).think !== undefined) {
        res.writeHead(400)
        return res.end('{"error":"\"old-model\" does not support thinking"}')
      }
      ndjson(res, ['{"message":{"content":"ok"},"done":true}'])
    }
    const p = new OllamaProvider({ baseUrl: base, model: 'old-model', maxTokens: 10 })
    expect(await collect(p, [{ role: 'user', content: 'hi' }])).toBe('ok')
    expect(chats().map((b) => b.think)).toEqual([false, undefined])
    expect(ollamaThinkValues('gpt-oss:20b', 'fast')).toEqual(['low'])
    expect(ollamaThinkValues('qwen3:4b', 'thorough')).toEqual([])
  })

  it('sends screenshots to an installed vision model when the chosen one cannot see', async () => {
    seen.length = 0
    handler = (req, res) => (req.url === '/api/tags' ? tags(res) : ndjson(res, ['{"message":{"content":"red"},"done":true}']))
    const p = new OllamaProvider({ baseUrl: base, model: 'qwen2.5:3b', maxTokens: 10 })
    expect(await collect(p, msgs)).toBe('red')
    const [body] = chats()
    expect(body.model).toBe('gemma3:4b')
    expect(body.messages[1].images).toEqual(['QUJD'])
    // Text-only requests stay on the chosen model and do not look up the model list.
    seen.length = 0
    await collect(p, [{ role: 'user', content: 'hi' }])
    expect(seen.map((r) => r.url)).toEqual(['/api/chat'])
    expect(chats()[0].model).toBe('qwen2.5:3b')
  })

  it('says which models are installed when the chosen one is missing', async () => {
    handler = (req, res) => {
      if (req.url === '/api/tags') return tags(res)
      res.writeHead(404)
      res.end('{"error":"model \'llama3.2\' not found"}')
    }
    const p = new OllamaProvider({ baseUrl: base, model: 'llama3.2', maxTokens: 10 })
    await expect(collect(p, [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'Ollama has no model "llama3.2". Installed: qwen2.5:3b, gemma3:4b. Choose one in Settings → AI, or run "ollama pull llama3.2".'
    )
  })

  it('prefills without streaming an answer, with the same context size', async () => {
    seen.length = 0
    handler = (_req, res) => res.end('{"message":{"content":"x"},"done":true}')
    const p = new OllamaProvider({ baseUrl: base, model: 'qwen2.5:3b', maxTokens: 4096 })
    await p.prefill(msgs, AbortSignal.timeout(5000))
    const [body] = chats()
    expect(body).toMatchObject({ stream: false, keep_alive: OLLAMA_KEEP_ALIVE, options: { num_ctx: OLLAMA_NUM_CTX, num_predict: 1 } })
    expect(body.messages[1].images).toBeUndefined()
  })
})

describe('AIService prefill (local models)', () => {
  const settingsFor = (provider: 'ollama' | 'gemini') =>
    mergeSettings(DEFAULT_SETTINGS, { ai: { provider, ollamaBaseUrl: base, models: { ollama: 'qwen2.5:3b' } } })
  const until = async (cond: () => boolean) => {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
  }

  it('runs one at a time, keeps only the newest queued prefill and skips repeats', async () => {
    seen.length = 0
    let release: () => void = () => {}
    handler = (_req, res) => {
      release = () => res.end('{"done":true}')
      if (seen.length > 1) release()
    }
    const ai = new AIService(() => settingsFor('ollama'), () => null)
    const m = (t: string): ChatMessage[] => [{ role: 'system', content: 'SYS' }, { role: 'user', content: t }]
    ai.prefill(m('a'))
    await until(() => seen.length === 1)
    ai.prefill(m('b'))
    ai.prefill(m('c'))
    release()
    await until(() => seen.length === 2)
    ai.prefill(m('c'))
    await new Promise((r) => setTimeout(r, 30))
    expect(seen.map((r) => JSON.parse(r.body).messages[1].content)).toEqual(['a', 'c'])
  })

  it('does nothing for cloud providers', async () => {
    seen.length = 0
    new AIService(() => settingsFor('gemini'), () => 'key').prefill([{ role: 'system', content: 'SYS' }])
    await new Promise((r) => setTimeout(r, 30))
    expect(seen).toHaveLength(0)
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
    const p = new GeminiProvider({ apiKey: 'g', model: 'gemini-flash-latest', baseUrl: base, speed: 'fast' })
    const before = seen.length
    expect(await collect(p, msgs)).toBe('Fast')
    expect(seen.slice(before).map((r) => JSON.parse(r.body).generationConfig?.thinkingConfig)).toEqual([
      { thinkingLevel: 'minimal' },
      { thinkingLevel: 'low' },
      { thinkingBudget: 0 }
    ])
  })
})

describe('retries on temporary server errors', () => {
  const statusThenOk = (fails: number[], counter: { n: number }) => (_req: Seen, res: ServerResponse) => {
    const code = fails[counter.n++]
    if (code) {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'The model is overloaded. Please try again later.' } }))
    } else res.end('ok')
  }

  it('retries 503 / 500 and returns the first success', async () => {
    const c = { n: 0 }
    handler = statusThenOk([503, 500], c)
    const res = await request('Gemini', `${base}/x`, { method: 'POST', body: '{"a":1}' }, [1, 1])
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(c.n).toBe(3)
    // The same body is sent on every attempt.
    expect(seen.slice(-3).map((r) => r.body)).toEqual(['{"a":1}', '{"a":1}', '{"a":1}'])
  })

  it('gives up after the last retry with an actionable message', async () => {
    const c = { n: 0 }
    handler = statusThenOk([503, 503, 503, 503], c)
    const res = await request('Gemini', `${base}/x`, {}, [1, 1])
    expect(res.status).toBe(503)
    expect(c.n).toBe(3)
    expect((await apiError(res, 'Gemini')).message).toMatch(/503: The model is overloaded.*already retried.*another model/)
  })

  it('does not retry client errors or rate limits', async () => {
    for (const code of [400, 429]) {
      const c = { n: 0 }
      handler = statusThenOk([code, code], c)
      expect((await request('x', `${base}/x`, {}, [1, 1])).status).toBe(code)
      expect(c.n).toBe(1)
    }
  })

  it('stops waiting when the request is cancelled', async () => {
    const c = { n: 0 }
    handler = statusThenOk([503, 503], c)
    const ctl = new AbortController()
    const p = request('x', `${base}/x`, { signal: ctl.signal }, [5_000])
    setTimeout(() => ctl.abort(), 50)
    await expect(p).rejects.toThrow(/abort/i)
    expect(c.n).toBe(1)
  })
})

describe('Gemini overload fallback', () => {
  const overloaded = (res: ServerResponse) => {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }))
  }

  it('transcribes with the lighter model when the chosen one stays overloaded', async () => {
    resetSpeedCache()
    handler = (req, res) => {
      if (req.url.includes('gemini-flash-latest')) overloaded(res)
      else res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Tell me about Kafka' }] } }] }))
    }
    const t = geminiTranscriber({ apiKey: 'g', model: 'gemini-flash-latest', language: 'auto', baseUrl: base })
    const before = seen.length
    expect(await t(new Uint8Array([1]), { prompt: '', signal: AbortSignal.timeout(5000) })).toBe('Tell me about Kafka')
    const urls = seen.slice(before).map((r) => r.url)
    expect(urls.filter((u) => u.includes('gemini-flash-latest'))).toHaveLength(3) // first try + 2 retries
    expect(urls.at(-1)).toBe(`/models/${GEMINI_OVERLOAD_FALLBACK}:generateContent`)
    // Transcription asks for minimal thinking and keeps temperature 0.
    expect(JSON.parse(seen.at(-1)!.body).generationConfig).toEqual({ temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } })
  })

  it("reports the chosen model's error when the fallback fails too", async () => {
    resetSpeedCache()
    handler = (req, res) => {
      if (req.url.includes(GEMINI_OVERLOAD_FALLBACK)) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'model not found' } }))
      } else overloaded(res)
    }
    const t = geminiTranscriber({ apiKey: 'g', model: 'gemini-flash-latest', language: 'auto', baseUrl: base })
    await expect(t(new Uint8Array([1]), { prompt: '', signal: AbortSignal.timeout(5000) })).rejects.toThrow(
      /Gemini transcription error 503: This model is currently experiencing high demand/
    )
  })

  it('streams answers from the lighter model when the chosen one is overloaded', async () => {
    resetSpeedCache()
    handler = (req, res) => {
      if (req.url.includes('gemini-flash-latest')) overloaded(res)
      else sse(res, ['data: {"candidates":[{"content":{"parts":[{"text":"Kafka is a log"}]},"finishReason":"STOP"}]}'])
    }
    const p = new GeminiProvider({ apiKey: 'g', model: 'gemini-flash-latest', baseUrl: base, speed: 'fast' })
    expect(await collect(p, msgs)).toBe('Kafka is a log')
    expect(seen.at(-1)!.url).toBe(`/models/${GEMINI_OVERLOAD_FALLBACK}:streamGenerateContent?alt=sse`)
  })

  it('does not fall back for non-Gemini models or errors other than overload', async () => {
    resetSpeedCache()
    handler = (_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'API key not valid' } }))
    }
    const p = new GeminiProvider({ apiKey: 'bad', model: 'gemini-flash-latest', baseUrl: base, speed: 'fast' })
    const before = seen.length
    await expect(collect(p, msgs)).rejects.toThrow(/401: API key not valid/)
    expect(seen.length - before).toBe(1)
  })
})

describe('answer speed cache', () => {
  it('re-evaluates when the speed setting changes the candidate list', async () => {
    resetSpeedCache()
    handler = (req, res) => {
      const effort = JSON.parse(req.body).reasoning_effort
      if (effort === 'minimal') {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: "Unsupported value: 'reasoning_effort' does not support 'minimal'." } }))
      } else sse(res, ['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]'])
    }
    const mk = (reasoningEfforts: string[]) =>
      new OpenAICompatibleProvider({ baseUrl: base, apiKey: 'k', model: 'gpt-cache', maxTokens: 50, reasoningEfforts })
    await collect(mk(['minimal', 'low']), msgs) // fast: 'minimal' rejected, 'low' (index 1) remembered
    const before = seen.length
    await collect(mk(['medium']), msgs) // thorough: must send 'medium', not reuse index 1 (= no parameter)
    expect(seen.slice(before).map((r) => JSON.parse(r.body).reasoning_effort)).toEqual(['medium'])
  })
})
