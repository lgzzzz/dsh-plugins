/**
 * 浏览器侧取数：一次请求的响应收窄（readStatus）与周期轮询（pollStatus，默认 5 秒）。
 *
 * 假 fetch 覆盖正常/错误/非 JSON/网络异常四种响应；轮询用 5ms 短间隔验证「先取一次、
 * 之后继续排期、卸载后停止」，以及后台标签页跳过请求。
 *
 * 运行：`node test/status-client.test.mjs`（或 pnpm test 跑全部）。
 */
import { pollStatus, readStatus } from '../src/status-client.ts'
import { extractSnapshot, STATUS_PATH } from '../src/wire.ts'
import { check, checkTrue, finish, upstreamFixture } from './helpers.mjs'

const reply = { ok: true, ...extractSnapshot(upstreamFixture(), 1795593000000) }
const signal = new AbortController().signal

/** 一个可用的假响应。 */
function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/** 睡眠。 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

console.log('--- S① readStatus：正常响应 ---')
const seen = []
const good = await readStatus(async (url, init) => {
  seen.push({ url, init })
  return response(reply)
}, signal)
check('请求同源路由', seen[0].url, STATUS_PATH)
check('不带凭据头', seen[0].init.headers, { accept: 'application/json' })
check('不回缓存', seen[0].init.cache, 'no-store')
check('响应原样', good, reply)

console.log('--- S② readStatus：宿主 502 的错误载荷透传 ---')
const hostError = await readStatus(async () => response({ ok: false, error: 'upstream', message: 'boom' }, 502), signal)
check('错误载荷', hostError, { ok: false, error: 'upstream', message: 'boom' })

console.log('--- S③ readStatus：坏帧与网络异常折成 ok:false ---')
const html = await readStatus(async () => response('<!DOCTYPE html>'), signal)
check('HTML fallback', [html.ok, html.error], [false, 'invalid'])
const httpError = await readStatus(async () => response(undefined, 500), signal)
check('非 JSON 的 500', [httpError.ok, httpError.error], [false, 'http-500'])
const thrown = await readStatus(async () => { throw new Error('Failed to fetch') }, signal)
check('网络异常', thrown, { ok: false, error: 'network', message: 'Failed to fetch' })

console.log('--- S④ pollStatus：立刻取一次，然后按间隔继续 ---')
let calls = 0
const replies = []
const stop = pollStatus(next => {
  replies.push(next)
}, {
  intervalMs: 5,
  timeoutMs: 1_000,
  fetchImpl: async () => {
    calls += 1
    return response(reply)
  },
  isHidden: () => false,
})
await sleep(40)
checkTrue('至少取到两次', calls >= 2)
check('回调收到合法响应', replies[0].ok, true)
stop()
const stable = calls
await sleep(30)
check('卸载后不再请求', calls, stable)

console.log('--- S⑤ pollStatus：后台标签页跳过请求 ---')
let hiddenCalls = 0
const stopHidden = pollStatus(() => {}, {
  intervalMs: 5,
  fetchImpl: async () => {
    hiddenCalls += 1
    return response(reply)
  },
  isHidden: () => true,
})
await sleep(30)
check('后台不请求', hiddenCalls, 0)
stopHidden()

console.log('--- S⑥ pollStatus：失败也继续轮询 ---')
let failing = 0
const stopFailing = pollStatus(() => {
  failing += 1
}, {
  intervalMs: 5,
  fetchImpl: async () => { throw new Error('offline') },
  isHidden: () => false,
})
await sleep(30)
checkTrue('失败后继续', failing >= 2)
stopFailing()

console.log('--- S⑦ pollStatus：环境没有 fetch 时给出 unsupported ---')
const originalFetch = globalThis.fetch
globalThis.fetch = undefined
const unsupported = []
const stopNoFetch = pollStatus(next => unsupported.push(next), { intervalMs: 5, isHidden: () => false })
await sleep(15)
stopNoFetch()
globalThis.fetch = originalFetch
check('错误码', unsupported[0]?.error, 'unsupported')

finish()
