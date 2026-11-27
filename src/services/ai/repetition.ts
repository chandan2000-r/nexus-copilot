/**
 * Notices when a streamed answer starts looping. Small local models sometimes repeat the same few
 * bullet points until they run out of tokens: measured with qwen2.5:3b, "How would you
 * troubleshoot high CPU usage on a Linux server?" produced 11 good bullets and then cycled through
 * the same 4 for six minutes (2,600 words). A real answer does not repeat whole lines, so the
 * second repeated line ends the answer. Lines inside code blocks and short lines are not counted.
 */
export class RepetitionGuard {
  private pending = ''
  private readonly seen = new Set<string>()
  private inCode = false
  private repeats = 0
  private bullets = 0

  /**
   * `maxBullets`: also end the answer after this many bullet points. For small local models, which
   * can list endless variations instead of repeating exactly ("Check for misconfigured network
   * protocols with `netstat -s`… `-p`… `-n`…": 50 bullets). Answers asked for are 2–8 bullets.
   */
  constructor(
    private readonly maxBullets = Infinity,
    private readonly limit = 2,
    private readonly minLength = 16
  ) {}

  /** Feeds streamed text. Returns true once the output is looping. */
  push(delta: string): boolean {
    this.pending += delta
    let nl: number
    while ((nl = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, nl).trim()
      this.pending = this.pending.slice(nl + 1)
      if (this.line(line)) return true
    }
    return false
  }

  private line(raw: string): boolean {
    const line = raw.replace(/^(?:[-*•+]|\d+[.)])\s+/, '')
    if (line.startsWith('```')) {
      this.inCode = !this.inCode
      return false
    }
    if (this.inCode) return false
    if (line !== raw && ++this.bullets >= this.maxBullets) return true
    if (line.length < this.minLength) return false
    const key = line.toLowerCase().replace(/\s+/g, ' ')
    if (!this.seen.has(key)) {
      this.seen.add(key)
      return false
    }
    return ++this.repeats >= this.limit
  }
}
