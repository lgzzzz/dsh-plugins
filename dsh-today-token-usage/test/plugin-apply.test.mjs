/**
 * 宿主半部装配：`apply` 只注册 `todayTokenUsage` 投影（键、版本、视图），不碰其它服务。
 *
 * 用假的 ctx 跑真 `apply`，验证接线而不是复述实现。假的 ctx 只提供 `sessionProjections`：
 * 装配若还去取持久化 / 投影缓存 / 活会话表，这里会直接抛错。
 *
 * 运行：`node test/plugin-apply.test.mjs`（或 pnpm test 跑全部）。
 */
import { apply, inject, name } from '../index.ts'
import { check, checkTrue, finish } from './helpers.mjs'

const today = new Date(2026, 10, 24, 15, 0, 0, 0).getTime()

console.log('--- P① 插件声明 ---')
check('名字', name, 'dsh-today-token-usage')
check('宿主依赖只有投影登记表', inject, ['sessionProjections'])

console.log('--- P② apply 注册的投影单元 ---')
const definitions = []
const ctx = {
  sessionProjections: {
    async register(definition) {
      definitions.push(definition)
      return { stateOf: () => ({}), readerFor: () => () => ({}), dispose: async () => {} }
    },
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

finish()
