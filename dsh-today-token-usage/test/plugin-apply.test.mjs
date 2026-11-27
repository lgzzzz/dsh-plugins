/**
 * 宿主半部装配：真 `apply` 在假 ctx 上完成
 *   `llm/stream` global 监听 → journal → 同源 JSON 快照 + SSE 推送 的接线。
 *
 * `DSH_HOME` 指到临时目录，验证 journal 真的落在 `$DSH_HOME/state/today-token-usage/`；
 * 不碰用户真实 home。
 *
 * 运行：`node test/plugin-apply.test.mjs`（或 pnpm test 跑全部）。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, inject, name } from '../index.ts'
import { TODAY_USAGE_PATH, TODAY_USAGE_STREAM_PATH } from '../src/route.ts'
import { RETENTION_DAYS, journalFileName } from '../src/journal.ts'
import { dayKey } from '../src/wire.ts'
import { check, checkTrue, finish } from './helpers.mjs'

const OWNER = { principal: { kind: 'owner' } }

/** 假宿主 ctx：收集监听、effect 与注入；webServer 在子 ctx 上出现。 */
function createContext() {
  const listeners = []
  const routes = []
  const effects = []
  const injections = []
  const warnings = []
  const ctx = {
    logger: { warn: (...args) => warnings.push(args.map(String).join(' ')) },
    on(event, listener, options) {
      listeners.push({ event, listener, options })
      return () => {}
    },
    effect(execute, label) {
      const disposer = execute()
      effects.push({ label, disposer })
      return disposer
    },
    inject(deps, callback) {
      injections.push(deps)
      if (!deps.includes('webServer')) return
      const webCtx = {
        webServer: {
          register(route) {
            routes.push(route)
            return () => {}
          },
        },
        effect(execute, label) {
          const disposer = execute()
          effects.push({ label, disposer })
          return disposer
        },
      }
      callback(webCtx)
    },
  }
  return { ctx, listeners, routes, effects, injections, warnings }
}

/** 假响应：同时支持 JSON（end 带 body）与 SSE（write 帧 + close 事件）。 */
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
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value
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

/** 一段假模型流。 */
async function* modelChunks(usage) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: 'hello' }
  if (usage !== undefined) yield { type: 'usage', usage }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** 走一遍监听：返回消费后的 chunks。 */
async function consume(listener, request, usage) {
  const stream = listener(request, () => modelChunks(usage))
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

/** 解析一帧 SSE 载荷。 */
function framePayload(chunk) {
  return JSON.parse(chunk.slice('data: '.length, -2))
}

/** 按路径取路由。 */
function routeOf(routes, path) {
  return routes.find(route => route.path === path)
}

console.log('--- P① 插件声明 ---')
check('名字', name, 'dsh-today-token-usage')
check('宿主依赖只有 llm', inject, ['llm'])

const root = await mkdtemp(join(tmpdir(), 'dsh-today-token-usage-apply-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = root
const { ctx, listeners, routes, effects, injections, warnings } = createContext()

try {
  console.log('--- P② 装配：监听 + 两条路由 + 目录 ---')
  await apply(ctx)
  check('注册了一个事件监听', listeners.length, 1)
  check('监听 llm/stream', listeners[0].event, 'llm/stream')
  check('global 监听（进程级调度器）', listeners[0].options, { global: true })
  check('注入过 webServer', injections.some(deps => deps.includes('webServer')), true)
  check('注册了两条路由', routes.length, 2)
  check('快照路由', [routeOf(routes, TODAY_USAGE_PATH)?.kind, routeOf(routes, TODAY_USAGE_PATH)?.auth], ['exact', 'required'])
  check('推送路由', [routeOf(routes, TODAY_USAGE_STREAM_PATH)?.kind, routeOf(routes, TODAY_USAGE_STREAM_PATH)?.auth], ['exact', 'required'])
  checkTrue('至少有两个清理 effect', effects.length >= 2)

  console.log('--- P③ 记一次请求：journal + 快照读数 ---')
  const listener = listeners[0].listener
  const chunks = await consume(listener, {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    messages: [],
    sessionId: 'session-1',
    purpose: 'session-title',
  }, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, cacheWriteTokens: 3 })
  check('chunk 原样交给消费方', chunks.length, 4)

  const snapshotRoute = routeOf(routes, TODAY_USAGE_PATH)
  const res = fakeResponse()
  snapshotRoute.handler({ method: 'GET' }, res, OWNER)
  check('路由 200', res.statusCode, 200)
  const payload = JSON.parse(res.chunks[0])
  const { cost: payloadCost, month: payloadMonth, ...payloadTotals } = payload
  check('路由当天读数', payloadTotals, {
    day: dayKey(Date.now()),
    requests: 1,
    uncachedInputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 900,
    cacheWriteTokens: 3,
  })
  checkTrue('费用随读数一起下发', payloadCost.total > 0 && payloadCost.unpricedRequests === 0)
  checkTrue('峰谷拆分相加等于总价', Math.abs(payloadCost.peak + payloadCost.offPeak - payloadCost.total) < 1e-12)
  check('当月累计一起下发', [payloadMonth.month, payloadMonth.requests], [dayKey(Date.now()).slice(0, 7), 1])
  checkTrue('当月与当天同口径', payloadMonth.cost.total === payloadCost.total)

  console.log('--- P④ SSE：初始快照 + 记录后自动推送 ---')
  const streamRoute = routeOf(routes, TODAY_USAGE_STREAM_PATH)
  const live = fakeResponse()
  streamRoute.handler({ method: 'GET' }, live, OWNER)
  check('SSE 头', live.headers['content-type'], 'text/event-stream; charset=utf-8')
  check('初始快照帧', framePayload(live.chunks[0]).requests, 1)
  await consume(listener, { provider: 'p', model: 'm', messages: [], sessionId: 'session-2' },
    { inputTokens: 7, outputTokens: 8 })
  check('记录后推了一帧', live.chunks.length, 2)
  const pushed = framePayload(live.chunks[1])
  const { cost: pushedCost, month: pushedMonth, ...pushedTotals } = pushed
  check('推送内容', pushedTotals, {
    day: dayKey(Date.now()),
    requests: 2,
    uncachedInputTokens: 107,
    outputTokens: 28,
    cacheReadTokens: 900,
    cacheWriteTokens: 3,
  })
  // 第二笔的模型 'm' 不在价目表里：费用只来自第一笔，未计价请求 +1。
  check('推送也带费用与未计价数', [pushedCost.total > 0, pushedCost.unpricedRequests], [true, 1])
  check('推送也带当月累计', [pushedMonth.month, pushedMonth.requests, pushedMonth.cost.unpricedRequests], [dayKey(Date.now()).slice(0, 7), 2, 1])

  console.log('--- P⑤ 没有用量的请求不计数 ---')
  await consume(listener, { provider: 'p', model: 'm', messages: [] }, undefined)
  const afterEmpty = fakeResponse()
  snapshotRoute.handler({ method: 'GET' }, afterEmpty, OWNER)
  check('仍然是 2 次', JSON.parse(afterEmpty.chunks[0]).requests, 2)

  console.log('--- P⑥ 清理 effect 排空写盘、结束 SSE ---')
  for (const { disposer } of effects) await disposer?.()
  checkTrue('SSE 连接已结束', live.ended === true)
  const path = join(root, 'state', 'today-token-usage', journalFileName(dayKey(Date.now())))
  const lines = (await readFile(path, 'utf8')).split('\n').filter(line => line.length > 0)
  check('一行一个请求', lines.length, 2)
  const record = JSON.parse(lines[0])
  check('记录带请求身份', [record.provider, record.model, record.sessionId, record.purpose, record.finish], [
    'opencode-go', 'deepseek-v4.1-flash', 'session-1', 'session-title', 'stop',
  ])
  check('保留期 35 天', RETENTION_DAYS, 35)
  const month = dayKey(Date.now()).slice(0, 7)
  const monthFile = JSON.parse(await readFile(join(root, 'state', 'today-token-usage', 'months', `${month}.json`), 'utf8'))
  check('月度汇总随退出落盘', [monthFile.month, monthFile.totals.requests], [month, 2])
  check('月度汇总的 checkpoint 是今天', monthFile.checkpointDay, dayKey(Date.now()))
  check('没有告警', warnings, [])
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true })
}

finish()
