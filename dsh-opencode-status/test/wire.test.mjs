/**
 * 共享词汇：上游快照的收窄（`extractSnapshot`）与宿主响应的形状守卫（`parseStatusReply`）。
 *
 * 这里用的是上游真实结构（`components[].breakdown[]` 带 `status` 与 `speed`），另外覆盖
 * 「模型只在 models 里」「go 不在快照里」「模型不在 go 里」「整页不是对象」几种退化形状，
 * 以及浏览器侧守卫对坏帧的拒绝。
 *
 * 运行：`node test/wire.test.mjs`（或 pnpm test 跑全部）。
 */
import { extractSnapshot, parseStatusReply, MODEL_ID, SERVICE_ID, STATUS_PATH, UPSTREAM_STATUS_URL } from '../src/wire.ts'
import { check, finish, upstreamFixture } from './helpers.mjs'

console.log('--- W① 常量 ---')
check('同源路由', STATUS_PATH, '/opencode-status/status')
check('上游地址', UPSTREAM_STATUS_URL, 'https://opencode.ai/status/api/status')
check('服务键', SERVICE_ID, 'go')
check('模型 id', MODEL_ID, 'deepseek-v4.1-flash')

console.log('--- W② 从上游整页快照里收窄出 go / deepseek-v4.1-flash ---')
const snapshot = extractSnapshot(upstreamFixture(), 1795593000000)
check('抓取时刻', snapshot.fetchedAt, 1795593000000)
check('上游更新时间', snapshot.updatedAt, 1795592912497)
check('不陈旧', snapshot.stale, false)
check('服务', snapshot.service, { id: 'go', status: 'degraded', reason: 'latency' })
check('模型', snapshot.model, {
  id: 'deepseek-v4.1-flash',
  status: 'degraded',
  reason: 'latency',
  ttftMs: 9058,
  tps: 148,
})

console.log('--- W③ 模型只在 models 里：退回 models 条目 ---')
const onlyListed = extractSnapshot(upstreamFixture({ breakdown: [] }), 1)
check('模型 id 来自常量', onlyListed.model?.id, 'deepseek-v4.1-flash')
check('没有 status 时为 unknown', onlyListed.model?.status, 'unknown')
check('reason 用 models 条目的', onlyListed.model?.reason, 'latency')
check('没有速度读数', [onlyListed.model?.ttftMs, onlyListed.model?.tps], [null, null])

console.log('--- W④ 退化形状不抛错 ---')
const noGo = extractSnapshot({ updatedAt: 5, components: [{ service: 'payg', status: 'degraded' }] }, 2)
check('服务为 null', noGo.service, null)
check('模型为 null', noGo.model, null)
check('更新时间仍读出', noGo.updatedAt, 5)

const noModel = extractSnapshot(upstreamFixture({ breakdown: [], models: [] }), 3)
check('go 在、模型不在', [noModel.service?.id, noModel.model], ['go', null])

const garbage = extractSnapshot('not json', 4)
check('字符串输入 → 全空', [garbage.service, garbage.model, garbage.updatedAt, garbage.stale], [null, null, null, false])

const stale = extractSnapshot({ ...upstreamFixture(), stale: true }, 5)
check('上游 stale 透传', stale.stale, true)

const noSpeed = extractSnapshot(upstreamFixture({
  breakdown: [{ id: 'deepseek-v4.1-flash', status: 'operational', reason: 'none', speed: {} }],
}), 6)
check('speed 空对象 → null', [noSpeed.model?.ttftMs, noSpeed.model?.tps], [null, null])
check('operational 原样', noSpeed.model?.status, 'operational')

const zeroSpeed = extractSnapshot(upstreamFixture({
  breakdown: [{ id: 'deepseek-v4.1-flash', status: 'degraded', reason: 'latency', speed: { ttft: 0, tps: -1 } }],
}), 7)
check('非正数读数按没有处理', [zeroSpeed.model?.ttftMs, zeroSpeed.model?.tps], [null, null])

console.log('--- W⑤ 宿主响应守卫 ---')
const reply = { ok: true, ...snapshot }
check('成功响应原样通过', parseStatusReply(reply), reply)
check('service/model 双 null 通过', parseStatusReply({ ok: true, fetchedAt: 1, updatedAt: null, stale: false, service: null, model: null }), {
  ok: true,
  fetchedAt: 1,
  updatedAt: null,
  stale: false,
  service: null,
  model: null,
})
check('错误响应通过', parseStatusReply({ ok: false, error: 'upstream', message: 'boom' }), {
  ok: false,
  error: 'upstream',
  message: 'boom',
})
check('缺 message 的错误响应补空串', parseStatusReply({ ok: false, error: 'network' }), {
  ok: false,
  error: 'network',
  message: '',
})

check('缺 fetchedAt 拒绝', parseStatusReply({ ok: true, updatedAt: null, stale: false, service: null, model: null }), undefined)
check('缺 service 字段拒绝', parseStatusReply({ ok: true, fetchedAt: 1, updatedAt: null, stale: false, model: null }), undefined)
check('service 形状不对拒绝', parseStatusReply({ ok: true, fetchedAt: 1, updatedAt: null, stale: false, service: { id: 'go' }, model: null }), undefined)
check('model 的 ttftMs 类型不对拒绝', parseStatusReply({
  ok: true,
  fetchedAt: 1,
  updatedAt: null,
  stale: false,
  service: null,
  model: { id: 'x', status: 'degraded', reason: 'latency', ttftMs: '9.1', tps: 1 },
}), undefined)
check('HTML fallback 拒绝', parseStatusReply('<!DOCTYPE html>'), undefined)
check('null 拒绝', parseStatusReply(null), undefined)
check('ok 非布尔拒绝', parseStatusReply({ ok: 'true', fetchedAt: 1 }), undefined)
check('错误响应缺 error 码拒绝', parseStatusReply({ ok: false, message: 'boom' }), undefined)

finish()
