/**
 * 浏览器半部的取数：同源 `GET /opencode-status/status` 的轮询。
 *
 * 网页由宿主同源提供，请求自动带上会话 cookie；宿主路由 `auth: 'required'` + owner 校验，
 * 因此这里不需要也不应该自己带任何凭据。
 *
 * 节奏：启动时立刻取一次，之后每 5 秒一次（下一次在上一次有结果后才排，避免慢请求叠在一起）。
 * 上游快照本身约每分钟才变一次、且带 `cache-control: max-age=15`，5 秒是「更快看到变化」与
 * 「不放大上游请求」之间的折中。
 * 页面在后台标签里时跳过请求，只保留轻量的定时检查，回到前台后下一拍自动补取。
 * 单次请求 15 秒超时；失败不抛出，而是把 `{ ok: false }` 交给调用方——读数仓因此能在失败时
 * 保留上一份读数，或者在第一份就失败时给出可诊断的「暂时无法获取」。停止时中止在途请求。
 *
 * 启动与停止由 `status-store.ts` 在页面装载 / 插件卸载时控制：轮询不绑在组件挂载上，
 * 所以切换会话不会清空读数，也不会重新等一轮请求。
 */

import { parseStatusReply, STATUS_PATH } from './wire.ts'
import type { OpencodeStatusReply } from './wire.ts'

/** 轮询间隔（毫秒）：每 5 秒向同源路由要一次（宿主侧另有同长度缓存与并发合流）。 */
export const POLL_INTERVAL_MS = 5_000

/** 单次请求超时（毫秒）。 */
export const FETCH_TIMEOUT_MS = 15_000

/** 用到的 fetch 响应最小面（测试可注入）。 */
export interface StatusResponseLike {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

/** 用到的 fetch 最小面：同源、只读、可能被 AbortSignal 取消。 */
export type StatusFetch = (url: string, init: {
  readonly signal: AbortSignal
  readonly headers: Record<string, string>
  readonly cache: 'no-store'
}) => Promise<StatusResponseLike>

/** 轮询选项。 */
export interface PollStatusOptions {
  /** 轮询间隔（毫秒），默认 {@link POLL_INTERVAL_MS}。 */
  readonly intervalMs?: number
  /** 抓取实现，默认浏览器 `fetch`。 */
  readonly fetchImpl?: StatusFetch
  /** 单次请求超时（毫秒），默认 {@link FETCH_TIMEOUT_MS}。 */
  readonly timeoutMs?: number
  /** 页面是否在后台（后台时跳过请求）；默认看 `document.visibilityState`。 */
  readonly isHidden?: () => boolean
}

/** 从任意错误里取一行可读说明。 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 默认的后台判断：没有 `document`（测试 / 非浏览器）按前台处理。 */
function defaultIsHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/** 浏览器原生 fetch 的适配层；没有 fetch 的环境返回 undefined。 */
function nativeFetch(): StatusFetch | undefined {
  if (typeof fetch !== 'function') return undefined
  return (url, init) => fetch(url, init) as unknown as Promise<StatusResponseLike>
}

/**
 * 把外面（组件卸载 / 超时）的取消信号并成一次请求用的信号。
 * @param controller - 本次请求自己的控制器（卸载时 abort）。
 * @param timeoutMs - 超时毫秒数。
 * @returns 传给 fetch 的信号。
 */
function requestSignal(controller: AbortController, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  const anyOf = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  return typeof anyOf === 'function' ? anyOf([controller.signal, timeout]) : timeout
}

/**
 * 取一次状态。
 *
 * 网络失败、非 JSON 响应、形状不对都折成 `{ ok: false }`；宿主自己的错误响应（502 的
 * `{ ok: false, error, message }`）原样透传。
 * @param fetchImpl - 抓取实现。
 * @param signal - 取消信号。
 * @returns 一份响应（永远成功返回，不会抛错）。
 */
export async function readStatus(fetchImpl: StatusFetch, signal: AbortSignal): Promise<OpencodeStatusReply> {
  let response: StatusResponseLike
  try {
    response = await fetchImpl(STATUS_PATH, {
      signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
  } catch (error) {
    return { ok: false, error: 'network', message: messageOf(error) }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  const reply = parseStatusReply(body)
  if (reply !== undefined) return reply
  return {
    ok: false,
    error: response.ok ? 'invalid' : `http-${response.status}`,
    message: `unexpected response (${response.status})`,
  }
}

/**
 * 轮询宿主路由。
 * @param onReply - 每份响应的回调（成功与失败都会回调）。
 * @param options - 轮询间隔、抓取实现与超时。
 * @returns 停止函数：中止在途请求并停掉下一次轮询。
 */
export function pollStatus(
  onReply: (reply: OpencodeStatusReply) => void,
  options: PollStatusOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? nativeFetch()
  const isHidden = options.isHidden ?? defaultIsHidden

  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined

  /** 排下一次轮询。 */
  const schedule = (): void => {
    if (disposed) return
    timer = setTimeout(() => { void run() }, intervalMs)
  }

  /** 取一次并排下一次；某个环节失败也不中断轮询。 */
  const run = async (): Promise<void> => {
    timer = undefined
    if (disposed) return
    if (isHidden()) {
      schedule()
      return
    }
    if (fetchImpl === undefined) {
      onReply({ ok: false, error: 'unsupported', message: 'fetch is unavailable' })
      schedule()
      return
    }
    controller = new AbortController()
    const reply = await readStatus(fetchImpl, requestSignal(controller, timeoutMs))
    if (disposed) return
    onReply(reply)
    schedule()
  }

  void run()

  return () => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    controller?.abort()
  }
}
