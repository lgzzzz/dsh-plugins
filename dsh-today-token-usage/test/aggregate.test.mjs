/**
 * 读数的计算与格式：只加今天的会话、会话投影与列表行之间的去重与新鲜度、紧凑 Token 格式、
 * 缓存命中百分比（部分命中不许被舍入成 100%）。
 *
 * 运行：`node test/aggregate.test.mjs`（或 pnpm test 跑全部）。直接 import `src/aggregate.ts`。
 */
import { aggregateToday, formatCacheHitPercent, formatCompactTokens } from '../src/aggregate.ts'
import { check, finish } from './helpers.mjs'

/** 与 common 字典同形的假翻译函数（`number.thousand` / `number.million` 是共享键）。 */
const t = (key, params) => {
  if (key === 'number.thousand') return `${params.value}K`
  if (key === 'number.million') return `${params.value}M`
  throw new Error(`意外的键:${key}`)
}

const TODAY = '2026-11-24'
const YESTERDAY = '2026-11-23'

/** 一份 wire 值。 */
function usage(day, uncachedInputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0) {
  return { day, uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
}

/** 造一份会话列表快照：`rows` 是 byId 行（带 projectionValues），`projections` 是已连接会话的投影。 */
function state(rows, projections = {}) {
  return {
    byId: Object.fromEntries(Object.entries(rows).map(([id, value]) => [id, {
      id,
      ...value === undefined ? {} : { projectionValues: { todayTokenUsage: value } },
    }])),
    projectionsBySession: Object.fromEntries(Object.entries(projections).map(([id, value]) => [
      id,
      { values: { todayTokenUsage: value }, state: 'idle', error: null },
    ])),
  }
}

console.log('--- A① 只加今天、跨天的不算 ---')
const mixed = aggregateToday(state({
  a: usage(TODAY, 100, 10),
  b: usage(TODAY, 5, 1, 200, 3),
  c: usage(YESTERDAY, 999, 999),
  d: undefined,
}), TODAY)
check('汇总今天两个会话', mixed, {
  uncachedInput: 105,
  cacheRead: 200,
  cacheWrite: 3,
  output: 11,
  prompt: 308,
  total: 319,
})
check('昨天没有今天的用量时返回 undefined', aggregateToday(state({ c: usage(YESTERDAY, 1, 1) }), TODAY), undefined)
check('空列表返回 undefined', aggregateToday(state({}), TODAY), undefined)
check('全是 0 时返回 undefined', aggregateToday(state({ a: usage(TODAY, 0, 0) }), TODAY), undefined)

console.log('--- A② 已连接的投影比列表行新，且不重复计 ---')
const overridden = aggregateToday(state({
  a: usage(TODAY, 100, 10),
  b: usage(TODAY, 5, 1),
}, {
  a: usage(TODAY, 7, 1),
  x: usage(TODAY, 3, 2),
}), TODAY)
check('投影覆盖列表行、补上只在投影里的会话、其余列表行照旧', overridden, {
  uncachedInput: 15,
  cacheRead: 0,
  cacheWrite: 0,
  output: 4,
  prompt: 15,
  total: 19,
})

console.log('--- A③ 紧凑 Token 格式（与用量按钮同一套） ---')
check('三位数原样', formatCompactTokens(517, t), '517')
check('千位一位小数', formatCompactTokens(12_200, t), '12.2K')
check('百位以上千位取整', formatCompactTokens(517_000, t), '517K')
check('百万位一位小数', formatCompactTokens(1_234_567, t), '1.2M')
check('NaN 之外的 0', formatCompactTokens(0, t), '0')

console.log('--- A④ 缓存命中百分比 ---')
check('没有输入', formatCacheHitPercent(0, 0), null)
check('全部命中', formatCacheHitPercent(5, 5), '100')
check('三分之一', formatCacheHitPercent(1, 3), '33')
check('很低的比例取整到 0', formatCacheHitPercent(4, 1000), '0')
check('部分命中不许舍入成 100', formatCacheHitPercent(999, 1000), '99.9')
check('极小的未命中', formatCacheHitPercent(999_999, 1_000_000), '99.9999')

console.log('--- A⑤ 总用量算式 ---')
const single = aggregateToday(state({ a: usage(TODAY, 100, 10, 250, 20) }), TODAY)
check('输入三桶 + 输出', single, {
  uncachedInput: 100,
  cacheRead: 250,
  cacheWrite: 20,
  output: 10,
  prompt: 370,
  total: 380,
})

finish()
