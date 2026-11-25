/**
 * 排版层：一份宿主响应怎样摊成会话面板的行。
 *
 * 行顺序与取舍是本插件的显示契约：服务状态只在它与模型状态不同时出现；模型缺失时保留
 * 「模型 + 未找到」；抓取失败画一行「暂时无法获取」；还没收到响应时返回 null（整节隐藏）。
 * 面板不显示上游更新时间（数据仍保留在宿主响应里，留给排障）。
 *
 * 运行：`node test/rows.test.mjs`（或 pnpm test 跑全部）。
 */
import { zh } from '../src/locales.ts'
import { statusRows } from '../src/rows.ts'
import { extractSnapshot } from '../src/wire.ts'
import { check, finish, translator, upstreamFixture } from './helpers.mjs'

const t = translator(zh)

/** 上游 fixture → ok 响应。 */
function replyOf(overrides) {
  return { ok: true, ...extractSnapshot(upstreamFixture(overrides), 1795593000000) }
}

/** 只取标签与读数，便于断言顺序。 */
function pairs(rows) {
  return rows === null ? null : rows.map(row => [row.label, row.value])
}

console.log('--- R① 服务与模型状态一致：四行，不重复服务状态 ---')
const normal = replyOf()
check('行', pairs(statusRows(normal, t)), [
  ['模型', 'deepseek-v4.1-flash'],
  ['状态', '降级 · 延迟'],
  ['首 Token', '9.1 秒'],
  ['吞吐', '148 tok/s'],
])
check('key 顺序', statusRows(normal, t).map(row => row.key), ['model', 'status', 'ttft', 'tps'])
check('没有服务行', statusRows(normal, t).some(row => row.key === 'service'), false)

console.log('--- R② 服务状态与模型状态不同：多一行「Go 服务」在最前 ---')
const differing = replyOf({
  breakdown: [{ id: 'deepseek-v4.1-flash', status: 'operational', reason: 'none', speed: { ttft: 4208, tps: 168 } }],
})
check('行', pairs(statusRows(differing, t)), [
  ['Go 服务', '降级 · 延迟'],
  ['模型', 'deepseek-v4.1-flash'],
  ['状态', '正常'],
  ['首 Token', '4.2 秒'],
  ['吞吐', '168 tok/s'],
])

console.log('--- R③ 状态相同但原因不同：仍算不同 ---')
const reasonDiffers = replyOf({
  breakdown: [{ id: 'deepseek-v4.1-flash', status: 'degraded', reason: 'errors', speed: { ttft: 9058, tps: 148 } }],
})
check('服务行出现', statusRows(reasonDiffers, t)[0], { key: 'service', label: 'Go 服务', value: '降级 · 延迟' })

console.log('--- R④ 模型不在快照里：模型行 + 未找到 ---')
const missing = replyOf({ breakdown: [], models: [] })
check('行', pairs(statusRows(missing, t)), [
  ['Go 服务', '降级 · 延迟'],
  ['模型', 'deepseek-v4.1-flash'],
  ['状态', '未找到'],
])

console.log('--- R⑤ go 整个不在快照里：只保留模型缺失 ---')
const noGo = { ok: true, ...extractSnapshot({ updatedAt: 1795592912497, components: [] }, 1795593000000) }
check('行', pairs(statusRows(noGo, t)), [
  ['模型', 'deepseek-v4.1-flash'],
  ['状态', '未找到'],
])

console.log('--- R⑥ 不显示上游更新时间，即使响应里有 updatedAt ---')
check('没有更新行', statusRows(normal, t).some(row => row.key === 'updated'), false)

console.log('--- R⑦ 没有速度读数：省掉首 Token 与吞吐行 ---')
const noSpeed = replyOf({
  breakdown: [{ id: 'deepseek-v4.1-flash', status: 'degraded', reason: 'latency', speed: {} }],
})
check('行', pairs(statusRows(noSpeed, t)), [
  ['模型', 'deepseek-v4.1-flash'],
  ['状态', '降级 · 延迟'],
])

console.log('--- R⑧ 失败与空状态 ---')
check('还没收到响应 → null', statusRows(undefined, t), null)
check('抓取失败 → 一行', pairs(statusRows({ ok: false, error: 'network', message: 'boom' }, t)), [
  ['状态', '暂时无法获取'],
])
check('失败行 key', statusRows({ ok: false, error: 'network', message: '' }, t)[0].key, 'error')

console.log('--- R⑨ 什么都没有的成功响应：仍保留可诊断的模型缺失 ---')
check('行', pairs(statusRows({ ok: true, fetchedAt: 1, updatedAt: null, stale: false, service: null, model: null }, t)), [
  ['模型', 'deepseek-v4.1-flash'],
  ['状态', '未找到'],
])

console.log('--- R⑩ 陈旧标记不改变行集合 ---')
const stale = { ...normal, stale: true }
check('行数与新鲜时一致', statusRows(stale, t).length, 4)

finish()
