/**
 * 工具暴露策略（方案 D）：常驻四个，另外四个等 `proxy-routing` 技能加载。
 *
 * 覆盖四条解锁路径与两条不解锁的路径：
 *   1. 模型调用 `skill` 成功；
 *   2. 用户以 `/proxy-routing` 显式调用（`session/event` 里的 `skill-invocation`）；
 *   3. resume / fork：请求头里已经声明过受控工具；
 *   4. `toolExposure: 'always'` 完全不设条件。
 * 反例：
 *   5. 加载别的技能不解锁；
 *   6. 锁定的 Agent 即使加载成功也不影响另一个 Agent。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeHost } from './fake-host.mjs'
import { check, checkEqual, finish } from './helpers.mjs'

const home = mkdtempSync(join(tmpdir(), 'dsh-proxy-activation-'))
process.env.DSH_HOME = home

const { apply } = await import('../index.ts')
const { SKILL_GATED_TOOLS, ALWAYS_ON_TOOLS } = await import('../src/tools.ts')
const { routingSkill } = await import('../src/skill.ts')

/* ------------------------------------------------------------- 替身 */

/**
 * 造一个替身 Agent：`requestHeader()` 返回给定值，`session.id` 用于 `/proxy-routing` 那条路径。
 * @param options - `tools` 是请求头里的工具声明，省略等于没有历史请求头。
 */
function fakeAgent(options = {}) {
  const id = `sess-${Math.random().toString(36).slice(2)}`
  const session = {
    id,
    requestHeader: () => (options.tools === undefined ? undefined : { config: {}, tools: options.tools.map((name) => ({ name, description: '', parameters: {} })) }),
  }
  return { id, session }
}

/** 一次成功的 `skill` 工具调用事件。 */
function skillLoaded(agent, name) {
  return [{ name: 'skill', arguments: { name }, agent }, { isError: false }]
}

/* ------------------------------------------------------------ 断言 */

console.log('activation: 默认策略')

const host = createFakeHost()
await apply(host.ctx, { socksPort: 18082, httpPort: 18083, geoDir: join(home, 'geo') })
const { tools, toolOptions, emit } = host

checkEqual(
  [...ALWAYS_ON_TOOLS].sort(),
  ['proxy_latency_test', 'proxy_nodes_list', 'proxy_routing_read', 'proxy_status', 'proxy_traffic_read'],
  '常驻组是五个只读工具',
)
checkEqual(
  [...SKILL_GATED_TOOLS].sort(),
  ['proxy_route_explain', 'proxy_routing_check', 'proxy_routing_write', 'proxy_subscription_add'],
  '受控组是校验 / 解释 / 写入 / 订阅',
)
checkEqual(ALWAYS_ON_TOOLS.length + SKILL_GATED_TOOLS.length, tools.size, '两组之和就是全部 9 个工具')
checkEqual(
  [...toolOptions.keys()].sort(),
  [...SKILL_GATED_TOOLS].sort(),
  '受控组每个都带 when，常驻组都不带',
)

const when = toolOptions.get('proxy_routing_write')?.when
check(typeof when === 'function', 'proxy_routing_write 有条件')
checkEqual(toolOptions.get('proxy_routing_check')?.when, when, '四个受控工具共用一个条件')

console.log('activation: 新 Agent 默认看不到受控工具')

const fresh = fakeAgent()
for (const name of SKILL_GATED_TOOLS) {
  checkEqual(await toolOptions.get(name).when({ agent: fresh, modelSelection: {}, signal: new AbortController().signal }), false, `新 Agent 看不到 ${name}`)
}

console.log('activation: 模型加载技能后解锁')

emit('tools/result', ...skillLoaded(fresh, routingSkill.name))
for (const name of SKILL_GATED_TOOLS) {
  check(await toolOptions.get(name).when({ agent: fresh, modelSelection: {}, signal: new AbortController().signal }), `加载技能后能看到 ${name}`)
}

console.log('activation: 加载别的技能不解锁')

const other = fakeAgent()
emit('tools/result', ...skillLoaded(other, 'office'))
checkEqual(await toolOptions.get('proxy_routing_write').when({ agent: other, modelSelection: {}, signal: new AbortController().signal }), false, '别的技能不解锁')

console.log('activation: 失败的技能加载不解锁')

const failed = fakeAgent()
emit('tools/result', { name: 'skill', arguments: { name: routingSkill.name }, agent: failed }, { isError: true })
checkEqual(await toolOptions.get('proxy_routing_write').when({ agent: failed, modelSelection: {}, signal: new AbortController().signal }), false, '失败结果不解锁')

console.log('activation: 用户 /proxy-routing 显式调用')

const invoked = fakeAgent()
host.agents.set(invoked.id, invoked)
emit('session/event', invoked.session, {
  type: 'user/message',
  data: { id: 'm1', role: 'user', content: [], source: { kind: 'skill-invocation', name: routingSkill.name, form: 'instructions' } },
})
check(await toolOptions.get('proxy_routing_write').when({ agent: invoked, modelSelection: {}, signal: new AbortController().signal }), '显式调用后解锁')

console.log('activation: resume / fork 靠请求头解锁')

const resumed = fakeAgent({ tools: ['proxy_status', 'proxy_routing_write', 'proxy_routing_check', 'proxy_route_explain', 'proxy_subscription_add'] })
check(await toolOptions.get('proxy_routing_write').when({ agent: resumed, modelSelection: {}, signal: new AbortController().signal }), '请求头声明过受控工具就解锁')

const ptcResumed = fakeAgent({ tools: ['run_code'] })
checkEqual(await toolOptions.get('proxy_routing_write').when({ agent: ptcResumed, modelSelection: {}, signal: new AbortController().signal }), false, 'PTC 的请求头只有 run_code，不解锁')

console.log('activation: Agent 释放后标记清除')

const disposed = fakeAgent()
emit('tools/result', ...skillLoaded(disposed, routingSkill.name))
check(await toolOptions.get('proxy_routing_write').when({ agent: disposed, modelSelection: {}, signal: new AbortController().signal }), '释放前解锁')
emit('agent/disposed', { agent: disposed })
checkEqual(await toolOptions.get('proxy_routing_write').when({ agent: disposed, modelSelection: {}, signal: new AbortController().signal }), false, '释放后标记清掉')

console.log('activation: toolExposure=always 全部常驻')

const alwaysHost = createFakeHost()
await apply(alwaysHost.ctx, { toolExposure: 'always', geoDir: join(home, 'geo') })
checkEqual(alwaysHost.toolOptions.size, 0, 'always 策略下没有工具带条件')
checkEqual(alwaysHost.tools.size, 9, 'always 策略下仍是 9 个工具')
checkEqual(alwaysHost.skills.length, 1, 'always 策略下技能照常注册')

rmSync(home, { recursive: true, force: true })
finish('activation')
