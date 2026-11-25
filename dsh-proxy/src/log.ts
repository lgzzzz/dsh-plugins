/** 一个有界的环形日志：内核 stderr、插件动作、错误都在这里。 */

/** 一行日志。 */
export interface LogLine {
  time: number
  /** `core` 是内核输出，`action` 是插件动作，`error` 是失败。 */
  source: 'core' | 'action' | 'error'
  text: string
}

/** 最多保留多少行。 */
const DEFAULT_CAPACITY = 500

/** 只保留最近 N 行，超出丢掉最旧的。 */
export class RingLog {
  private readonly lines: LogLine[] = []
  private readonly capacity: number

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity
  }

  /** 追加一行；多行文本按行拆开。 */
  push(source: LogLine['source'], text: string): void {
    const stamp = Date.now()
    for (const line of String(text ?? '').split(/\r?\n/)) {
      if (line.trim() === '') continue
      this.lines.push({ time: stamp, source, text: line.slice(0, 2000) })
    }
    const overflow = this.lines.length - this.capacity
    if (overflow > 0) this.lines.splice(0, overflow)
  }

  /** 最近 `limit` 行，旧的在前。 */
  tail(limit = 200): LogLine[] {
    return this.lines.slice(Math.max(0, this.lines.length - limit))
  }

  /** 内核 stderr 的尾部，用于错误信息。 */
  tailText(limit = 20): string {
    return this.lines
      .slice(Math.max(0, this.lines.length - limit))
      .map((line) => line.text)
      .join('\n')
  }
}
