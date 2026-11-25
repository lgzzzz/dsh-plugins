/**
 * 宿主半部的集成测试：用替身 Context 调 `apply()`，再打 `/proxy-api` 与工具。
 *
 * 不依赖真实 DSH 与真实内核：存储域、子进程、HTTP、工具注册都是替身，
 * 但走的是插件真实的装配与业务代码路径。真实内核的链路见 `e2e.test.mjs`。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeHost } from './fake-host.mjs'
import { check, checkEqual, finish } from './helpers.mjs'

// 运行时目录指向临时目录，别碰用户的 ~/.dsh。
const home = mkdtempSync(join(tmpdir(), 'dsh-proxy-test-'))
process.env.DSH_HOME = home

const { apply } = await import('../index.ts')
const host = createFakeHost()
await apply(host.ctx, { socksPort: 18080, httpPort: 18081, geoDir: join(home, 'geo') })

const { routes, tools, toolOptions, skills, call } = host

/* --------------------------------------------------------------- 断言 */

console.log('host: 装配')

checkEqual(routes.length, 1, '注册了一个 HTTP 路由')
checkEqual(routes[0].path, '/proxy-api', '路由前缀')
check(routes[0].kind === 'prefix', '路由是 prefix 类型')
checkEqual(tools.size, 8, '注册了 8 个工具')
checkEqual(
  [...tools.keys()].sort(),
  ['proxy_latency_test', 'proxy_nodes_list', 'proxy_route_explain', 'proxy_routing_check', 'proxy_routing_read', 'proxy_routing_write', 'proxy_status', 'proxy_subscription_add'],
  '工具名齐全',
)
checkEqual(
  [...toolOptions.keys()].sort(),
  ['proxy_route_explain', 'proxy_routing_check', 'proxy_routing_write', 'proxy_subscription_add'],
  '只有改写类工具带激活条件',
)
checkEqual(skills.length, 1, '注册了一个技能')
checkEqual(skills[0].name, 'proxy-routing', '技能名')
check(skills[0].content.includes('geosite:'), '技能正文讲了值约定')
checkEqual(skills[0].invocation, { modelInvocable: true, userInvocable: true }, '技能对模型与用户都可见')

console.log('host: 读接口')

const state = await call('GET', '/state')
checkEqual(state.status, 200, '/state 返回 200')
checkEqual(state.json.status.ruleCount, 0, '初始没有规则')
checkEqual(state.json.status.ports.socks, 18080, '端口来自配置')
checkEqual(state.json.status.core.state, 'stopped', '内核初始未运行')
checkEqual(state.json.nodes.nodes, [], '初始没有节点')
check(Array.isArray(state.json.routing.exits) && state.json.routing.exits.includes('proxy'), 'exits 含内置出口')

const logs = await call('GET', '/logs')
checkEqual(logs.status, 200, '/logs 返回 200')
check(logs.json.lines.length > 0, '日志里有加载记录')

console.log('host: 校验接口')

const badCheck = await call('POST', '/check', { mode: 'patch', upsert: [{ id: 'Bad Id', match: { network: ['TCP'] }, out: 'nope' }] })
checkEqual(badCheck.status, 200, '/check 返回 200')
checkEqual(badCheck.json.valid, false, '非法规则校验不通过')
const codes = badCheck.json.diagnostics.map((entry) => entry.code)
check(codes.includes('rule/id-invalid'), '报 id 非法')
check(codes.includes('rule/network-invalid'), '报 network 非法')
check(codes.includes('rule/exit-unknown'), '报出口不存在')

const goodCheck = await call('POST', '/check', {
  mode: 'patch',
  upsert: [
    { id: 'ads', match: { domain: ['geosite:category-ads-all'] }, out: 'block' },
    { id: 'ai', match: { domain: ['domain:openai.com'] }, out: 'proxy' },
  ],
})
checkEqual(goodCheck.json.valid, true, '合法规则通过（geosite 缺数据文件时只有 warning）')
check(goodCheck.json.diagnostics.every((entry) => entry.code !== 'rule/geo-data-missing' || entry.severity === 'warning'), 'geosite 诊断不是 error')
checkEqual(goodCheck.json.changes.added, ['ads', 'ai'], 'changes 预告了新增的 id')

console.log('host: 写入与解释')

const write = await call('POST', '/write', {
  mode: 'patch',
  upsert: [
    { id: 'ads', match: { domain: ['geosite:category-ads-all'] }, out: 'block' },
    { id: 'ai', match: { domain: ['domain:openai.com'], port: ['443'] }, out: 'proxy' },
  ],
  reason: '测试写入',
})
checkEqual(write.status, 200, '/write 返回 200')
checkEqual(write.json.saved, true, '规则已保存')
checkEqual(write.json.applied, false, '没选节点时不应用')
check(write.json.message.includes('节点'), '保存消息说明未应用的原因')
checkEqual(write.json.routing.rules.length, 2, '保存后规则数')

const readBack = await call('GET', '/state')
checkEqual(readBack.json.routing.rules.length, 2, '状态里能读回规则')
checkEqual(readBack.json.status.ruleCount, 2, 'status 的规则数同步')

const explain = await call('POST', '/explain', { domain: 'api.openai.com', port: 443 })
checkEqual(explain.status, 200, '/explain 返回 200')
checkEqual(explain.json.matched?.id, 'ai', '仿真确定命中 ai')
checkEqual(explain.json.uncertain.map((entry) => entry.id), ['ads'], 'geosite 规则被列为可能抢先')
checkEqual(explain.json.certain, false, '结论不是必然')

console.log('host: 增量写入与删除')

const patch = await call('POST', '/write', { mode: 'patch', upsert: [{ id: 'ai', match: { domain: ['domain:anthropic.com'] }, out: 'proxy' }] })
checkEqual(patch.json.changes.replaced, ['ai'], '同 id 就地替换')
checkEqual(patch.json.routing.rules.length, 2, '替换不增加条数')

const removed = await call('POST', '/write', { mode: 'patch', delete: ['ads'] })
checkEqual(removed.json.changes.removed, ['ads'], '删除生效')
checkEqual(removed.json.routing.rules.length, 1, '删除后只剩一条')

console.log('host: 内核动作')

const coreStart = await call('POST', '/core', { action: 'start' })
checkEqual(coreStart.json.ok, false, '没有节点时拒绝启动')
check(coreStart.json.message.includes('节点'), '拒绝原因说明缺节点')

const badAction = await call('POST', '/core', { action: 'explode' })
checkEqual(badAction.status, 400, '非法 action 返回 400')

const notFound = await call('POST', '/nope')
checkEqual(notFound.status, 404, '未知端点返回 404')

console.log('host: 工具')

const statusTool = tools.get('proxy_status')
const statusResult = await statusTool.execute({})
checkEqual(statusResult.ruleCount, 1, 'proxy_status 读到当前规则数')
check(Array.isArray(statusResult.nodes.nodes), 'proxy_status 带节点视图')

const checkTool = tools.get('proxy_routing_check')
const checkResult = await checkTool.execute({ mode: 'replace', routing: { default: 'nope', rules: [] } })
checkEqual(checkResult.valid, false, '工具校验拦住不存在的 default')

const writeTool = tools.get('proxy_routing_write')
const toolWrite = await writeTool.execute({
  mode: 'replace',
  routing: { default: 'direct', rules: [{ id: 'corp', match: { domain: ['domain:corp.example'] }, out: 'direct' }] },
  apply: false,
  reason: '工具写入',
})
checkEqual(toolWrite.saved, true, '工具写入成功')
checkEqual(toolWrite.applied, false, 'apply=false 不应用')

const explainTool = tools.get('proxy_route_explain')
const toolExplain = await explainTool.execute({ domain: 'intranet.corp.example' })
checkEqual(toolExplain.matched?.id, 'corp', '工具仿真命中 corp')

const missingTool = tools.get('proxy_subscription_add')
const badSub = await missingTool.execute({ text: 'hysteria2://x@y:443' })
checkEqual(badSub.added, 0, '不支持的订阅不导入任何节点')
check(badSub.message.length > 0, '不支持的订阅有说明')

const toolOutput = checkTool.output.render({}, statusResult)
checkEqual(toolOutput[0].type, 'text', '渲染出文本块')
check(toolOutput[0].text.includes('"ruleCount"'), '渲染内容是 JSON')

console.log('host: 节点显示名字')

const namedSub = await call('POST', '/subscription', {
  text: 'vless://11111111-2222-3333-4444-555555555555@127.0.0.1:8443?security=tls&sni=example.com#节点一',
  name: '香港',
})
checkEqual(namedSub.json.added, 1, '导入带中文名的节点')
const node = namedSub.json.sample[0]
checkEqual(node.name, '节点一', '节点保留原始名字')
check(node.tag !== node.name, '非 ASCII 名字折成了 ASCII 出口名')
checkEqual(node.label, '节点一', '视图里的展示名是节点名字')

const namedState = await call('GET', '/state')
checkEqual(namedState.json.status.selectedNode?.label, '节点一', '状态栏用节点名字')
checkEqual(namedState.json.status.exitLabels[node.tag], '节点一', 'exitLabels 映射到节点名字')
checkEqual(namedState.json.status.exitLabels.direct, 'direct', '内置出口的展示名是自己')
checkEqual(namedState.json.routing.exitLabels[node.tag], '节点一', '规则视图也带 exitLabels')

const selectByName = await call('POST', '/select', { id: '节点一' })
checkEqual(selectByName.json.ok, true, '可以按名字选中节点')
check(selectByName.json.message.includes('节点一'), '选中消息用节点名字')

const latencyByTag = await call('POST', '/latency', { nodes: [node.tag] })
checkEqual(latencyByTag.json.results.length, 1, '按出口名能定位到节点')
checkEqual(latencyByTag.json.results[0].name, '节点一', '延迟结果带节点名字')

const explainNamed = await call('POST', '/explain', { domain: 'api.openai.com' })
checkEqual(explainNamed.json.fallbackOut, 'direct', '兜底出口仍是出口名')

// 把兜底改成节点：契约是 fallbackOut 存出口名，fallbackOutLabel 才是名字。
const namedFallback = await call('POST', '/write', {
  mode: 'patch',
  default: node.tag,
  apply: false,
})
checkEqual(namedFallback.json.saved, true, '兜底可以指向节点出口')
const explainFallback = await call('POST', '/explain', { domain: 'api.openai.com' })
checkEqual(explainFallback.json.fallbackOut, node.tag, '兜底出口存的是出口名')
checkEqual(explainFallback.json.fallbackOutLabel, '节点一', '兜底的展示名是节点名字')

const namedRead = await call('GET', '/state')
checkEqual(namedRead.json.routing.exits.includes(node.tag), true, 'exits 里是出口名而不是名字')
checkEqual(namedRead.json.routing.default, node.tag, '规则里存的仍是出口名')

rmSync(home, { recursive: true, force: true })
finish('host')
