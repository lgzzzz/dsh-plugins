/**
 * 宿主取数器：TTL 缓存、并发合流、后台保活刷新、失败后的缓存兜底与超时/失败的错误路径。
 *
 * 用可注入的时钟与 fetch，不打真实网络；后台保活本身用真实计时器，测试里只等几毫秒。
 *
 * 运行：`node test/upstream.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  createStatusSource,
  DEFAULT_BACKGROUND_REFRESH_MS,
  DEFAULT_STALE_MAX_AGE_MS,
  DEFAULT_TTL_MS,
} from '../src/upstream.ts'
import { POLL_INTERVAL_MS } from '../src/status-client.ts'
import { UPSTREAM_STATUS_URL } from '../src/wire.ts'
import { check, checkTrue, finish, upstreamFixture } from './helpers.mjs'

/** 睡眠：等待后台保活跑一两次。 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 一个成功响应。 */
function okResponse(body = upstreamFixture()) {
  return { ok: true, status: 200, json: async () => body }
}

/** 在取数器上跑一个可控时钟。 */
function clockedSource(fetchImpl, extra = {}) {
  let clock = 0
  const source = createStatusSource({
    fetchImpl,
    now: () => clock,
    ...extra,
  })
  return {
    source,
    advance: ms => { clock += ms },
    at: () => clock,
  }
}

console.log('--- U① 成功抓取：URL、请求头与收窄结果 ---')
const seen = []
const success = clockedSource(async (url, init) => {
  seen.push({ url, headers: init.headers })
  return okResponse()
})
const first = await success.source.read()
check('上游 URL', seen[0].url, UPSTREAM_STATUS_URL)
check('请求接受 JSON', seen[0].headers.accept, 'application/json')
checkTrue('带 User-Agent', typeof seen[0].headers['user-agent'] === 'string')
check('模型读数', [first.model?.status, first.model?.ttftMs, first.model?.tps], ['degraded', 9058, 148])
check('服务读数', first.service, { id: 'go', status: 'degraded', reason: 'latency' })
check('不陈旧', first.stale, false)

console.log('--- U② TTL 缓存：有效期（默认 5 秒）内不再打上游 ---')
let calls = 0
const cached = clockedSource(async () => {
  calls += 1
  return okResponse()
})
await cached.source.read()
cached.advance(DEFAULT_TTL_MS - 1)
await cached.source.read()
check('TTL 内只抓一次', calls, 1)
cached.advance(1)
await cached.source.read()
check('过了 TTL 再抓一次', calls, 2)

console.log('--- U③ 并发合流：同时读只打一轮上游 ---')
let concurrentCalls = 0
let release
const gated = createStatusSource({
  fetchImpl: () => {
    concurrentCalls += 1
    return new Promise(resolve => { release = resolve })
  },
})
const pending1 = gated.read()
const pending2 = gated.read()
check('在途时只发起一次', concurrentCalls, 1)
release(okResponse())
const [a, b] = await Promise.all([pending1, pending2])
check('两个读者拿到同一份快照', a === b, true)
check('总调用一次', concurrentCalls, 1)

console.log('--- U④ 刷新失败：缓存年龄内的旧快照带 stale 兜底 ---')
let mode = 'ok'
let errors = []
const fallback = clockedSource(async () => {
  if (mode === 'fail') throw new Error('connect ECONNREFUSED')
  return okResponse()
}, { onError: message => errors.push(message) })
const fresh = await fallback.source.read()
fallback.advance(DEFAULT_TTL_MS + 1)
mode = 'fail'
const served = await fallback.source.read()
check('交回缓存快照', served.model?.ttftMs, fresh.model?.ttftMs)
check('标记陈旧', served.stale, true)
checkTrue('告警出口收到说明', errors.some(message => message.includes('ECONNREFUSED')))
mode = 'ok'
const recovered = await fallback.source.read()
check('下一次成功后不再陈旧', recovered.stale, false)

console.log('--- U⑤ 缓存太旧或没有缓存：把错误交给路由 ---')
const expired = clockedSource(async () => { throw new Error('boom') })
let failed = false
try {
  await expired.source.read()
} catch (error) {
  failed = String(error).includes('boom')
}
checkTrue('没有缓存时抛出', failed)

mode = 'ok'
const aged = clockedSource(async () => {
  if (mode === 'fail') throw new Error('boom')
  return okResponse()
})
await aged.source.read()
mode = 'fail'
aged.advance(DEFAULT_STALE_MAX_AGE_MS + 1)
failed = false
try {
  await aged.source.read()
} catch {
  failed = true
}
checkTrue('缓存超过兜底年龄后抛出', failed)

console.log('--- U⑥ 上游非 2xx ---')
const notOk = clockedSource(async () => ({ ok: false, status: 503, json: async () => ({}) }))
failed = false
try {
  await notOk.source.read()
} catch (error) {
  failed = String(error).includes('503')
}
checkTrue('报出状态码', failed)

console.log('--- U⑦ dispose：之后读取直接失败 ---')
const disposable = clockedSource(async () => okResponse())
await disposable.source.read()
disposable.source.dispose()
failed = false
try {
  await disposable.source.read()
} catch {
  failed = true
}
checkTrue('dispose 后拒绝', failed)

console.log('--- U⑧ 后台保活：启动即预热，读取只取内存 ---')
let warmClock = 0
let warmCalls = 0
const warm = createStatusSource({
  now: () => warmClock,
  ttlMs: DEFAULT_TTL_MS,
  // 间隔远大于测试时长：这里只验证「启动即预热」与「读取不触发按需抓取」。
  backgroundRefreshMs: 60_000,
  fetchImpl: async () => {
    warmCalls += 1
    return okResponse()
  },
})
await sleep(10)
check('启动即预热', warmCalls, 1)
warmClock += DEFAULT_TTL_MS + 1
const stored = await warm.read()
check('读取拿到内存快照', stored.model?.ttftMs, 9058)
check('读取没有触发上游', warmCalls, 1)
warm.dispose()

console.log('--- U⑨ 后台保活：按间隔继续刷新，dispose 后停止 ---')
let beatCalls = 0
const beating = createStatusSource({
  backgroundRefreshMs: 5,
  fetchImpl: async () => {
    beatCalls += 1
    return okResponse()
  },
})
await sleep(30)
checkTrue('间隔内多次刷新', beatCalls >= 2)
beating.dispose()
const beforeDispose = beatCalls
await sleep(25)
check('dispose 后停止', beatCalls, beforeDispose)

console.log('--- U⑩ 后台刷新失败：保留内存旧读数并标记陈旧 ---')
let backgroundMode = 'ok'
let backgroundClock = 0
const backgroundWarnings = []
const background = createStatusSource({
  now: () => backgroundClock,
  backgroundRefreshMs: 5,
  staleMaxAgeMs: 60_000,
  onError: message => backgroundWarnings.push(message),
  fetchImpl: async () => {
    if (backgroundMode === 'fail') throw new Error('connect ECONNREFUSED')
    return okResponse()
  },
})
await sleep(10)
backgroundMode = 'fail'
backgroundClock += DEFAULT_TTL_MS + 1
await sleep(15)
const staleRead = await background.read()
check('仍交出旧读数', staleRead.model?.ttftMs, 9058)
check('标记陈旧', staleRead.stale, true)
checkTrue('告警出口收到说明', backgroundWarnings.some(message => message.includes('ECONNREFUSED')))
background.dispose()

console.log('--- U⑪ 装配节奏：宿主保活与页面轮询同为 5 秒 ---')
check('宿主保活间隔', DEFAULT_BACKGROUND_REFRESH_MS, 5_000)
check('页面轮询间隔', POLL_INTERVAL_MS, 5_000)

finish()
