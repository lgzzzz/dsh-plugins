/**
 * 浏览器半部收推送：同源 `GET /today-token-usage/stream` 的 SSE 长连接。
 *
 * 网页由宿主同源提供，连接会自动带上会话 cookie；宿主路由 `auth: 'required'` + owner 校验，
 * 因此这里不需要也不应该自己带任何凭据。宿主在每次当天读数变化时推一帧
 * `data: {...}`，连接建立时先补发一帧当前快照，所以这里没有轮询、也不需要自己算刷新时机。
 *
 * 断线由浏览器 `EventSource` 自动重连；重连成功后宿主会先补发当前快照，页面读数自动追平。
 * 每帧都过一遍形状守卫，坏帧（HTML fallback、手工篡改）直接忽略，不影响上一份读数。
 */

import { TODAY_USAGE_STREAM_PATH, parseTodayUsagePayload } from './wire.ts'
import type { TodayUsagePayload } from './wire.ts'

/** SSE 消息里本模块用到的部分。 */
export interface StreamMessageLike {
  readonly data: string
}

/** 本模块用到的 EventSource 最小面（测试可注入假实现）。 */
export interface EventSourceLike {
  onmessage: ((event: StreamMessageLike) => void) | null
  onerror: ((event: unknown) => void) | null
  close(): void
}

/** 建一条 SSE 连接的工厂。 */
export type EventSourceFactory = (url: string) => EventSourceLike

/** 浏览器原生 EventSource 的适配层：把 `MessageEvent` 收窄成 {@link StreamMessageLike}。 */
function openEventSource(url: string): EventSourceLike {
  const source = new EventSource(url)
  const like: EventSourceLike = {
    onmessage: null,
    onerror: null,
    close: () => source.close(),
  }
  source.onmessage = (event) => like.onmessage?.({ data: String(event.data) })
  source.onerror = (event) => like.onerror?.(event)
  return like
}

/**
 * 订阅宿主推送的当天读数。
 *
 * 连接建立后每条合法帧都会回调一次；坏帧忽略。返回值用于取订并关闭连接（面板卸载时调用）。
 * @param onPayload - 收到新读数时的回调。
 * @param createSource - EventSource 工厂；默认用浏览器原生实现。
 * @returns 取消订阅。
 */
export function subscribeTodayUsage(
  onPayload: (payload: TodayUsagePayload) => void,
  createSource: EventSourceFactory = openEventSource,
): () => void {
  let source: EventSourceLike
  try {
    source = createSource(TODAY_USAGE_STREAM_PATH)
  } catch {
    // 没有 EventSource（极端环境）时安静降级：面板没有数据，整节隐藏。
    return () => {}
  }
  source.onmessage = (event) => {
    let body: unknown
    try {
      body = JSON.parse(event.data)
    } catch {
      return
    }
    const payload = parseTodayUsagePayload(body)
    if (payload !== undefined) onPayload(payload)
  }
  source.onerror = () => {
    // EventSource 自己重连；重连成功后宿主先补发当前快照，这里不需要额外动作。
  }
  return () => {
    source.onmessage = null
    source.onerror = null
    source.close()
  }
}
