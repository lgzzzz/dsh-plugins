/**
 * 浏览器侧共享读数仓：页面装载后单点轮询，读数留在内存里，面板重挂载时第一帧就能取到。
 *
 * 用注入的假 fetch 与 5ms 短间隔，不碰真实网络。订阅、停止、幂等启动与「成功之后失败保留
 * 旧读数」都在这里验证；组件渲染见 `render.test.mjs`，单次取数与轮询节奏见
 * `status-client.test.mjs`。
 *
 * 运行：`node test/status-store.test.mjs`（或 pnpm test 跑全部）。
 */
import { createStatusStore } from '../src/status-store.ts'
import { extractSnapshot } from '../src/wire.ts'
import { check, checkTrue, finish, upstreamFixture } from './helpers.mjs'

const reply = { ok: true, ...extractSnapshot(upstreamFixture(), 1795593000000) }

/** 一个可用的假响应。 */
function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/** 睡眠。 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

console.log('--- T① 未启动时为空；启动后后台取数并留在内存 ---')
let calls = 0
const store = createStatusStore({
  intervalMs: 5,
  timeoutMs: 1_000,
  isHidden: () => false,
  fetchImpl: async () => {
    calls += 1
    return response(reply)
  },
})
check('启动前为空', store.current(), undefined)
store.start()
await sleep(20)
check('内存里有一份读数', store.current(), reply)
checkTrue('后台确实在取数', calls >= 2)
store.stop()

console.log('--- T② 停止后不再请求，读数仍可用于下一次挂载 ---')
const afterStop = calls
await sleep(20)
check('停止后不再请求', calls, afterStop)
check('读数保留', store.current(), reply)

console.log('--- T③ 重新启动：轮询继续，订阅者收到更新 ---')
const seen = []
const unsubscribe = store.subscribe(next => seen.push(next))
store.start()
await sleep(20)
store.stop()
checkTrue('订阅者收到推送', seen.length >= 2)
check('推送内容', seen[0], reply)
unsubscribe()

console.log('--- T④ 成功之后失败：保留最后一份成功读数 ---')
let mode = 'ok'
const flaky = createStatusStore({
  intervalMs: 5,
  isHidden: () => false,
  fetchImpl: async () => {
    if (mode === 'fail') throw new Error('offline')
    return response(reply)
  },
})
const seenFlaky = []
flaky.subscribe(next => seenFlaky.push(next))
flaky.start()
await sleep(15)
mode = 'fail'
await sleep(25)
flaky.stop()
check('读数仍是成功的', flaky.current().ok, true)
checkTrue('失败没有推给订阅者', seenFlaky.every(next => next.ok))

console.log('--- T⑤ 从未成功：交出失败，面板据此显示「暂时无法获取」 ---')
const down = createStatusStore({
  intervalMs: 5,
  isHidden: () => false,
  fetchImpl: async () => { throw new Error('offline') },
})
down.start()
await sleep(15)
down.stop()
check('失败读数', down.current(), { ok: false, error: 'network', message: 'offline' })

console.log('--- T⑥ start 幂等：重复启动只保留一条轮询 ---')
let starts = 0
const single = createStatusStore({
  intervalMs: 5,
  isHidden: () => false,
  fetchImpl: async () => {
    starts += 1
    return response(reply)
  },
})
single.start()
await sleep(15)
single.start()
single.stop()
const stoppedAt = starts
await sleep(20)
check('stop 后不再有请求', starts, stoppedAt)
check('停止后读数保留', single.current(), reply)

console.log('--- T⑦ 单个订阅者抛错不影响轮询与其它订阅者 ---')
let good = 0
const resilient = createStatusStore({
  intervalMs: 5,
  isHidden: () => false,
  fetchImpl: async () => response(reply),
})
resilient.subscribe(() => { throw new Error('boom') })
resilient.subscribe(() => { good += 1 })
resilient.start()
await sleep(20)
resilient.stop()
checkTrue('其它订阅者照常收到推送', good >= 2)

finish()
