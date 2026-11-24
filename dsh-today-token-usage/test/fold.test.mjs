/**
 * 折叠语义：日期归属、同一 step 的替换、重试后的新增、fork 继承前缀、视图引用稳定性。
 *
 * 运行：`node test/fold.test.mjs`（或 pnpm test 跑全部）。直接 import `src/fold.ts`（Type Stripping）。
 */
import { applyFold, initFold, viewOf } from '../src/fold.ts'
import { dayKey, nextMidnight, startOfDay, totalTokens } from '../src/wire.ts'
import { check, checkTrue, finish } from './helpers.mjs'

/** 某天某时刻的毫秒时间戳（本地时区构造，跨时区也落在同一天）。 */
const day1 = new Date(2026, 10, 24, 10, 0, 0, 0).getTime()
const day1Evening = new Date(2026, 10, 24, 23, 59, 0, 0).getTime()
const day2 = new Date(2026, 10, 25, 0, 1, 0, 0).getTime()

/** 一条 assistant 结算事件。 */
function settle(seq, time, turn, step, usage, extra = {}) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: { turn, step, usage, stream: [], ...extra },
  }
}

/** 四个桶的期望值。 */
function buckets(uncachedInput, output, cacheRead = 0, cacheWrite = 0) {
  return { uncachedInputTokens: uncachedInput, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
}

console.log('--- F① 日期键与日界 ---')
check('日期键', dayKey(day1), '2026-11-24')
check('日界是本地零点', startOfDay(day1), new Date(2026, 10, 24, 0, 0, 0, 0).getTime())
check('下一个零点', nextMidnight(day1), new Date(2026, 10, 25, 0, 0, 0, 0).getTime())
check('总用量 = 输入三桶 + 输出', totalTokens(buckets(10, 5, 100, 1)), 116)

console.log('--- F② 无关事件不改变状态（引用不变） ---')
const empty = initFold(0)
checkTrue('空状态的视图是常量', viewOf(empty) === viewOf(initFold(0)))
const untouched = applyFold(empty, { type: 'turn/start', seq: 0, time: day1, data: { turn: 1 } })
checkTrue('turn/start 返回原状态', untouched === empty)
check('空视图 day 为空串', viewOf(empty).day, '')

console.log('--- F③ 一次结算只算今天那一天 ---')
const first = applyFold(empty, settle(1, day1, 1, 1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 20 }))
check('当日桶', viewOf(first), { day: '2026-11-24', ...buckets(100, 10, 900, 20) })
check('叠加第二笔', viewOf(applyFold(first, settle(2, day1Evening, 1, 2, { inputTokens: 1, outputTokens: 2 }))), {
  day: '2026-11-24',
  ...buckets(101, 12, 900, 20),
})

console.log('--- F④ 同一 turn + step 重复结算按替换处理 ---')
const firstSettlement = viewOf(first)
const replaced = applyFold(first, settle(2, day1Evening, 1, 1, { inputTokens: 60, outputTokens: 10 }))
check('替换后只剩新的一笔', viewOf(replaced), { day: '2026-11-24', ...buckets(60, 10) })
const identical = applyFold(first, settle(2, day1Evening, 1, 1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 20 }))
checkTrue('完全相同的重复结算返回原状态', identical === first)
check('原状态的视图没被改写', viewOf(first), firstSettlement)

console.log('--- F⑤ 重试之后那次结算算新增 ---')
const retried = applyFold(first, { type: 'llm/retry-started', seq: 2, time: day1Evening, data: { retryId: 'r1', turn: 1, step: 1, provider: 'p', model: 'm' } })
check('重试清空替换槽', retried.last, null)
check('重试后同一 step 的结算叠加', totalTokens(viewOf(applyFold(retried, settle(3, day1Evening, 1, 1, { inputTokens: 90, outputTokens: 5 })))), totalTokens(viewOf(first)) + 95)
const unmatchedRetry = applyFold(first, { type: 'llm/retry-started', seq: 2, time: day1Evening, data: { retryId: 'r2', turn: 9, step: 9, provider: 'p', model: 'm' } })
checkTrue('别的 step 的重试不改变状态', unmatchedRetry === first)

console.log('--- F⑥ 跨过零点只保留新一天的桶 ---')
const next = applyFold(first, settle(2, day2, 2, 1, { inputTokens: 7, outputTokens: 3 }))
check('新一天从零开始', viewOf(next), { day: '2026-11-25', ...buckets(7, 3) })
const crossDayReplacement = applyFold(next, settle(3, day2, 2, 1, { inputTokens: 5, outputTokens: 1 }))
check('同一天内替换照常生效', viewOf(crossDayReplacement), { day: '2026-11-25', ...buckets(5, 1) })

console.log('--- F⑦ fork 继承前缀不计入 ---')
const forked = initFold(3)
const inherited = applyFold(forked, settle(2, day1, 1, 1, { inputTokens: 500, outputTokens: 50 }))
checkTrue('继承前缀的事件被跳过', inherited === forked)
check('第一条自有事件开始计', viewOf(applyFold(inherited, settle(3, day1, 1, 1, { inputTokens: 5, outputTokens: 1 }))), {
  day: '2026-11-24',
  ...buckets(5, 1),
})

console.log('--- F⑧ 用量取自 stream 里的 usage 块 ---')
const fromStream = applyFold(empty, {
  type: 'assistant/attempt',
  seq: 1,
  time: day1,
  data: {
    turn: 1,
    step: 1,
    stream: [
      { type: 'chunk', time: day1, chunk: { type: 'text-delta', index: 0, text: 'x' } },
      { type: 'chunk', time: day1, chunk: { type: 'usage', usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 2 } } },
    ],
  },
})
check('attempt 的 stream 用量', viewOf(fromStream), { day: '2026-11-24', ...buckets(5, 1, 2) })
const noUsage = applyFold(empty, { type: 'assistant/message', seq: 1, time: day1, data: { turn: 1, step: 1, usage: undefined, stream: [] } })
checkTrue('没有用量的事件被跳过', noUsage === empty)

finish()
