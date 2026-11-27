/**
 * 宿主统计路由，两条都挂在 `webServer` 上：
 *
 *   - `GET /today-token-usage/today`：一次性 JSON 快照（curl / 排障 / 兜底用）；
 *   - `GET /today-token-usage/stream`：SSE 长连接，页面用它收推送。宿主在每次记录成功
 *     （以及跨零点）时把当天读数（含当月累计）写成一帧 `data: {...}`，不需要浏览器轮询。
 *
 * 安全约束（两条路由相同）：注册时 `auth: 'required'`（必须是活着的 Peer，浏览器带会话
 * cookie 才能过 `webserver/authorize` → `connection.authentication.authenticate`），处理函数
 * 再校验 `peer.principal.kind === 'owner'`；只接受 GET；响应 `cache-control: no-store`，
 * 不返回任何会话内容，只有聚合数字。
 *
 * SSE 细节：DSH 的 web server 明确把 `text/event-stream` 排除在 gzip 之外，长连接不会被压缩
 * 缓冲；每 15 秒写一行注释帧保活；零点定时器负责在没有任何新请求时也把「新的一天」推给页面。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TodayStore } from './store.ts'
import type { WebPeer } from './web-types.ts'
import type { TodayUsagePayload } from './wire.ts'
import { TODAY_USAGE_PATH, TODAY_USAGE_STREAM_PATH, nextLocalMidnight } from './wire.ts'

export { TODAY_USAGE_PATH, TODAY_USAGE_STREAM_PATH }

/** 路由处理函数；第三参是准入后的 Peer。 */
export type TodayUsageHandler =
  (req: IncomingMessage, res: ServerResponse, peer?: WebPeer) => void

/** SSE 保活间隔（毫秒）：长时间没有记录时，避免中间层把空闲连接当成死连接。 */
export const KEEP_ALIVE_MS = 15_000

/** 发一份 JSON；统一 no-store 与 nosniff。 */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(payload))
}

/** 非 owner 一律 403；两条路由共用。 */
function denyUnlessOwner(res: ServerResponse, peer: WebPeer | undefined): boolean {
  if (peer?.principal.kind === 'owner') return false
  sendJson(res, 403, { code: 'forbidden', message: 'owner access required' })
  return true
}

/** 非 GET 一律 405；两条路由共用。 */
function denyUnlessGet(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET') return false
  res.statusCode = 405
  res.setHeader('allow', 'GET')
  res.end()
  return true
}

/**
 * 用当天合计构造 JSON 快照路由的处理函数。
 * @param store - 提供 `snapshot()` 的 journal 存储。
 * @returns `(req, res, peer) => void`。
 */
export function createTodayUsageHandler(store: Pick<TodayStore, 'snapshot'>): TodayUsageHandler {
  return (req, res, peer): void => {
    if (denyUnlessOwner(res, peer) || denyUnlessGet(req, res)) return
    let payload: TodayUsagePayload
    try {
      payload = store.snapshot()
    } catch {
      sendJson(res, 500, { code: 'internal', message: 'token usage snapshot failed' })
      return
    }
    sendJson(res, 200, payload)
  }
}

/** 一帧 SSE 消息。 */
function dataFrame(payload: TodayUsagePayload): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/** SSE 推送器的构造选项。 */
export interface TodayUsageStreamOptions {
  /** 保活间隔（毫秒）；默认 {@link KEEP_ALIVE_MS}。 */
  readonly keepAliveMs?: number
  /** 当前时刻（测试可注入）。 */
  readonly now?: () => number
}

/** SSE 推送器：注册路由与卸载时都用同一个句柄。 */
export interface TodayUsageStream {
  /** 交给 `webServer.register()` 的处理函数。 */
  readonly handler: TodayUsageHandler
  /** 结束所有在途连接、清掉定时器并取消 store 订阅。 */
  dispose(): void
}

/**
 * 创建一个 SSE 推送器：把 store 的当天读数变化扇出给所有在线页面。
 *
 * 新连接建立时先补发一帧当前快照；之后每次记录成功由 store 订阅推送；零点定时器保证
 * 没有新请求时也会推送新一天的空读数。断开的连接自动从集合里移除，最后一个连接离开时
 * 停掉保活与零点定时器。
 * @param store - journal 存储。
 * @param options - 保活间隔与时钟。
 * @returns 推送器句柄。
 */
export function createTodayUsageStream(
  store: TodayStore,
  options: TodayUsageStreamOptions = {},
): TodayUsageStream {
  const keepAliveMs = options.keepAliveMs ?? KEEP_ALIVE_MS
  const now = options.now ?? Date.now
  const clients = new Set<ServerResponse>()
  let keepAlive: ReturnType<typeof setInterval> | undefined
  let midnight: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  /** 写一块内容；连接已结束就安静跳过。 */
  const write = (res: ServerResponse, chunk: string): void => {
    if (res.writableEnded || res.destroyed) return
    res.write(chunk)
  }

  /** 把一帧读数推给所有在线页面。 */
  const broadcast = (payload: TodayUsagePayload): void => {
    const frame = dataFrame(payload)
    for (const res of clients) write(res, frame)
  }

  /** 保活：定时写一行 SSE 注释帧。 */
  const startKeepAlive = (): void => {
    if (keepAlive !== undefined) return
    keepAlive = setInterval(() => {
      for (const res of clients) write(res, ': keep-alive\n\n')
    }, keepAliveMs)
    keepAlive.unref?.()
  }

  const stopKeepAlive = (): void => {
    if (keepAlive === undefined) return
    clearInterval(keepAlive)
    keepAlive = undefined
  }

  /**
   * 安排下一次跨零点补发：读一次快照，store 在换天时会通知所有订阅者（包括这里），
   * 因此页面在零点后会收到新一天的空读数。
   */
  const scheduleMidnight = (): void => {
    if (midnight !== undefined || disposed) return
    const delay = Math.max(1_000, nextLocalMidnight(now()) - now() + 1_000)
    midnight = setTimeout(() => {
      midnight = undefined
      try {
        store.snapshot()
      } catch {
        // 快照失败不影响推送器本身；下一次记录或零点仍会继续。
      }
      if (clients.size > 0) scheduleMidnight()
    }, delay)
    midnight.unref?.()
  }

  const stopMidnight = (): void => {
    if (midnight === undefined) return
    clearTimeout(midnight)
    midnight = undefined
  }

  /** 新页面接入：先补发当前快照，再纳入扇出集合。 */
  const addClient = (res: ServerResponse, initial: TodayUsagePayload): void => {
    write(res, dataFrame(initial))
    clients.add(res)
    startKeepAlive()
    scheduleMidnight()
    const release = (): void => removeClient(res)
    res.once('close', release)
    res.once('error', release)
  }

  /** 页面断开：移出集合，最后一个离开时停掉定时器。 */
  const removeClient = (res: ServerResponse): void => {
    if (!clients.delete(res)) {
      // 还没接入就断开（例如快照失败后连接被关）；不结束一个已结束的响应。
      return
    }
    if (clients.size > 0) return
    stopKeepAlive()
    stopMidnight()
  }

  const unsubscribe = store.subscribe(broadcast)

  const handler: TodayUsageHandler = (req, res, peer): void => {
    if (disposed || denyUnlessOwner(res, peer) || denyUnlessGet(req, res)) return
    // 先取快照：取不到时还能干净地回 500，而不是在 SSE 头已发出后再改状态码。
    let initial: TodayUsagePayload
    try {
      initial = store.snapshot()
    } catch {
      sendJson(res, 500, { code: 'internal', message: 'token usage snapshot failed' })
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'text/event-stream; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('connection', 'keep-alive')
    res.setHeader('x-accel-buffering', 'no')
    res.flushHeaders?.()
    addClient(res, initial)
  }

  return {
    handler,
    dispose(): void {
      if (disposed) return
      disposed = true
      unsubscribe()
      stopKeepAlive()
      stopMidnight()
      for (const res of clients) {
        if (!res.writableEnded && !res.destroyed) res.end()
      }
      clients.clear()
    },
  }
}
