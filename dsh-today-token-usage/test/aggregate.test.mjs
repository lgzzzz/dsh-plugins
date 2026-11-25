/**
 * 读数的计算与格式：把宿主读数摊成面板合计、紧凑 Token 格式、缓存命中百分比
 * （部分命中不许被舍入成 100%）。
 *
 * 运行：`node test/aggregate.test.mjs`（或 pnpm test 跑全部）。直接 import `src/aggregate.ts`。
 */
import { formatCacheHitPercent, formatCompactTokens, totalsOf } from '../src/aggregate.ts'
import { check, finish } from './helpers.mjs'

/** 与 common 字典同形的假翻译函数（`number.thousand` / `number.million` 是共享键）。 */
const t = (key, params) => {
  if (key === 'number.thousand') return `${params.value}K`
  if (key === 'number.million') return `${params.value}M`
  throw new Error(`意外的键:${key}`)
}

const DAY = '2026-11-25'

/** 一份宿主读数。 */
function payload({ requests = 1, uncachedInputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0 } = {}) {
  return { day: DAY, requests, uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
}

console.log('--- A① 当天合计：四桶 + 请求数 ---')
check('全部桶都搬到面板口径', totalsOf(payload({
  requests: 7,
  uncachedInputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 250,
  cacheWriteTokens: 20,
})), {
  uncachedInput: 100,
  cacheRead: 250,
  cacheWrite: 20,
  output: 10,
  prompt: 370,
  total: 380,
  requests: 7,
})
check('只有输入', totalsOf(payload({ uncachedInputTokens: 5 })).total, 5)
check('只有输出', totalsOf(payload({ outputTokens: 5 })).total, 5)

console.log('--- A② 没有 Token 时返回 undefined ---')
check('全零', totalsOf(payload({
  requests: 3,
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})), undefined)
check('没有请求', totalsOf(payload({ requests: 0 })), undefined)

console.log('--- A③ 紧凑 Token 格式（与用量按钮同一套） ---')
check('三位数原样', formatCompactTokens(517, t), '517')
check('千位一位小数', formatCompactTokens(12_200, t), '12.2K')
check('百位以上千位取整', formatCompactTokens(517_000, t), '517K')
check('百万位一位小数', formatCompactTokens(1_234_567, t), '1.2M')
check('0', formatCompactTokens(0, t), '0')
check('请求数也用同一套', formatCompactTokens(1_234, t), '1.2K')

console.log('--- A④ 缓存命中百分比 ---')
check('没有输入', formatCacheHitPercent(0, 0), null)
check('全部命中', formatCacheHitPercent(5, 5), '100')
check('三分之一', formatCacheHitPercent(1, 3), '33')
check('很低的比例取整到 0', formatCacheHitPercent(4, 1000), '0')
check('部分命中不许舍入成 100', formatCacheHitPercent(999, 1000), '99.9')
check('极小的未命中', formatCacheHitPercent(999_999, 1_000_000), '99.9999')

finish()
