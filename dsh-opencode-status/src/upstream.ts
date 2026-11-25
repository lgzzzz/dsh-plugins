/**
 * 宿主上半部的取数：抓上游 status 快照，收窄成 {@link OpencodeStatusSnapshot}，并做短缓存。
 *
 * 上游是 Cloudflare 后面的公开 JSON（`cache-control: public, max-age=15`），不带 CORS 头，
 * 所以只能从宿主抓。页面每 5 秒要一次，这里做同长度的 TTL 缓存与并发合流：多个页面同时
 * 刷新也只打上游一次，连开多个页面不会线性放大上游请求；Cloudflare 边缘缓存本身还会再挡一层。
 *
 * 刷新失败时若手里还有一份不太旧的快照（10 分钟内），就带着 `stale: true` 交出去——
 * 面板继续显示上一次读数，而不是整栏消失；没有缓存才把错误交给路由回 502。
 */

import { extractSnapshot, UPSTREAM_STATUS_URL } from './wire.ts'
import type { OpencodeStatusSnapshot } from './wire.ts'

/** 上游响应收窄后的形状（只用到这两个成员）。 */
export interface UpstreamResponseLike {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

/** 抓上游的 fetch 最小面（测试可注入）。 */
export type UpstreamFetch = (url: string, init: {
  readonly headers: Record<string, string>
  readonly signal: AbortSignal
}) => Promise<UpstreamResponseLike>

/** 缓存有效期（毫秒）：与页面轮询间隔对齐，窗口内的并发只打一次上游。 */
export const DEFAULT_TTL_MS = 5_000

/** 单次抓取超时（毫秒）。 */
export const DEFAULT_TIMEOUT_MS = 10_000

/** 刷新失败后仍可用缓存兜底的最长年龄（毫秒）。 */
export const DEFAULT_STALE_MAX_AGE_MS = 10 * 60_000

/** 上游请求的 User-Agent：标明来路的第三方客户端。 */
export const USER_AGENT = 'dsh-opencode-status/1.0 (+https://opencode.ai/status)'

/** 取数器的构造选项。 */
export interface StatusSourceOptions {
  /** 抓上游的 fetch；默认 `globalThis.fetch`。 */
  readonly fetchImpl?: UpstreamFetch
  /** 当前时刻；默认 `Date.now`。 */
  readonly now?: () => number
  /** 缓存有效期（毫秒），默认 {@link DEFAULT_TTL_MS}。 */
  readonly ttlMs?: number
  /** 单次抓取超时（毫秒），默认 {@link DEFAULT_TIMEOUT_MS}。 */
  readonly timeoutMs?: number
  /** 缓存兜底的最长年龄（毫秒），默认 {@link DEFAULT_STALE_MAX_AGE_MS}。 */
  readonly staleMaxAgeMs?: number
  /** 刷新失败但用缓存兜底时的告警出口。 */
  readonly onError?: (message: string) => void
}

/** 取数器：`read()` 共享缓存与在途请求，`dispose()` 结束在途抓取。 */
export interface StatusSource {
  read(): Promise<OpencodeStatusSnapshot>
  dispose(): void
}

/** 从任意错误里取一行可读说明。 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 创建一个带 TTL 缓存与并发合流的上游取数器。
 * @param options - 注入的 fetch、时钟与缓存参数。
 * @returns 取数器句柄。
 */
export function createStatusSource(options: StatusSourceOptions = {}): StatusSource {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch as unknown as UpstreamFetch
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const staleMaxAgeMs = options.staleMaxAgeMs ?? DEFAULT_STALE_MAX_AGE_MS
  const onError = options.onError ?? (() => {})

  let cached: { readonly snapshot: OpencodeStatusSnapshot; readonly at: number } | undefined
  let inflight: Promise<OpencodeStatusSnapshot> | undefined
  let controller: AbortController | undefined
  let disposed = false

  /** 真正打一次上游；超时用定时器主动 abort。 */
  const load = async (): Promise<OpencodeStatusSnapshot> => {
    const active = new AbortController()
    controller = active
    const timer = setTimeout(() => active.abort(), timeoutMs)
    timer.unref?.()
    try {
      const response = await fetchImpl(UPSTREAM_STATUS_URL, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: active.signal,
      })
      if (!response.ok) throw new Error(`upstream responded ${response.status}`)
      const snapshot = extractSnapshot(await response.json(), now())
      cached = { snapshot, at: now() }
      return snapshot
    } finally {
      clearTimeout(timer)
      if (controller === active) controller = undefined
    }
  }

  const read = async (): Promise<OpencodeStatusSnapshot> => {
    if (disposed) throw new Error('status source disposed')
    if (cached !== undefined && now() - cached.at < ttlMs) return cached.snapshot

    let pending = inflight
    if (pending === undefined) {
      pending = load()
      inflight = pending
      const settle = (): void => {
        if (inflight === pending) inflight = undefined
      }
      // 自己的分支把拒绝也接住，避免并发读者共享同一个未处理的 rejection。
      pending.then(settle, settle)
    }

    try {
      return await pending
    } catch (error) {
      if (cached !== undefined && now() - cached.at <= staleMaxAgeMs) {
        onError(`refresh failed, serving cached snapshot: ${messageOf(error)}`)
        return { ...cached.snapshot, stale: true }
      }
      throw error
    }
  }

  return {
    read,
    dispose(): void {
      disposed = true
      cached = undefined
      inflight = undefined
      controller?.abort()
    },
  }
}
