#!/usr/bin/env node
// Local stand-in for an OpenAI-compatible API, for trying the UI and for tests without API keys.
//   node scripts/mock-ai.mjs            → http://127.0.0.1:8010/v1
// In Settings → AI choose "OpenAI-compatible", base URL http://127.0.0.1:8010/v1, model mock-fast.
// In Settings → Audio use the same base URL for Whisper.
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const QUESTIONS = [
  'Thanks for joining. Can you tell me a little about yourself?',
  'What is the difference between a process and a thread?',
  'Tell me about a time you handled a production outage.',
  'How would you design a rate limiter?'
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function answerFor(body) {
  const msgs = body.messages ?? []
  const system = msgs.find((m) => m.role === 'system')?.content ?? ''
  const last = [...msgs].reverse().find((m) => m.role === 'user')
  const parts = Array.isArray(last?.content) ? last.content : [{ type: 'text', text: last?.content ?? '' }]
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
  const images = parts.filter((p) => p.type === 'image_url').length
  const quoted = /"([^"]{3,200})"\s*$/.exec(text.trim())?.[1] ?? text.split('\n').at(-1)
  const resume = /<resume>\n([\s\S]*?)\n<\/resume>/.exec(system)?.[1]?.split('\n')[0]
  if (/Reply with exactly: OK/.test(text)) return 'OK'
  return [
    `**Mock answer** to: "${quoted.slice(0, 160)}"`,
    '',
    images ? `- I can see your screenshot (${images} image).` : '- This reply comes from scripts/mock-ai.mjs.',
    `- From your profile: ${resume ? resume.slice(0, 80) : 'no resume added yet'}`,
    '- Swap in a real provider in **Settings → AI** for real answers.',
    '',
    '```python',
    'def two_sum(nums, target):',
    '    seen = {}',
    '    for i, n in enumerate(nums):',
    '        if target - n in seen:',
    '            return [seen[target - n], i]',
    '        seen[n] = i',
    '```',
    'Time **O(n)**, space **O(n)**.'
  ].join('\n')
}

export function startMockServer(port = Number(process.env.PORT ?? 8010), { log = false } = {}) {
  let q = 0
  const stats = { chats: 0, transcriptions: 0, lastChat: null }
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks)
    if (log) console.log(req.method, req.url, raw.length, 'bytes')
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ data: [{ id: 'mock-fast' }, { id: 'mock-smart' }] }))
    }
    if (req.method === 'POST' && req.url === '/v1/audio/transcriptions') {
      stats.transcriptions++
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ text: QUESTIONS[q++ % QUESTIONS.length] }))
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const body = JSON.parse(raw.toString('utf8'))
      stats.chats++
      stats.lastChat = body
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      for (const word of answerFor(body).split(/(?<=\s)/)) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`)
        await sleep(8)
      }
      res.write('data: [DONE]\n\n')
      return res.end()
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: { message: `no route ${req.method} ${req.url}` } }))
  })
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve({ server, stats, url: `http://127.0.0.1:${server.address().port}/v1` }))
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startMockServer(undefined, { log: true })
  console.log(`mock AI server on ${url}`)
}
