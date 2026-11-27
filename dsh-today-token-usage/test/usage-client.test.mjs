/**
 * 浏览器侧收推送：SSE 订阅、坏帧忽略、取消订阅关闭连接。
 *
 * 用注入的假 EventSource 跑真 `subscribeTodayUsage`；不启动浏览器、不碰网络。
 *
 * 运行：`node test/usage-client.test.mjs`（或 pnpm test 跑全部）。直接 import `src/usage-client.ts`。
 */
import {
  readTodayUsageSnapshot,
  resetSharedTodayUsage,
  subscribeSharedTodayUsage,
  subscribeTodayUsage,
} from '../src/usage-client.ts'
import { TODAY_USAGE_STREAM_PATH } from '../src/wire.ts'
import { check, checkTrue, finish } from './helpers.mjs'

const PAYLOAD = {
  day: '2026-11-25',
  requests: 3,
  uncachedInputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 30,
  cacheWriteTokens: 0,
  cost: { total: 0.000123, peak: 0.0001, offPeak: 0.000023, unpricedRequests: 0 },
  month: {
    month: '2026-11',
    requests: 7,
    uncachedInputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: { total: 0.25, peak: 0.2, offPeak: 0.05, unpricedRequests: 0 },
  },
}

/** 假 EventSource：记录 URL，暴露可以手动触发的消息。 */
function fakeEventSource(url) {
  const source = {
    url,
    onmessage: null,
    onerror: null,
    closed: false,
    close() {
      this.closed = true
    },
    emit(data) {
      this.onmessage?.({ data })
    },
  }
  return source
}

/** 建一条订阅并返回假连接与收到的读数。 */
function open(createSource = fakeEventSource) {
  const received = []
  const source = {}
  const dispose = subscribeTodayUsage((payload) => received.push(payload), (url) => {
    source.value = createSource(url)
    return source.value
  })
  return { source: source.value, received, dispose }
}

console.log('--- U① 连接同源推送路由 ---')
{
  const { source } = open()
  check('URL', source.url, TODAY_USAGE_STREAM_PATH)
  check('是流路径', source.url, '/today-token-usage/stream')
}

console.log('--- U② 每条合法帧都回调 ---')
{
  const { source, received } = open()
  source.emit(JSON.stringify(PAYLOAD))
  source.emit(JSON.stringify({ ...PAYLOAD, requests: 4 }))
  check('两次回调', received.length, 2)
  check('读数', received[0], PAYLOAD)
  check('最新读数', received[1].requests, 4)
}

console.log('--- U③ 坏帧忽略 ---')
{
  const { source, received } = open()
  source.emit('not json')
  source.emit(JSON.stringify({ ...PAYLOAD, requests: -1 }))
  source.emit(JSON.stringify(null))
  source.emit(JSON.stringify({ ...PAYLOAD, day: 7 }))
  source.emit(JSON.stringify({ ...PAYLOAD, cost: { ...PAYLOAD.cost, total: -1 } }))
  source.emit(JSON.stringify({ ...PAYLOAD, cost: { ...PAYLOAD.cost, unpricedRequests: 1.5 } }))
  source.emit(JSON.stringify({ ...PAYLOAD, month: { ...PAYLOAD.month, month: '2026-13' } }))
  check('一条都没有回调', received, [])
  source.emit(JSON.stringify(PAYLOAD))
  check('坏帧之后仍能收到好帧', received.length, 1)
}

console.log('--- U④ 取消订阅关闭连接并摘掉回调 ---')
{
  const { source, received, dispose } = open()
  source.emit(JSON.stringify(PAYLOAD))
  check('先收到一帧', received.length, 1)
  dispose()
  checkTrue('连接已关闭', source.closed === true)
  check('回调已摘掉', [source.onmessage, source.onerror], [null, null])
  source.emit(JSON.stringify(PAYLOAD))
  check('关闭后不再回调', received.length, 1)
}

console.log('--- U⑤ 缺 month / cost 的旧载荷不渲染（不拿今天冒充当月） ---')
{
  const { source, received } = open()
  const { month, ...withoutMonth } = PAYLOAD
  const { cost, ...withoutCost } = PAYLOAD
  source.emit(JSON.stringify(withoutMonth))
  source.emit(JSON.stringify(withoutCost))
  check('两条都被拒绝', received, [])
  source.emit(JSON.stringify(PAYLOAD))
  check('完整载荷照常', received.length, 1)
}

console.log('--- U⑥ 没有 EventSource 时安静降级 ---')
{
  const dispose = subscribeTodayUsage(() => {}, () => {
    throw new Error('no EventSource in this environment')
  })
  checkTrue('返回可调用的取消函数', typeof dispose === 'function')
  dispose()
}

console.log('--- U⑦ 全页共用连接：缓存最近一帧，最后一个订阅者离开才关连接 ---')
{
  resetSharedTodayUsage()
  const calls = { a: 0, b: 0 }
  const source = fakeEventSource(TODAY_USAGE_STREAM_PATH)
  const disposeA = subscribeSharedTodayUsage(() => { calls.a += 1 }, () => source)
  source.emit(JSON.stringify(PAYLOAD))
  check('收到一帧并缓存', [calls.a, readTodayUsageSnapshot()?.requests], [1, 3])
  const disposeB = subscribeSharedTodayUsage(() => { calls.b += 1 })
  check('第二个订阅者复用同一条连接', source.closed, false)
  source.emit(JSON.stringify({ ...PAYLOAD, requests: 4 }))
  check('两个订阅者都收到', [calls.a, calls.b], [2, 1])
  disposeA()
  check('还有订阅者时不关连接', source.closed, false)
  disposeB()
  check('最后一个离开才关连接', source.closed, true)
  check('缓存保留最后一帧', readTodayUsageSnapshot()?.requests, 4)
  resetSharedTodayUsage()
}

finish()
