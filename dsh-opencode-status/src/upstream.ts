/**
 * 宿主上半部的取数：抓上游 status 快照，收窄成 {@link OpencodeStatusSnapshot}，把结果常驻内存。
 *
 * 上游是 Cloudflare 后面的公开 JSON（`cache-control: public, max-age=15`），不带 CORS 头，
 * 所以只能从宿主抓。取数器有两种工作方式：
 *
 *   - 按需（默认）：读取时命中 5 秒 TTL，过期才抓；并发读者合流成一次上游请求；
 *   - 保活（`backgroundRefreshMs > 0`，插件装配时启用）：启动即抓一次，之后每
 *     {@link DEFAULT_BACKGROUND_REFRESH_MS} 主动刷新一次，把最新快照留在内存里。页面请求只读
 *     内存、不再等上游——打开会话时面板第一帧就有读数，而不是先空一阵再出现。
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

/** 按需读取的缓存有效期（毫秒）：与页面轮询间隔对齐，窗口内的并发只打一次上游。 */
export const DEFAULT_TTL_MS = 5_000

/** 单次抓取超时（毫秒）。 */
export const DEFAULT_TIMEOUT_MS = 10_000

/** 刷新失败后仍可用缓存兜底的最长年龄（毫秒）。 */
export const DEFAULT_STALE_MAX_AGE_MS = 10 * 60_000

/** 后台保活刷新的间隔（毫秒）：与页面轮询同一节奏，页面每次看到的都是本轮内存里的快照。 */
export const DEFAULT_BACKGROUND_REFRESH_MS = 5_000

/** 上游请求的 User-Agent：标明来路的第三方客户端。 */
export const USER_AGENT = 'dsh-opencode-status/1.0 (+https://opencode.ai/status)'

/** 取数器的构造选项。 */
export interface StatusSourceOptions {
  /** 抓上游的 fetch；默认 `globalThis.fetch`。 */
  readonly fetchImpl?: UpstreamFetch
  /** 当前时刻；默认 `Date.now`。 */
  readonly now?: () => number
  /** 按需读取的缓存有效期（毫秒），默认 {@link DEFAULT_TTL_MS}。 */
  readonly ttlMs?: number
  /** 单次抓取超时（毫秒），默认 {@link DEFAULT_TIMEOUT_MS}。 */
  readonly timeoutMs?: number
  /** 缓存兜底的最长年龄（毫秒），默认 {@link DEFAULT_STALE_MAX_AGE_MS}。 */
  readonly staleMaxAgeMs?: number
  /**
   * 后台保活刷新间隔（毫秒）。省略或 0 表示不主动刷新，只在读取时按 TTL 抓；
   * 插件装配时传 {@link DEFAULT_BACKGROUND_REFRESH_MS}。
   */
  readonly backgroundRefreshMs?: number
  /** 刷新失败但用缓存兜底时的告警出口。 */
  readonly onError?: (message: string) => void
}

/** 取数器：`read()` 共享内存快照与在途请求，`dispose()` 结束后台刷新与在途抓取。 */
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
 * 创建一个带内存缓存、并发合流与可选后台保活的上游取数器。
 * @param options - 注入的 fetch、时钟与缓存参数。
 * @returns 取数器句柄。
 */
export function createStatusSource(options: StatusSourceOptions = {}): StatusSource {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch as unknown as UpstreamFetch
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const staleMaxAgeMs = options.staleMaxAgeMs ?? DEFAULT_STALE_MAX_AGE_MS
  const backgroundRefreshMs = options.backgroundRefreshMs ?? 0
  const onError = options.onError ?? (() => {})

  let cached: { readonly snapshot: OpencodeStatusSnapshot; readonly at: number } | undefined
  let inflight: Promise<OpencodeStatusSnapshot> | undefined
  let controller: AbortController | undefined
  let disposed = false
  /** 最近一次刷新是否失败：用内存里的旧读数兜底时据此标 `stale`。 */
  let refreshFailed = false
  let backgroundTimer: ReturnType<typeof setInterval> | undefined

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
      refreshFailed = false
      return snapshot
    } finally {
      clearTimeout(timer)
      if (controller === active) controller = undefined
    }
  }

  /**
   * 刷新一次：并发读者共享同一轮上游请求。
   *
   * 失败时若缓存还在兜底年龄内，交回带 `stale` 的旧读数（不抛错）；否则把错误交给调用方。
   */
  const refresh = async (): Promise<OpencodeStatusSnapshot> => {
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
      refreshFailed = true
      if (cached !== undefined && now() - cached.at <= staleMaxAgeMs) {
        onError(`refresh failed, serving cached snapshot: ${messageOf(error)}`)
        return { ...cached.snapshot, stale: true }
      }
      throw error
    }
  }

  /** 交出一份内存读数；最近一次刷新失败时标 `stale`（数据本身仍是上一次成功抓到的）。 */
  const presented = (snapshot: OpencodeStatusSnapshot): OpencodeStatusSnapshot => (
    refreshFailed && !snapshot.stale ? { ...snapshot, stale: true } : snapshot
  )

  /** 后台保活：启动即预热，之后按间隔刷新；上游挂掉时保留内存里的旧读数。 */
  const keepWarm = (): void => {
    if (disposed || inflight !== undefined) return
    void refresh().catch((error: unknown) => {
      if (disposed) return
      onError(`background refresh failed: ${messageOf(error)}`)
    })
  }

  const read = async (): Promise<OpencodeStatusSnapshot> => {
    if (disposed) throw new Error('status source disposed')
    if (cached !== undefined) {
      const age = now() - cached.at
      if (age < ttlMs) return presented(cached.snapshot)
      // 保活模式下内存里始终有可用的读数：直接交出去，别让 HTTP 处理函数等上游。
      // 超过兜底年龄说明后台循环已经太久没成功，回到按需刷新，失败就交给路由。
      if (backgroundRefreshMs > 0 && age <= staleMaxAgeMs) return presented(cached.snapshot)
    }
    return refresh()
  }

  if (Number.isFinite(backgroundRefreshMs) && backgroundRefreshMs > 0) {
    keepWarm()
    backgroundTimer = setInterval(keepWarm, backgroundRefreshMs)
    backgroundTimer.unref?.()
  }

  return {
    read,
    dispose(): void {
      disposed = true
      cached = undefined
      inflight = undefined
      if (backgroundTimer !== undefined) {
        clearInterval(backgroundTimer)
        backgroundTimer = undefined
      }
      controller?.abort()
    },
  }
}
