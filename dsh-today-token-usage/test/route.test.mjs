/**
 * 统计路由：JSON 快照（owner-only、只接受 GET、500 降级）与 SSE 推送（初始快照、扇出、
 * 断开清理、保活、卸载）。
 *
 * 用假的 req/res 与假 store 跑真处理函数；不启动 HTTP 服务。
 *
 * 运行：`node test/route.test.mjs`（或 pnpm test 跑全部）。直接 import `src/route.ts`。
 */
import {
  KEEP_ALIVE_MS,
  TODAY_USAGE_PATH,
  TODAY_USAGE_STREAM_PATH,
  createTodayUsageHandler,
  createTodayUsageStream,
} from '../src/route.ts'
import { check, checkTrue, finish } from './helpers.mjs'

const SNAPSHOT = {
  day: '2026-11-25',
  requests: 3,
  uncachedInputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 30,
  cacheWriteTokens: 0,
  cost: { total: 0.000123, peak: 0.0001, offPeak: 0.000023, unpricedRequests: 0 },
  month: {
    month: '2026-11',
    requests: 9,
    uncachedInputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 0,
    cost: { total: 0.0009, peak: 0.0008, offPeak: 0.0001, unpricedRequests: 0 },
  },
}

/** 假 store：快照可推进，订阅者可手动扇出。 */
function fakeStore(initial = SNAPSHOT) {
  const listeners = new Set()
  let current = initial
  return {
    store: {
      snapshot: () => current,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    push(next) {
      current = next
      for (const listener of [...listeners]) listener(next)
    },
    listenerCount: () => listeners.size,
  }
}

/** 假响应：记录状态码、头、写入的 chunks，并支持 close 事件。 */
function fakeResponse() {
  const handlers = new Map()
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    ended: false,
    writableEnded: false,
    destroyed: false,
    flushed: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value
    },
    flushHeaders() {
      this.flushed = true
    },
    write(chunk) {
      this.chunks.push(String(chunk))
      return true
    },
    end(body) {
      this.ended = true
      this.writableEnded = true
      if (body !== undefined && body !== '') this.chunks.push(String(body))
    },
    once(event, listener) {
      const list = handlers.get(event) ?? []
      list.push(listener)
      handlers.set(event, list)
      return this
    },
    emit(event) {
      for (const listener of handlers.get(event) ?? []) listener()
    },
  }
}

/** 假请求。 */
function fakeRequest(method = 'GET') {
  return { method }
}

const OWNER = { principal: { kind: 'owner' } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 解析一帧 SSE 的载荷。 */
function framePayload(chunk) {
  checkTrue('是 data 帧', chunk.startsWith('data: ') && chunk.endsWith('\n\n'))
  return JSON.parse(chunk.slice('data: '.length, -2))
}

console.log('--- R① 路径常量 ---')
check('快照路径', TODAY_USAGE_PATH, '/today-token-usage/today')
check('推送路径', TODAY_USAGE_STREAM_PATH, '/today-token-usage/stream')
checkTrue('保活间隔正数', KEEP_ALIVE_MS > 0)

console.log('--- R② JSON 快照：owner 的 GET ---')
{
  const res = fakeResponse()
  createTodayUsageHandler({ snapshot: () => SNAPSHOT })(fakeRequest(), res, OWNER)
  check('状态码', res.statusCode, 200)
  check('内容类型', res.headers['content-type'], 'application/json; charset=utf-8')
  check('不缓存', res.headers['cache-control'], 'no-store')
  check('nosniff', res.headers['x-content-type-options'], 'nosniff')
  check('body', JSON.parse(res.chunks[0]), SNAPSHOT)
}

console.log('--- R③ JSON 快照：非 owner 403 / 非 GET 405 / 快照失败 500 ---')
{
  for (const { peer, status } of [
    { peer: { principal: { kind: 'guest' } }, status: 403 },
    { peer: undefined, status: 403 },
  ]) {
    const res = fakeResponse()
    createTodayUsageHandler({ snapshot: () => SNAPSHOT })(fakeRequest(), res, peer)
    check(`非 owner ${status}`, res.statusCode, status)
    check('不泄露快照', JSON.parse(res.chunks[0]).code, 'forbidden')
  }
  const notGet = fakeResponse()
  createTodayUsageHandler({ snapshot: () => SNAPSHOT })(fakeRequest('POST'), notGet, OWNER)
  check('405', notGet.statusCode, 405)
  check('allow', notGet.headers.allow, 'GET')
  const failed = fakeResponse()
  createTodayUsageHandler({
    snapshot: () => {
      throw new Error('boom')
    },
  })(fakeRequest(), failed, OWNER)
  check('500', failed.statusCode, 500)
  check('错误码', JSON.parse(failed.chunks[0]).code, 'internal')
}

console.log('--- R④ SSE：头、初始快照、后续扇出 ---')
{
  const { store, push, listenerCount } = fakeStore()
  const stream = createTodayUsageStream(store)
  check('store 订阅已建立', listenerCount(), 1)

  const res = fakeResponse()
  stream.handler(fakeRequest(), res, OWNER)
  check('状态码', res.statusCode, 200)
  check('SSE 内容类型', res.headers['content-type'], 'text/event-stream; charset=utf-8')
  check('不缓存', res.headers['cache-control'], 'no-store')
  check('长连接', res.headers.connection, 'keep-alive')
  check('关掉中间层缓冲', res.headers['x-accel-buffering'], 'no')
  checkTrue('头已冲刷', res.flushed === true)
  check('一帧初始快照', res.chunks.length, 1)
  check('初始快照内容', framePayload(res.chunks[0]), SNAPSHOT)

  push({ ...SNAPSHOT, requests: 4 })
  check('推送后多一帧', res.chunks.length, 2)
  check('推送内容', framePayload(res.chunks[1]).requests, 4)

  // 第二个页面拿到同一份快照与后续推送。
  const second = fakeResponse()
  stream.handler(fakeRequest(), second, OWNER)
  check('第二个页面初始快照', framePayload(second.chunks[0]).requests, 4)
  push({ ...SNAPSHOT, requests: 5 })
  check('两个页面都收到', [res.chunks.length, second.chunks.length], [3, 2])

  // 断开后不再写、且不报错。
  second.emit('close')
  push({ ...SNAPSHOT, requests: 6 })
  check('断开后不再收到', second.chunks.length, 2)

  stream.dispose()
  check('卸载时取消 store 订阅', listenerCount(), 0)
  checkTrue('卸载时结束在途响应', res.ended === true)
  const afterDispose = fakeResponse()
  stream.handler(fakeRequest(), afterDispose, OWNER)
  check('卸载后不再接新连接', afterDispose.chunks, [])
}

console.log('--- R⑤ SSE：非 owner / 非 GET 不建立连接 ---')
{
  const { store, listenerCount } = fakeStore()
  const stream = createTodayUsageStream(store)
  const forbidden = fakeResponse()
  stream.handler(fakeRequest(), forbidden, { principal: { kind: 'guest' } })
  check('403', forbidden.statusCode, 403)
  check('没有帧', forbidden.chunks.length, 1)
  check('仍是 JSON 错误', JSON.parse(forbidden.chunks[0]).code, 'forbidden')
  const notGet = fakeResponse()
  stream.handler(fakeRequest('POST'), notGet, OWNER)
  check('405', notGet.statusCode, 405)
  check('没有帧', notGet.chunks, [])
  stream.dispose()
  check('清理订阅', listenerCount(), 0)
}

console.log('--- R⑥ SSE：空闲保活帧 ---')
{
  const { store } = fakeStore()
  const stream = createTodayUsageStream(store, { keepAliveMs: 5 })
  const res = fakeResponse()
  stream.handler(fakeRequest(), res, OWNER)
  await sleep(30)
  checkTrue('写出了保活注释帧', res.chunks.includes(': keep-alive\n\n'))
  stream.dispose()
}

console.log('--- R⑦ SSE：快照失败回 500（不建长连接） ---')
{
  let subscribed = 0
  const store = {
    snapshot() {
      throw new Error('boom')
    },
    subscribe() {
      subscribed += 1
      return () => {}
    },
  }
  const stream = createTodayUsageStream(store)
  const res = fakeResponse()
  stream.handler(fakeRequest(), res, OWNER)
  check('500', res.statusCode, 500)
  check('JSON 错误', JSON.parse(res.chunks[0]).code, 'internal')
  stream.dispose()
  check('store 订阅已建立过', subscribed, 1)
}

finish()
