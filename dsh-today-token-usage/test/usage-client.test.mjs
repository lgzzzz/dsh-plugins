/**
 * 浏览器侧收推送：SSE 订阅、坏帧忽略、取消订阅关闭连接。
 *
 * 用注入的假 EventSource 跑真 `subscribeTodayUsage`；不启动浏览器、不碰网络。
 *
 * 运行：`node test/usage-client.test.mjs`（或 pnpm test 跑全部）。直接 import `src/usage-client.ts`。
 */
import { subscribeTodayUsage } from '../src/usage-client.ts'
import { TODAY_USAGE_STREAM_PATH } from '../src/wire.ts'
import { check, checkTrue, finish } from './helpers.mjs'

const PAYLOAD = {
  day: '2026-11-25',
  requests: 3,
  uncachedInputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 30,
  cacheWriteTokens: 0,
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

console.log('--- U⑤ 没有 EventSource 时安静降级 ---')
{
  const dispose = subscribeTodayUsage(() => {}, () => {
    throw new Error('no EventSource in this environment')
  })
  checkTrue('返回可调用的取消函数', typeof dispose === 'function')
  dispose()
}

finish()
