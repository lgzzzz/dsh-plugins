/**
 * 最近步次统计的纯函数：窗口折叠（最后 5 个 assistant 节点）、投影取值、平均 TTFT / TPS、
 * 格式化、`withRecentReadings` 只改写 counts 与 tokensPerSecond，以及气泡还原用的
 * 全会话累计（`sessionStats` 优先）与两对文本。
 *
 * 运行：`node test/ttft.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  dialogReadings,
  foldRecentSteps,
  foldSessionTotals,
  formatDuration,
  formatTokensPerSecond,
  readRecentStats,
  readSessionTotals,
  withRecentReadings,
} from '../src/ttft.ts'
import { RECENT_STEPS, averageTTFT, sumRecentSteps, tokensPerSecond } from '../src/recent-shared.ts'
import { check, checkFalse, checkSame, checkTrue, finish } from './helpers.mjs'

const DICT = {
  'stats.counts': (params) => `${params.turns} 轮 ${params.steps} 步`,
  'message.tokensPerSecond': (params) => `${params.tps} tok/s`,
  'stats.dialog.ttft': () => '首 token 平均（TTFT）',
  'duration.compactSeconds': (params) => `${params.seconds}秒`,
  'duration.compactMinutes': (params) => `${params.minutes}分${params.seconds}秒`,
}

function fakeT(key, params = {}) {
  const render = DICT[key]
  if (render === undefined) return key
  return render(params)
}

/** 一个 assistant 节点：每一步一条，TTFT = 首 token − 步起点，解码 = 消息 − 首 token。 */
const assistantNode = (step, { stepStart = 0, firstToken = 2300, completed = 4300, outputTokens = 45 } = {}) => ({
  kind: 'assistant',
  turn: 1,
  step,
  timing: { stepStartTime: stepStart, firstTokenTime: firstToken, completedTime: completed },
  ...(outputTokens === null ? {} : { usage: { outputTokens } }),
})

console.log('--- A 窗口折叠：只取最后 5 步 ---')
{
  const nine = Array.from({ length: 9 }, (_, index) => assistantNode(index + 1))
  const totals = foldRecentSteps(nine)
  check('窗口大小', RECENT_STEPS, 5)
  check('样本步数 = 5（前四步被裁掉）', totals.ttftSteps, 5)
  check('TTFT 求和', totals.ttftMs, 5 * 2300)
  check('解码时间求和', totals.decodeMs, 5 * 2000)
  check('输出 token 求和', totals.decodeTokens, 5 * 45)
  check('平均 TTFT', averageTTFT(totals), 2300)
  check('TPS', tokensPerSecond(totals), 225 / 10)

  check('空窗口', foldRecentSteps([]), { ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 })
  check('无节点', foldRecentSteps(undefined), { ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 })
  check(
    '非 assistant / 缺 timing 忽略',
    foldRecentSteps([
      { kind: 'tool-result', turn: 1 },
      { kind: 'assistant', turn: 1, step: 2 },
      assistantNode(3, { firstToken: null }),
      assistantNode(4),
    ]),
    { ttftMs: 2300, ttftSteps: 1, decodeMs: 2000, decodeTokens: 45 },
  )
  check(
    '缺 usage 只计 TTFT',
    foldRecentSteps([assistantNode(1, { outputTokens: null })]),
    { ttftMs: 2300, ttftSteps: 1, decodeMs: 0, decodeTokens: 0 },
  )
  check('倒挂夹到 0', averageTTFT({ ttftMs: -5, ttftSteps: 1, decodeMs: 0, decodeTokens: 0 }), 0)
}

console.log('--- B 投影优先，缺席才窗口兜底 ---')
{
  const projection = [
    { turn: 1, step: 1, ttftMs: 9999, ttftSteps: 1, decodeMs: 9999, decodeTokens: 9999 },
    { turn: 1, step: 2, ttftMs: 6900, ttftSteps: 3, decodeMs: 1000, decodeTokens: 45 },
  ]
  const fromProjection = readRecentStats(projection, [assistantNode(99)])
  check('投影平均 TTFT', fromProjection.averageTTFT, (9999 + 6900) / 4)
  check('投影 TPS', fromProjection.tokensPerSecond, (9999 + 45) / ((9999 + 1000) / 1000))

  const emptyProjection = readRecentStats([], [assistantNode(1)])
  check('投影为空不回退窗口（TTFT）', emptyProjection.averageTTFT, null)
  check('投影为空不回退窗口（TPS）', emptyProjection.tokensPerSecond, null)

  const fallback = readRecentStats(undefined, [assistantNode(1), assistantNode(2)])
  check('窗口兜底平均 TTFT', fallback.averageTTFT, 2300)
  check('窗口兜底 TPS', fallback.tokensPerSecond, 22.5)
  check('窗口兜底：无样本', readRecentStats(undefined, []).averageTTFT, null)
}

console.log('--- C 格式化 ---')
{
  check('2.3 秒', formatDuration(2300, fakeT), '2.3秒')
  check('59.94 秒', formatDuration(59940, fakeT), '59.9秒')
  check('整 60 秒', formatDuration(60000, fakeT), '1分0秒')
  check('125 秒', formatDuration(125000, fakeT), '2分5秒')
  check('0 秒', formatDuration(0, fakeT), '0秒')
  check('TPS 45', formatTokensPerSecond(45), '45')
  check('TPS 4.56', formatTokensPerSecond(4.56), '4.6')
  check('TPS 0', formatTokensPerSecond(0), '0')
  check('TPS 非有限值', formatTokensPerSecond(Number.NaN), '0')
}

console.log('--- D 只改写 counts 与 tokensPerSecond ---')
{
  const calls = []
  const base = (key, params) => {
    calls.push([key, params])
    return fakeT(key, params)
  }
  const wrapped = withRecentReadings(base, { segment: '2.3秒', tps: '45' })
  const counts = wrapped('stats.counts', { turns: 12, steps: 34 })
  check('第一段追加纯时长', counts, '12 轮 34 步 · 2.3秒')
  checkFalse('不出现「首 token」标签', counts.includes('首 token'))
  check('速度段换成最近 5 步 TPS', wrapped('message.tokensPerSecond', { tps: '45.0' }), '45 tok/s')
  check('其它键原样', wrapped('stats.dialog.ttft'), '首 token 平均（TTFT）')
  check('参数原样转交', calls[0][1], { turns: 12, steps: 34 })

  checkSame('两项都为 null 返回原 t', withRecentReadings(base, { segment: null, tps: null }), base)
  check('只有时长', withRecentReadings(base, { segment: '2.3秒', tps: null })('stats.counts', { turns: 1, steps: 1 }), '1 轮 1 步 · 2.3秒')
  check(
    '只有 TPS',
    withRecentReadings(base, { segment: null, tps: '45' })('message.tokensPerSecond', { tps: '45.0' }),
    '45 tok/s',
  )
  check(
    'TPS 为 null 时保留上游读数',
    withRecentReadings(base, { segment: '2.3秒', tps: null })('message.tokensPerSecond', { tps: '45.0' }),
    '45.0 tok/s',
  )
  checkTrue(
    '空段也追加（空字符串由调用方先转为 null）',
    withRecentReadings(base, { segment: '', tps: null })('stats.counts', { turns: 1, steps: 1 }).endsWith(' · '),
  )
}

console.log('--- E 求和工具 ---')
{
  check('空数组', sumRecentSteps([]), { ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 })
  check(
    '逐步求和',
    sumRecentSteps([
      { turn: 1, step: 1, ttftMs: 100, ttftSteps: 1, decodeMs: 200, decodeTokens: 20 },
      { turn: 1, step: 2, ttftMs: 300, ttftSteps: 2, decodeMs: 400, decodeTokens: 40 },
    ]),
    { ttftMs: 400, ttftSteps: 3, decodeMs: 600, decodeTokens: 60 },
  )
  check('无 TTFT 样本', averageTTFT({ ttftMs: 0, ttftSteps: 0, decodeMs: 10, decodeTokens: 1 }), null)
  check('无解码时间', tokensPerSecond({ ttftMs: 1, ttftSteps: 1, decodeMs: 0, decodeTokens: 1 }), null)
}

console.log('--- F 全会话累计（气泡还原用） ---')
{
  check('无节点', foldSessionTotals(undefined), { turns: 0, steps: 0, decodeMs: 0, decodeTokens: 0 })
  const nodes = [
    assistantNode(1),
    assistantNode(2, { completed: 3300 }),
    { kind: 'tool-result', turn: 1, time: 100 },
    { kind: 'assistant', turn: 2, step: 1, timing: { stepStartTime: 0, firstTokenTime: 1300, completedTime: 2300 }, usage: { outputTokens: 45 } },
    { kind: 'assistant', turn: 3, step: 1, timing: { stepStartTime: 0, firstTokenTime: 1300, completedTime: 2300 } },
  ]
  check('计数与解码累计', foldSessionTotals(nodes), { turns: 3, steps: 4, decodeMs: 4000, decodeTokens: 135 })

  const projection = {
    turns: 12,
    steps: 34,
    llmMs: 5000,
    toolMs: 100,
    ttftMs: 2300,
    ttftSteps: 1,
    decodeMs: 1000,
    decodeTokens: 45,
  }
  check(
    '投影优先',
    readSessionTotals(projection, [assistantNode(99)]),
    { turns: 12, steps: 34, decodeMs: 1000, decodeTokens: 45 },
  )
  check(
    '投影字段不合法时窗口兜底',
    readSessionTotals({ turns: 12 }, [assistantNode(1)]),
    { turns: 1, steps: 1, decodeMs: 2000, decodeTokens: 45 },
  )
  check(
    '投影缺席时窗口兜底',
    readSessionTotals(undefined, [assistantNode(1)]),
    { turns: 1, steps: 1, decodeMs: 2000, decodeTokens: 45 },
  )
}

console.log('--- G 气泡还原文本 ---')
{
  const counts = { turns: 12, steps: 34 }
  const full = dialogReadings(fakeT, counts, { segment: '2.3秒', recentTps: 45, sessionTps: 60 })
  check('标题当前文本', full.countsFrom, '12 轮 34 步 · 2.3秒')
  check('标题还原文本', full.countsTo, '12 轮 34 步')
  check('速度当前文本', full.speedFrom, '45 tok/s')
  check('速度还原文本', full.speedTo, '60 tok/s')

  const noSegment = dialogReadings(fakeT, counts, { segment: null, recentTps: 45, sessionTps: 60 })
  check('时长缺席时不动标题', noSegment.countsFrom, null)
  check('时长缺席时仍还原速度', noSegment.speedFrom, '45 tok/s')

  const sameSpeed = dialogReadings(fakeT, counts, { segment: '2.3秒', recentTps: 45, sessionTps: 45 })
  check('速度相同不还原', sameSpeed.speedFrom, null)
  check('速度相同时标题照常还原', sameSpeed.countsFrom, '12 轮 34 步 · 2.3秒')

  const noSession = dialogReadings(fakeT, counts, { segment: '2.3秒', recentTps: 45, sessionTps: null })
  check('全会话 TPS 缺席时不动速度', noSession.speedFrom, null)
  check('全会话 TPS 缺席时标题照常还原', noSession.countsFrom, '12 轮 34 步 · 2.3秒')

  const tpsOnly = dialogReadings(fakeT, counts, { segment: null, recentTps: 4.5, sessionTps: 60 })
  check('只有 TPS 时不动标题', tpsOnly.countsFrom, null)
  check('只有 TPS 时速度文本按上游格式', tpsOnly.speedFrom, '4.5 tok/s')
}

finish()
