/**
 * TTFT 读取与显示：投影优先、窗口折叠兜底、无样本与非法值、时长格式化（与上游
 * 同款规则），以及 `withDuration` 只改写 `stats.counts` 且只追加纯时长。
 *
 * 运行：`node test/ttft.test.mjs`（或 pnpm test 跑全部）。
 */
import { averageTTFT, foldTTFT, formatDuration, withDuration } from '../src/ttft.ts'
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

const timingNode = (stepStartTime, firstTokenTime) => ({
  kind: 'assistant',
  timing: { stepStartTime, firstTokenTime },
})

console.log('--- A 平均 TTFT 取值 ---')
{
  check(
    '投影优先，不混用窗口折叠',
    averageTTFT({ ttftMs: 6900, ttftSteps: 3 }, [timingNode(0, 999999)]),
    2300,
  )
  check(
    '投影在但样本为 0 → null（不回退到窗口）',
    averageTTFT({ ttftMs: 0, ttftSteps: 0 }, [timingNode(0, 3000)]),
    null,
  )
  check(
    '投影缺席 → 窗口折叠',
    averageTTFT(undefined, [timingNode(1000, 3300), timingNode(2000, 4300)]),
    2300,
  )
  check('非 assistant 忽略', foldTTFT([{ kind: 'tool-result' }, timingNode(1000, 3300)]).steps, 1)
  check('无 timing 忽略', averageTTFT(undefined, [{ kind: 'assistant' }]), null)
  check('单边 timing 忽略', averageTTFT(undefined, [{ kind: 'assistant', timing: { stepStartTime: 1, firstTokenTime: null } }]), null)
  check('倒挂夹到 0', averageTTFT(undefined, [timingNode(5000, 4000)]), 0)
  check('非法 projection → null', averageTTFT({ ttftMs: Number.NaN, ttftSteps: 2 }, undefined), null)
  check('空节点 → null', averageTTFT(undefined, []), null)
  check('undefined 节点 → null', averageTTFT(undefined, undefined), null)
}

console.log('--- B 时长格式化（与上游逐字一致） ---')
{
  check('2.3 秒', formatDuration(2300, fakeT), '2.3秒')
  check('59.94 秒', formatDuration(59940, fakeT), '59.9秒')
  check('整 60 秒', formatDuration(60000, fakeT), '1分0秒')
  check('125 秒', formatDuration(125000, fakeT), '2分5秒')
  check('0 秒', formatDuration(0, fakeT), '0秒')
}

console.log('--- C 只改写 stats.counts ---')
{
  const calls = []
  const base = (key, params) => {
    calls.push([key, params])
    return fakeT(key, params)
  }
  const wrapped = withDuration(base, '2.3秒')
  const counts = wrapped('stats.counts', { turns: 12, steps: 34 })
  check('第一段追加纯时长', counts, '12 轮 34 步 · 2.3秒')
  checkFalse('不出现「首 token」标签', counts.includes('首 token'))
  check('输出速度不受影响', wrapped('message.tokensPerSecond', { tps: '45.0' }), '45.0 tok/s')
  check('其它键原样', wrapped('stats.dialog.ttft'), '首 token 平均（TTFT）')
  check('参数原样转交', calls[0][1], { turns: 12, steps: 34 })
  checkSame('null 段返回原 t', withDuration(base, null), base)
  checkTrue('空段也追加（空字符串由调用方先转为 null）', withDuration(base, '')('stats.counts', { turns: 1, steps: 1 }).endsWith(' · '))
}

finish()
