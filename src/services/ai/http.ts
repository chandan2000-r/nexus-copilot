/** Small helpers for streaming HTTP APIs (SSE and NDJSON) on top of fetch. */

/** Yields complete lines from a streamed response body. */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        yield buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
      }
    }
    buf += decoder.decode()
    if (buf) yield buf.replace(/\r$/, '')
  } finally {
    reader.cancel().catch(() => {})
  }
}

export interface SseEvent {
  event?: string
  data: string
}

/** Parses a Server-Sent Events stream (as used by OpenAI, Anthropic and Gemini). */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  let event: string | undefined
  let data: string[] = []
  for await (const line of readLines(body)) {
    if (line === '') {
      if (data.length) yield { event, data: data.join('\n') }
      event = undefined
      data = []
      continue
    }
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
  }
  if (data.length) yield { event, data: data.join('\n') }
}

/** Builds a readable error from a failed API response, using the provider's error message if present. */
export async function apiError(res: Response, label: string): Promise<Error> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const j = JSON.parse(text)
      const e = Array.isArray(j) ? j[0]?.error : j.error
      detail = (typeof e === 'string' ? e : e?.message) ?? j.message ?? j.err_msg ?? text
    } catch {
      detail = text
    }
  } catch {
    /* ignore */
  }
  detail = String(detail).trim().slice(0, 300)
  const hint =
    res.status === 401 || res.status === 403
      ? ' Check the API key in Settings.'
      : res.status === 404
        ? ' Check the model name and base URL in Settings.'
        : res.status === 429
          ? ' Rate limit or quota reached.'
          : ''
  return new Error(`${label} error ${res.status}${detail ? `: ${detail}` : ''}.${hint}`)
}

export function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Wraps fetch so network failures say which service could not be reached. */
export async function request(label: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    if ((err as Error).name === 'AbortError' || init.signal?.aborted) throw err
    const cause = (err as { cause?: { code?: string; message?: string } }).cause
    throw new Error(`Could not reach ${label} at ${new URL(url).origin} (${cause?.code ?? cause?.message ?? (err as Error).message}).`)
  }
}
