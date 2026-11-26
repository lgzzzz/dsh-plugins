/**
 * 访问日志：内核实际把每条连接交给了哪个出口。
 *
 * 数据源是 xray 的 `log.access`（每接受一条连接写一行）：
 *
 * ```
 * 2026/11/26 09:32:47.495539 from tcp:127.0.0.1:56396 accepted tcp:127.0.0.1:18099 [socks -> direct]
 * 2026/11/26 09:34:54.691686 from udp:127.0.0.1:51067 accepted udp:127.0.0.1:18444 [socks -> proxy]
 * 2026/11/26 09:32:47.526721 from 127.0.0.1:56400 accepted http://localhost:18099/ [http -> proxy]
 * 2026/11/26 09:36:34.554696 from 127.0.0.1:56527 accepted //localhost:18099 [http -> direct]
 * ```
 *
 * 方括号里是**实际**命中的出站 tag，所以「有没有经过代理」不用再仿真。文件由插件自己
 * 管生命周期：内核重启追加写、xray 不轮转，所以这里负责偏移、截断与大小上限。
 *
 * 边界（工具与界面都必须照实说）：只统计经本插件代理端口的连接；HTTPS 只能看到
 * `host:port`，看不到路径；客户端自行解析 DNS 时只有 IP —— 嗅探出的域名不会进日志。
 */

import { chmodSync, closeSync, openSync, readSync, statSync, truncateSync } from 'node:fs'
import type { RingLog } from './log.ts'

/** 归一化后的出口分类：代理（proxy 或节点 tag）、直连、拦截。 */
export type TrafficVerdict = 'proxy' | 'direct' | 'block'

/** 一条连接。 */
export interface AccessEntry {
  /** 日志行时间（按宿主本地时区解析成 epoch ms）。 */
  time: number
  /** 来源地址，例如 `127.0.0.1:56396`。 */
  source: string
  network: 'tcp' | 'udp'
  /** 入站 tag：`socks` / `http`。 */
  inbound: string
  /** 目的域名或 IP（IPv6 去掉方括号）。 */
  host: string
  port: number | null
  /** 仅明文 HTTP 有：需求路径，已脱敏（`?query` 换成 `?***`）。 */
  path?: string
  /** 实际命中的出站 tag（出口名）。 */
  out: string
  /** 这条连接发生时 `proxy` 出口绑定的节点名；没有就是 null。 */
  proxyLabel: string | null
}

/** 查询条件；字段之间是「且」。 */
export interface TrafficQuery {
  /** 域名 / IP /（明文 HTTP 的）路径子串，大小写不敏感。 */
  host?: string
  /** 出口名精确匹配。 */
  out?: string
  /** 归一化分类过滤。 */
  verdict?: TrafficVerdict
  /** 最多返回多少条；默认 50，钳制 1–200。 */
  limit?: number
}

/** 展示用的一条连接：带出口展示名与分类。 */
export interface TrafficEntry extends AccessEntry {
  outLabel: string
  verdict: TrafficVerdict
}

/** 命中项的汇总：对全部命中项统计，不是只统计当前页。 */
export interface TrafficSummary {
  matched: number
  proxied: number
  direct: number
  blocked: number
  /** 出口名 → 次数。 */
  byOut: Record<string, number>
  /** 最早 / 最晚一条的时间；没有命中时为 null。 */
  first: number | null
  last: number | null
}

/** 一次查询的结果。 */
export interface TrafficView {
  /** 访问日志是否正在写（内核运行且 tailer 正常）。 */
  live: boolean
  /** `live: false` 的原因。 */
  reason?: string
  /** 访问日志文件路径，供排查。 */
  file: string
  /** 命中项，最新在前。 */
  entries: TrafficEntry[]
  summary: TrafficSummary
  window: { capacity: number; kept: number; dropped: number; parseErrors: number }
  /** 调用参数级别的问题，例如写了不存在的出口名。 */
  warnings: string[]
  /** 固定的边界说明。 */
  note: string
}

/** 查询时由服务层补的上下文。 */
export interface TrafficContext {
  /** 出口名 → 展示名。 */
  labels: Record<string, string>
  /** 可用出口名，用于校验 `out`。 */
  exits?: readonly string[]
  /** 访问日志是否正在写。 */
  live: boolean
  /** `live: false` 的原因。 */
  reason?: string
  /** 访问日志路径。 */
  file?: string
}

/** {@link AccessLog} 的入参。 */
export interface AccessLogOptions {
  /** 访问日志文件路径；`enabled: false` 时可为空串。 */
  path: string
  /** `false` 表示不写也不读访问日志。 */
  enabled: boolean
  /** 内存里最多保留多少条。 */
  capacity?: number
  /** 文件超过多少字节就在下次启动前截断。 */
  fileCapBytes?: number
  /** 轮询间隔（毫秒）。 */
  pollMs?: number
}

const DEFAULT_CAPACITY = 1000
const DEFAULT_FILE_CAP_BYTES = 8 * 1024 * 1024
const DEFAULT_POLL_MS = 400
/** 单次最多读多少字节，避免一次调度扫完一个超大文件。 */
const READ_CHUNK_BYTES = 256 * 1024
/** 单行上限；超过就当异常行丢弃。 */
const MAX_LINE_BYTES = 8 * 1024
/** 路径展示上限。 */
const MAX_PATH_CHARS = 200

/** 访问日志的边界说明；界面与工具都原样展示。 */
export const TRAFFIC_NOTE =
  '只统计经本插件 SOCKS/HTTP 端口进入的连接；「代理」= 转发到远端节点，'
  + '「直连」= 由本机直接出网，「拦截」= 被 block 出口丢弃。'
  + 'HTTPS 只能看到域名与端口；客户端自行解析 DNS 时只记录 IP。'

/**
 * 行格式：`时间 from 来源 accepted 目的 [入站 -> 出站]`。
 * 目的可以是 `tcp:host:port`、`udp:host:port`、`http://host:port/path` 或 `//host:port`。
 */
const LINE_PATTERN =
  /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))? from (\S+) accepted (\S+) \[(\S+) (?:->|>>) (\S+)\]$/

/** 出口分类：非 direct/block 的出口都是代理（`proxy` 或节点 tag）。 */
export function classifyOut(out: string): TrafficVerdict {
  if (out === 'direct') return 'direct'
  if (out === 'block') return 'block'
  return 'proxy'
}

/**
 * 把 `host:port`、`[v6]:port` 拆开。
 * @param value - 地址片段。
 * @returns 主机与端口；端口缺失时 `port` 为 null，完全无法解析时返回 undefined。
 */
function splitHostPort(value: string): { host: string; port: number | null } | undefined {
  if (value === '') return undefined
  if (value.startsWith('[')) {
    const matched = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(value)
    if (matched === null) return undefined
    return { host: matched[1]!, port: matched[2] === undefined ? null : Number(matched[2]) }
  }
  const colon = value.lastIndexOf(':')
  if (colon > 0 && colon === value.indexOf(':') && /^\d{1,5}$/.test(value.slice(colon + 1))) {
    return { host: value.slice(0, colon), port: Number(value.slice(colon + 1)) }
  }
  // 没有端口或不是 host:port：整体当主机名（例如一直没带端口的怪行）。
  return { host: value, port: null }
}

/**
 * 脱敏明文 HTTP 的路径：去掉 userinfo，查询串与片段换成 `***`，再截断。
 * @param path - 原始路径（含查询串）。
 * @returns 可以展示的路径。
 */
function maskPath(path: string): string {
  const cut = path.search(/[?#]/)
  const base = cut === -1 ? path : `${path.slice(0, cut)}${path[cut] === '?' ? '?***' : ''}`
  const cleaned = base.replace(/\/\/[^/]*@/, '//')
  return cleaned.length > MAX_PATH_CHARS ? `${cleaned.slice(0, MAX_PATH_CHARS)}…` : cleaned
}

/**
 * 解析一条访问日志。无法解析时返回 null —— 调用方只计数，不猜。
 * @param line - 完整的一行（不含换行）。
 * @returns 结构化条目；`proxyLabel` 由调用方在入队时补。
 */
export function parseAccessLine(line: string): AccessEntry | null {
  const matched = LINE_PATTERN.exec(line.trim())
  if (matched === null) return null
  const [, year, month, day, hour, minute, second, fraction, rawSource, rawDest, inbound, out] = matched
  const millis = fraction === undefined ? 0 : Number(fraction.padEnd(3, '0').slice(0, 3))
  const time = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    millis,
  ).getTime()
  if (!Number.isFinite(time)) return null

  const sourceMatch = /^(tcp|udp):(.+)$/.exec(rawSource!)
  const network: 'tcp' | 'udp' = sourceMatch === null ? 'tcp' : (sourceMatch[1] as 'tcp' | 'udp')
  const source = sourceMatch === null ? rawSource! : sourceMatch[2]!

  let host = ''
  let port: number | null = null
  let path: string | undefined

  const destination = rawDest!
  const prefixed = /^(tcp|udp):(.+)$/.exec(destination)
  const url = /^(?:https?:)?\/\/(.+)$/.exec(destination)
  if (prefixed !== null) {
    const parsed = splitHostPort(prefixed[2]!)
    if (parsed === undefined) return null
    host = parsed.host
    port = parsed.port
  } else if (url !== null) {
    const authorityAndPath = url[1]!
    const slash = authorityAndPath.indexOf('/')
    const authority = (slash === -1 ? authorityAndPath : authorityAndPath.slice(0, slash)).replace(/^.*@/, '')
    const parsed = splitHostPort(authority)
    if (parsed === undefined) return null
    host = parsed.host
    port = parsed.port
    if (slash !== -1) path = maskPath(authorityAndPath.slice(slash))
  } else {
    const parsed = splitHostPort(destination)
    if (parsed === undefined) return null
    host = parsed.host
    port = parsed.port
  }
  if (host === '' || host.length > 400) return null

  return {
    time,
    source,
    network,
    inbound: inbound!,
    host,
    port,
    ...(path === undefined ? {} : { path }),
    out: out!,
    proxyLabel: null,
  }
}

/**
 * 进程内的环形访问日志 + 文件尾随。
 *
 * 生命周期：内核启动前 `prepare()`（截断超限文件、记下起始偏移）→ 启动后 `follow()`
 * → 停止/退出时 `unfollow()`。重启后从上次 EOF 继续，因此不会重复读旧行。
 */
export class AccessLog {
  private readonly log: RingLog
  private readonly path: string
  private readonly enabled: boolean
  private readonly capacity: number
  private readonly fileCapBytes: number
  private readonly pollMs: number

  private readonly entries: AccessEntry[] = []
  private dropped = 0
  private parseErrors = 0
  private warnedParse = false
  private pending: Buffer = Buffer.alloc(0)
  private offset = 0
  private timer: NodeJS.Timeout | undefined
  private following = false
  private proxyLabel: string | null = null
  private lastError: string | null = null

  constructor(log: RingLog, options: AccessLogOptions) {
    this.log = log
    this.path = options.path
    this.enabled = options.enabled
    this.capacity = options.capacity ?? DEFAULT_CAPACITY
    this.fileCapBytes = options.fileCapBytes ?? DEFAULT_FILE_CAP_BYTES
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS
  }

  /** 记录 `proxy` 出口当前绑定的节点名；每条连接入队时快照一次。 */
  bindProxy(label: string | null): void {
    this.proxyLabel = label
  }

  /** 当前状态，供服务层拼 `live` 与原因。 */
  stats(): { following: boolean; kept: number; dropped: number; parseErrors: number; lastError: string | null } {
    return {
      following: this.following,
      kept: this.entries.length,
      dropped: this.dropped,
      parseErrors: this.parseErrors,
      lastError: this.lastError,
    }
  }

  /**
   * 内核启动前调用：超过上限就截断，否则从当前 EOF 开始读。
   * 放在 `xray -test` 之后、`spawn` 之前 —— `-test` 会创建空文件。
   */
  prepare(): void {
    if (!this.enabled || this.path === '') return
    this.pending = Buffer.alloc(0)
    let size: number
    try {
      size = statSync(this.path).size
    } catch {
      // 文件不存在（还没被 -test 创建）：从 0 开始。
      this.offset = 0
      return
    }
    // 目录本身是 0700；顺手把文件也收紧到 0600（xray 用默认 umask 创建）。
    try {
      chmodSync(this.path, 0o600)
    } catch {
      // 权限收紧失败不影响功能。
    }
    if (size <= this.fileCapBytes) {
      this.offset = size
      return
    }
    try {
      truncateSync(this.path, 0)
      this.offset = 0
      this.log.push('action', `访问日志超过 ${Math.round(this.fileCapBytes / 1024 / 1024)}MiB，已截断`)
    } catch (error) {
      // 截断失败不能挡住内核启动：跳过旧内容，从当前 EOF 继续追加。
      this.offset = size
      if (this.lastError === null) {
        this.lastError = `截断访问日志失败：${(error as Error).message}`
        this.log.push('error', this.lastError)
      }
    }
  }

  /** 开始轮询；重复调用是空操作。 */
  follow(): void {
    if (!this.enabled || this.path === '' || this.following) return
    this.following = true
    this.drain()
    this.timer = setInterval(() => {
      this.drain()
    }, this.pollMs)
    this.timer.unref?.()
  }

  /** 停止轮询并做最后一次 drain。 */
  unfollow(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    if (!this.following) return
    this.drain()
    this.following = false
    this.pending = Buffer.alloc(0)
  }

  /**
   * 把一段文本当成连续的日志行吃掉（供测试与最后一次 drain 使用）。
   * @param text - 可能含多行、也可能以不完整的行结尾。
   */
  ingest(text: string): void {
    this.ingestBytes(Buffer.from(text, 'utf8'))
  }

  /**
   * 读一次文件增量。轮询在定时器里跑，任何意外都只能记下来 —— 不能冒泡到宿主进程。
   */
  private drain(): void {
    try {
      this.readOnce()
    } catch (error) {
      if (this.lastError === null) {
        this.lastError = (error as Error).message
        this.log.push('error', `读取访问日志出错：${this.lastError}`)
      }
    }
  }

  /**
   * 读一次文件增量的实现：失败只记一次错误；文件被截断/重建时自动回到 0。
   */
  private readOnce(): void {
    if (!this.enabled || this.path === '') return
    let size: number
    try {
      size = statSync(this.path).size
    } catch {
      return
    }
    if (size < this.offset) {
      this.offset = 0
      this.pending = Buffer.alloc(0)
      this.log.push('action', '访问日志被截断或重建，从头部重新读取')
    }
    if (size === this.offset) return
    const length = Math.min(size - this.offset, READ_CHUNK_BYTES)
    if (length <= 0) return
    const buffer = Buffer.allocUnsafe(length)
    let read = 0
    let fd: number | undefined
    try {
      fd = openSync(this.path, 'r')
      read = readSync(fd, buffer, 0, length, this.offset)
    } catch (error) {
      if (this.lastError === null) {
        this.lastError = (error as Error).message
        this.log.push('error', `读取访问日志失败：${this.lastError}`)
      }
      return
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          // 文件已经不在，忽略。
        }
      }
    }
    if (read <= 0) return
    this.offset += read
    this.ingestBytes(buffer.subarray(0, read))
  }

  /**
   * 按 `\n` 切行（按字节切，避免多字节字符被读块截断），不完整的尾巴留到下一次。
   * @param chunk - 新读到的字节。
   */
  private ingestBytes(chunk: Buffer): void {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])
    let start = 0
    for (;;) {
      const newline = this.pending.indexOf(0x0a, start)
      if (newline === -1) break
      const line = this.pending.subarray(start, newline).toString('utf8').replace(/\r$/, '')
      start = newline + 1
      this.ingestLine(line)
    }
    const rest = this.pending.subarray(start)
    if (rest.length > MAX_LINE_BYTES) {
      this.parseErrors += 1
      this.pending = Buffer.alloc(0)
      return
    }
    // `subarray` 共享底层内存：复制一份，避免长期占住这一整块读缓冲。
    this.pending = Buffer.from(rest)
  }

  /**
   * 解析并入队一行。
   * @param line - 不含换行的一行。
   */
  private ingestLine(line: string): void {
    if (line.trim() === '') return
    const entry = parseAccessLine(line)
    if (entry === null) {
      this.parseErrors += 1
      if (!this.warnedParse) {
        this.warnedParse = true
        this.log.push('action', `访问日志有无法解析的行（已跳过后续同类行）：${line.slice(0, 200)}`)
      }
      return
    }
    this.entries.push({ ...entry, proxyLabel: this.proxyLabel })
    if (this.entries.length > this.capacity) {
      const overflow = this.entries.length - this.capacity
      this.entries.splice(0, overflow)
      this.dropped += overflow
    }
  }

  /**
   * 查询最近连接。
   * @param query - 过滤条件；字段之间是「且」。
   * @param context - 展示名、可用出口、`live` 与原因。
   * @returns 命中项（最新在前）与对全部命中项的汇总。
   */
  query(query: TrafficQuery, context: TrafficContext): TrafficView {
    const host = (query.host ?? '').trim().toLowerCase()
    const out = (query.out ?? '').trim()
    const verdict = query.verdict
    const limit = clampLimit(query.limit)
    const warnings: string[] = []
    if (out !== '' && context.exits !== undefined && !context.exits.includes(out)) {
      warnings.push(`没有这个出口名：${out}（可用出口见 proxy_routing_read 的 exits）`)
    }

    const matched: AccessEntry[] = []
    for (const entry of this.entries) {
      if (out !== '' && entry.out !== out) continue
      if (verdict !== undefined && classifyOut(entry.out) !== verdict) continue
      if (
        host !== ''
        && !entry.host.toLowerCase().includes(host)
        && !(entry.path?.toLowerCase().includes(host) ?? false)
      ) {
        continue
      }
      matched.push(entry)
    }

    let proxied = 0
    let direct = 0
    let blocked = 0
    const byOut: Record<string, number> = {}
    for (const entry of matched) {
      const kind = classifyOut(entry.out)
      if (kind === 'proxy') proxied += 1
      else if (kind === 'direct') direct += 1
      else blocked += 1
      byOut[entry.out] = (byOut[entry.out] ?? 0) + 1
    }

    const view: TrafficEntry[] = matched
      .slice(Math.max(0, matched.length - limit))
      .reverse()
      .map((entry) => ({
        ...entry,
        outLabel: labelOf(entry, context.labels),
        verdict: classifyOut(entry.out),
      }))

    return {
      live: context.live,
      ...(context.reason === undefined ? {} : { reason: context.reason }),
      file: context.file ?? this.path,
      entries: view,
      summary: {
        matched: matched.length,
        proxied,
        direct,
        blocked,
        byOut,
        first: matched[0]?.time ?? null,
        last: matched[matched.length - 1]?.time ?? null,
      },
      window: {
        capacity: this.capacity,
        kept: this.entries.length,
        dropped: this.dropped,
        parseErrors: this.parseErrors,
      },
      warnings,
      note: TRAFFIC_NOTE,
    }
  }
}

/**
 * 出口展示名：节点出口用节点名字；`proxy` 用入队时快照的节点名。
 * @param entry - 一条连接。
 * @param labels - 出口名 → 展示名。
 * @returns 展示文本。
 */
function labelOf(entry: AccessEntry, labels: Record<string, string>): string {
  if (entry.out === 'proxy' && entry.proxyLabel !== null && entry.proxyLabel !== '') return entry.proxyLabel
  return labels[entry.out] ?? entry.out
}

/**
 * 把 `limit` 钳到 1–200。
 * @param value - 调用方给的值。
 * @returns 实际使用的条数。
 */
function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 50
  return Math.min(Math.max(Math.trunc(value), 1), 200)
}
