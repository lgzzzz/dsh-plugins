/**
 * 宿主同源路由 `GET /opencode-status/status`：把取数器的一份快照交给页面。
 *
 * 安全约束与 DSH 其它 owner-only 路由一致：注册时 `auth: 'required'`（必须是活着的 Peer，
 * 浏览器带会话 cookie 才能过 `webserver/authorize`），处理函数再校验
 * `peer.principal.kind === 'owner'`；只接受 GET；响应 `cache-control: no-store`（页面自己
 * 控制轮询节奏，中间层不许缓存）。
 *
 * 上游失败时回 502 与一份 `{ ok: false, error, message }`，页面据此显示「暂时无法获取」，
 * 并保留上一份读数。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { OpencodeStatusSnapshot } from './wire.ts'
import type { WebPeer } from './web-types.ts'

/** 处理函数的第三参（准入后的 Peer）。 */
export type StatusRouteHandler = (req: IncomingMessage, res: ServerResponse, peer?: WebPeer) => Promise<void>

/** 处理函数需要的取数入口；测试直接注入。 */
export type StatusRead = () => Promise<OpencodeStatusSnapshot>

/** 发一份 JSON；统一 no-store 与 nosniff。 */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(payload))
}

/** 非 owner 一律 403。 */
function denyUnlessOwner(res: ServerResponse, peer: WebPeer | undefined): boolean {
  if (peer?.principal.kind === 'owner') return false
  sendJson(res, 403, { ok: false, error: 'forbidden', message: 'owner access required' })
  return true
}

/** 非 GET 一律 405。 */
function denyUnlessGet(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET') return false
  res.statusCode = 405
  res.setHeader('allow', 'GET')
  res.setHeader('cache-control', 'no-store')
  res.end()
  return true
}

/** 从任意错误里取一行可读说明。 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 构造路由处理函数。
 * @param options.read - 取一份上游快照。
 * @returns `(req, res, peer) => Promise<void>`。
 */
export function createStatusHandler(options: { readonly read: StatusRead }): StatusRouteHandler {
  return async (req, res, peer): Promise<void> => {
    if (denyUnlessOwner(res, peer) || denyUnlessGet(req, res)) return
    try {
      const snapshot = await options.read()
      sendJson(res, 200, { ok: true, ...snapshot })
    } catch (error) {
      sendJson(res, 502, { ok: false, error: 'upstream', message: messageOf(error) })
    }
  }
}
