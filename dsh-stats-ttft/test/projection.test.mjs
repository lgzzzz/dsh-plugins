/**
 * 宿主投影 `recentStepStats`：逐步 TTFT/解码折叠、重试与失败步口径、最近 7 步环形窗口、
 * 视图引用稳定性、schema/summary 声明，以及宿主半部确实把单元注册到
 * `sessionProjections`。
 *
 * 窗口在 `step/end` 落步：进行中的步不计入；失败/取消的已结束步落零值占位。
 *
 * 运行：`node test/projection.test.mjs`（或 pnpm test 跑全部）。
 */
import { recentStepStatsProjectionDefinition as def } from '../src/recent.ts'
import { RECENT_STEPS } from '../src/recent-shared.ts'
import { check, checkFalse, checkSame, finish } from './helpers.mjs'

const event = (type, data, time) => ({ type, data, time })
const stepStart = (turn, step, time) => event('step/start', { turn, step }, time)
const stepEnd = (turn, step, time) => event('step/end', { turn, step }, time)
const attempt = (turn, step, time, stream) => event('assistant/attempt', { turn, step, stream }, time)
const message = (turn, step, time, { usage, stream = [] } = {}) => event(
  'assistant/message',
  { turn, step, message: {}, stream, ...(usage === undefined ? {} : { usage }) },
  time,
)
const firstToken = (time) => [{ type: 'chunk', time, chunk: { type: 'text-delta', index: 0, text: 'x' } }]

const applyAll = (events, state = def.init()) => events.reduce((next, item) => def.apply(next, item), state)
const viewOf = (state) => def.wire.view(state)

console.log('--- A 基本折叠：step/end 才落步 ---')
{
  const beforeEnd = applyAll([
    stepStart(1, 1, 1000),
    attempt(1, 1, 1100, firstToken(1200)),
    message(1, 1, 2000, { usage: { outputTokens: 40 } }),
  ])
  check('结算后、结束前不入窗口', viewOf(beforeEnd), [])
  check('累计暂存在打开步', beforeEnd.open.ttftMs, 200)

  const state = def.apply(beforeEnd, stepEnd(1, 1, 2100))
  check('step/end 落一条记录', viewOf(state), [
    { turn: 1, step: 1, ttftMs: 200, ttftSteps: 1, decodeMs: 800, decodeTokens: 40 },
  ])
  check('落步后边界关闭', state.open, null)
}

console.log('--- B 首 token 取首次尝试，重试退避进解码时间 ---')
{
  const state = applyAll([
    stepStart(1, 1, 1000),
    attempt(1, 1, 1100, firstToken(1200)),
    event('llm/retry-started', { turn: 1, step: 1 }, 1300),
    attempt(1, 1, 1400, firstToken(1500)),
    message(1, 1, 3000, { usage: { outputTokens: 10 } }),
    stepEnd(1, 1, 3100),
  ])
  check('TTFT 保留首次尝试', viewOf(state)[0].ttftMs, 200)
  check('解码时间跨过重试退避', viewOf(state)[0].decodeMs, 1800)
}

console.log('--- C 消息流里的首 token 与 usage 保护 ---')
{
  const fromStream = applyAll([
    stepStart(1, 1, 1000),
    message(1, 1, 2000, { stream: firstToken(1500), usage: { outputTokens: 5 } }),
    stepEnd(1, 1, 2100),
  ])
  check('无 attempt 时从消息流取首 token', viewOf(fromStream)[0], {
    turn: 1,
    step: 1,
    ttftMs: 500,
    ttftSteps: 1,
    decodeMs: 500,
    decodeTokens: 5,
  })

  const noUsage = applyAll([
    stepStart(1, 1, 1000),
    message(1, 1, 2000, { stream: firstToken(1500) }),
    stepEnd(1, 1, 2100),
  ])
  check('无 usage 只计 TTFT', viewOf(noUsage)[0], {
    turn: 1,
    step: 1,
    ttftMs: 500,
    ttftSteps: 1,
    decodeMs: 0,
    decodeTokens: 0,
  })

  for (const bad of [{ outputTokens: -1 }, { outputTokens: Number.NaN }, { outputTokens: '9' }, {}]) {
    const state = applyAll([
      stepStart(1, 1, 1000),
      message(1, 1, 2000, { stream: firstToken(1500), usage: bad }),
      stepEnd(1, 1, 2100),
    ], def.init())
    check(`非法 usage 不计解码: ${JSON.stringify(bad)}`, viewOf(state)[0], {
      turn: 1,
      step: 1,
      ttftMs: 500,
      ttftSteps: 1,
      decodeMs: 0,
      decodeTokens: 0,
    })
  }
}

console.log('--- D 失败步 / 取消步 / 重复消息 ---')
{
  const failed = applyAll([
    stepStart(1, 1, 1000),
    attempt(1, 1, 1100, firstToken(1200)),
    stepEnd(1, 1, 1300),
  ])
  check('失败步落零值步位', viewOf(failed), [
    { turn: 1, step: 1, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
  ])
  check('步结束清边界', failed.open, null)

  const late = applyAll([
    stepStart(1, 1, 1000),
    stepEnd(1, 1, 1100),
    message(1, 1, 2000, { stream: firstToken(1500), usage: { outputTokens: 5 } }),
  ])
  check('结束后到达的消息被忽略', viewOf(late)[0].ttftSteps, 0)

  const duplicate = applyAll([
    stepStart(1, 1, 1000),
    message(1, 1, 2000, { stream: firstToken(1500), usage: { outputTokens: 5 } }),
    message(1, 1, 3000, { stream: firstToken(2500), usage: { outputTokens: 5 } }),
    stepEnd(1, 1, 3100),
  ])
  check('同一步第二条消息不重复累计', viewOf(duplicate)[0], {
    turn: 1,
    step: 1,
    ttftMs: 500,
    ttftSteps: 1,
    decodeMs: 500,
    decodeTokens: 5,
  })

  const orphanEnd = applyAll([stepEnd(1, 1, 1000)])
  check('无起点的 step/end 也占位', viewOf(orphanEnd), [
    { turn: 1, step: 1, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
  ])

  const settled = applyAll([
    stepStart(1, 1, 1000),
    message(1, 1, 2000, { stream: firstToken(1500), usage: { outputTokens: 5 } }),
    stepEnd(1, 1, 2100),
  ])
  const duplicateEnd = def.apply(settled, stepEnd(1, 1, 2200))
  check('重复 step/end 不把样本覆盖成零值', viewOf(duplicateEnd), viewOf(settled))

  const openAtTurnEnd = applyAll([stepStart(1, 1, 1000), event('turn/end', { turn: 1, reason: {} }, 2000)])
  check('turn/end 丢弃未结束的步', viewOf(openAtTurnEnd), [])
}

console.log('--- E 最近 7 步环形窗口 ---')
{
  const events = []
  for (let step = 1; step <= 9; step += 1) {
    const time = step * 1000
    events.push(
      stepStart(1, step, time),
      message(1, step, time + 1000, { stream: firstToken(time + 500), usage: { outputTokens: 2 } }),
      stepEnd(1, step, time + 1100),
    )
  }
  const state = applyAll(events)
  check('窗口长度', viewOf(state).length, RECENT_STEPS)
  check('窗口保留最新的步', viewOf(state).map(item => item.step), [3, 4, 5, 6, 7, 8, 9])
  check('窗口内 TTFT 求和', viewOf(state).reduce((sum, item) => sum + item.ttftMs, 0), 7 * 500)
  check('窗口内 token 求和', viewOf(state).reduce((sum, item) => sum + item.decodeTokens, 0), 7 * 2)

  const withEmptyStep = applyAll([...events, stepStart(1, 10, 10_000), stepEnd(1, 10, 10_100)])
  check('空步占位并挤掉最旧样本', viewOf(withEmptyStep).map(item => item.step), [4, 5, 6, 7, 8, 9, 10])
  check('空步零值', viewOf(withEmptyStep).at(-1), {
    turn: 1,
    step: 10,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
  })
}

console.log('--- F 视图引用与状态边界 ---')
{
  let state = applyAll([stepStart(1, 1, 1000)])
  const before = viewOf(state)
  state = def.apply(state, attempt(1, 1, 1100, firstToken(1200)))
  checkSame('assistant/attempt 不换 steps 引用', viewOf(state), before)
  state = def.apply(state, message(1, 1, 2000, { usage: { outputTokens: 1 } }))
  checkSame('assistant/message 不换 steps 引用', viewOf(state), before)
  state = def.apply(state, stepEnd(1, 1, 2100))
  checkFalse('step/end 换新引用', Object.is(viewOf(state), before))

  const duplicateStart = applyAll([stepStart(1, 1, 1000), stepStart(1, 1, 2000), stepEnd(1, 1, 2100)])
  check('重复 step/start 只落一条', viewOf(duplicateStart).length, 1)

  const turnOnly = applyAll([event('turn/start', { turn: 1 }, 1000)])
  check('turn/start 不建步记录', viewOf(turnOnly).length, 0)
}

console.log('--- G schema / wire 声明 ---')
{
  const initial = def.init()
  check('stateVersion', def.stateVersion, 1)
  check('key', def.key, 'recentStepStats')
  check('summary=false', def.wire.summary, false)
  check('初始状态可被 schema 解析', def.stateSchema.parse(initial), { steps: [], open: null })
  const state = applyAll([stepStart(1, 1, 1000)])
  check('含打开步的状态可被 schema 解析', def.stateSchema.parse(state), state)
  check('wire 视图可被 viewSchema 解析', def.wire.viewSchema.parse(viewOf(state)), viewOf(state))
}

console.log('--- H 宿主半部注册 ---')
{
  const plugin = await import('../index.ts')
  check('导出 name', plugin.name, 'dsh-stats-ttft')
  let deps
  let registered
  const fakeCtx = {
    inject(injectedDeps, callback) {
      deps = injectedDeps
      callback({
        sessionProjections: {
          register(definition) {
            registered = definition
            return Promise.resolve({ dispose: async () => {} })
          },
        },
      })
    },
  }
  plugin.apply(fakeCtx)
  check('注册依赖', deps, ['sessionProjections'])
  check('注册单元', registered, def)
}

finish()
