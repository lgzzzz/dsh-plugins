/**
 * 宿主半部装配：`apply` 注册 `todayTokenUsage` 投影（键、版本、视图），并真的触发一轮冷会话回填。
 *
 * 用假的 ctx / 持久化 / 投影缓存跑真 `apply`，验证接线而不是复述实现。
 *
 * 运行：`node test/plugin-apply.test.mjs`（或 pnpm test 跑全部）。
 */
import { apply, inject, name } from '../index.ts'
import { check, checkTrue, finish } from './helpers.mjs'

const today = new Date(2026, 10, 24, 15, 0, 0, 0).getTime()

console.log('--- P① 插件声明 ---')
check('名字', name, 'dsh-today-token-usage')
check('宿主依赖', inject, ['sessionProjections', 'sessions'])

console.log('--- P② apply 注册的投影单元 ---')
const definitions = []
const reads = []
const refreshes = []
const warnings = []
const info = []
const sessions = new Map()

const fakePersistence = {
  async list() {
    return [
      // 今天建、缺行：该补。
      { header: { id: 'fresh', createdAt: today }, formatStatus: 'current' },
      // 昨天之前就没动过：不读。
      { header: { id: 'old', createdAt: today - 86_400_000 } },
    ]
  },
  async open(id) {
    reads.push(id)
    return {
      header: { id },
      inheritedEventCount: 0,
      async read() {
        return { eventState: 'detached', events: [] }
      },
      async close() {},
    }
  },
}
const fakeCache = {
  cachedSnapshot(header) {
    if (header.id === 'old') return { asOfSeq: 3, values: { sessionListMetadata: { blank: false, lastPromptAt: today - 86_400_000 } } }
    return undefined
  },
  coldSnapshot(header, inherited, events) {
    refreshes.push({ id: header.id, inherited, events: events.length })
  },
}

const ctx = {
  sessionProjections: {
    async register(definition) {
      definitions.push(definition)
      return { stateOf: () => ({}), readerFor: () => () => ({}), dispose: async () => {} }
    },
  },
  sessions: { get: (id) => sessions.get(id) },
  get: (key) => {
    if (key === 'sessionPersistence') return fakePersistence
    if (key === 'sessionProjectionCache') return fakeCache
    return undefined
  },
  effect: (callback) => {
    callback()
    return () => {}
  },
  logger: {
    info: (message) => info.push(message),
    warn: (message) => warnings.push(message),
  },
}

await apply(ctx)

check('注册了一个单元', definitions.length, 1)
const definition = definitions[0]
check('投影键', definition.key, 'todayTokenUsage')
check('状态版本', definition.stateVersion, 1)
checkTrue('有 wire 视图', typeof definition.wire?.view === 'function')

/** 折一段日志后的状态。 */
function fold(events, inherited = 0) {
  let state = definition.init({ id: 's' }, inherited)
  for (const event of events) state = definition.apply(state, event)
  return state
}

const EVENT = {
  type: 'assistant/message',
  seq: 0,
  time: today,
  data: {
    turn: 1,
    step: 1,
    message: { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [] },
    stream: [],
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900 },
  },
}

console.log('--- P③ 状态与视图真的能过 schema ---')
const state = fold([EVENT])
check('状态可存档', definition.stateSchema.parse(JSON.parse(JSON.stringify(state))), state)
const view = definition.wire.view(state)
check('视图值', view, { day: '2026-11-24', uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 900, cacheWriteTokens: 0 })
check('视图可发布', definition.wire.viewSchema.parse(view), view)
check('空日志的视图', definition.wire.viewSchema.parse(definition.wire.view(definition.init({ id: 's' }, 0))), {
  day: '',
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

console.log('--- P④ 回填真的跑了一轮（异步） ---')
for (let attempt = 0; attempt < 50 && refreshes.length === 0; attempt += 1) {
  await new Promise((resolve) => { setTimeout(resolve, 5) })
}
check('只读了今天活跃且缺行的会话', reads, ['fresh'])
check('折叠并写回了它', refreshes, [{ id: 'fresh', inherited: 0, events: 0 }])
check('补过之后没有告警', warnings, [])
checkTrue('有信息日志', info.length === 1 && info[0].includes('1 个'))

console.log('--- P⑤ 活在内存里的会话不回填 ---')
const liveReads = []
const ctx2 = {
  ...ctx,
  sessions: { get: (id) => (id === 'fresh' ? { id } : undefined) },
  get: (key) => {
    if (key === 'sessionPersistence') {
      return {
        async list() {
          return [{ header: { id: 'fresh', createdAt: today } }]
        },
        async open(id) {
          liveReads.push(id)
          throw new Error('不应被打开')
        },
      }
    }
    if (key === 'sessionProjectionCache') return { cachedSnapshot: () => undefined, coldSnapshot: () => {} }
    return undefined
  },
  logger: { info: () => {}, warn: () => {} },
}
await apply(ctx2)
await new Promise((resolve) => { setTimeout(resolve, 30) })
check('活会话不读日志', liveReads, [])

console.log('--- P⑥ 没有持久化 / 投影缓存时投影照常注册 ---')
const bare = []
await apply({
  sessionProjections: { async register(definition) { bare.push(definition); return {} } },
  sessions: { get: () => undefined },
  get: () => undefined,
  effect: (callback) => { callback(); return () => {} },
  logger: { info: () => {}, warn: () => {} },
})
check('仍然注册投影', bare.length, 1)

finish()
