/**
 * Heuristic: does this text (what the other side said since the last answer) end with
 * something the user should respond to? Used for auto-answer. Cheap and instant; the
 * user can always force an answer with the Answer button / shortcut.
 */
const STARTERS = [
  'what', 'why', 'how', 'when', 'where', 'who', 'whom', 'which', 'whose',
  'can you', 'could you', 'would you', 'will you', 'do you', 'did you', 'have you', 'had you',
  'are you', 'were you', 'is there', 'is it', 'are there', 'was there', 'should', 'shall we',
  'tell me', 'describe', 'explain', 'walk me through', 'talk me through', 'talk about', 'give me',
  'share', 'let\'s talk', 'imagine', 'suppose', 'say you', 'design', 'implement', 'write a', 'write me',
  'solve', 'compare', 'define', 'list', 'name', 'go ahead and', 'any questions', 'thoughts on'
]

const PHRASES = [
  'tell me about', 'walk me through', 'can you explain', 'could you explain', 'what would you', 'how would you',
  'what do you', 'how do you', 'why did you', 'why do you', 'describe a time', 'give me an example',
  'what is your', 'what\'s your', 'what are your', 'how did you', 'what did you', 'have you ever',
  'can you tell', 'could you tell', 'do you have', 'would you mind', 'how about', 'what about', 'your thoughts',
  'can you walk', 'can you describe', 'what happens if', 'difference between', 'how does', 'how is', 'why is'
]

function normalise(text: string): string {
  return text.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim()
}

/** Splits into sentences and returns the last one or two (where the question usually is). */
function tail(text: string): string {
  const sentences = text.split(/(?<=[.!?。？！])\s+/).filter(Boolean)
  return sentences.slice(-2).join(' ')
}

export function looksLikeQuestion(text: string): boolean {
  const t = normalise(text)
  if (t.split(' ').length < 3) return false
  if (/[?？]/.test(t)) return true
  const end = normalise(tail(text))
  const sentences = end.split(/(?<=[.!?])\s+/)
  if (sentences.some((s) => STARTERS.some((w) => s.startsWith(`${w} `) || s === w))) return true
  return PHRASES.some((p) => end.includes(p))
}

/** The question to show above an answer: the last few sentences, capped in length. */
export function questionSnippet(text: string, max = 280): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const sentences = t.split(/(?<=[.!?。？！])\s+/)
  let out = ''
  for (let i = sentences.length - 1; i >= 0; i--) {
    const next = out ? `${sentences[i]} ${out}` : sentences[i]
    if (next.length > max) break
    out = next
  }
  return out || `…${t.slice(-max)}`
}
