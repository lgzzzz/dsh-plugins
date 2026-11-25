/**
 * 端到端：真实的插件装配 + 真实 xray + 真实 `/proxy-api`。
 *
 * 覆盖「模型/面板写入规则 → 内核校验 → 重启 → 流量穿过 SOCKS」以及
 * 「内核拒绝新配置 → 规则回滚、旧配置继续跑」。没有 xray 时跳过。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeHost } from './fake-host.mjs'
import { check, checkEqual, finish } from './helpers.mjs'
import { localSubprocess } from './local-subprocess.mjs'
import { curlThroughSocks, echoServer, findOnPath, freePorts } from './net-utils.mjs'

const xrayBinary = findOnPath('xray')

if (xrayBinary === null) {
  console.log('e2e: 跳过（PATH 上没有 xray；可用 XRAY_BIN 指定）')
  finish('e2e')
} else {
  const home = mkdtempSync(join(tmpdir(), 'dsh-proxy-e2e-'))
  // 运行时目录指向临时目录，别碰用户的 ~/.dsh。
  process.env.DSH_HOME = home
  const { apply } = await import('../index.ts')
  const host = createFakeHost({ subprocess: localSubprocess() })
  const [socksPort, httpPort] = await freePorts(2)
  await apply(host.ctx, { coreBinary: xrayBinary, socksPort, httpPort })
  const { call, tools } = host

  const target = await echoServer('hello-from-e2e')
  try {
    console.log('e2e: 装配与节点')

    const initial = await call('GET', '/state')
    checkEqual(initial.status, 200, '/state 可用')
    checkEqual(initial.json.status.core.binarySource, 'config', '内核二进制来自配置')
    checkEqual(initial.json.status.core.state, 'stopped', '初始未运行')

    const subscription = await call('POST', '/subscription', {
      text: 'vless://11111111-2222-3333-4444-555555555555@127.0.0.1:443?security=tls&sni=example.com#e2e-node',
      name: 'e2e',
    })
    checkEqual(subscription.json.added, 1, '订阅导入一个节点')
    const afterImport = await call('GET', '/state')
    check(afterImport.json.nodes.selectedNode !== null, '导入后自动选中节点')
    checkEqual(afterImport.json.nodes.nodes[0]?.tag, 'e2e-node', '节点 tag 来自名字')

    console.log('e2e: 写规则并应用')

    const written = await call('POST', '/write', {
      mode: 'replace',
      routing: {
        default: 'direct',
        rules: [
          { id: 'ads', match: { domain: ['geosite:category-ads-all'] }, out: 'block' },
          { id: 'corp', match: { domain: ['domain:corp.example'] }, out: 'proxy' },
        ],
      },
      reason: 'e2e',
    })
    checkEqual(written.status, 200, '/write 返回 200')
    checkEqual(written.json.saved, true, '规则已保存')
    checkEqual(written.json.applied, true, '规则已应用到真实内核')

    const running = await call('GET', '/state')
    checkEqual(running.json.status.core.state, 'running', '内核在运行')
    checkEqual(running.json.routing.rules.map((rule) => rule.id), ['ads', 'corp'], '规则读回')
    checkEqual(await curlThroughSocks(socksPort, target.port), 'hello-from-e2e', '流量穿过内核到达本机服务')

    console.log('e2e: 内核拒绝后回滚')

    const broken = await call('POST', '/write', {
      mode: 'replace',
      routing: {
        default: 'direct',
        rules: [{ id: 'ext', match: { domain: ['ext:__missing_for_e2e__.dat:tag'] }, out: 'direct' }],
      },
      reason: 'e2e 回滚',
    })
    checkEqual(broken.status, 200, '拒绝也是一次正常响应')
    checkEqual(broken.json.saved, false, '内核拒绝时规则不落盘')
    checkEqual(broken.json.applied, false, '内核拒绝时不标记已应用')
    check(broken.json.message.includes('回滚'), '消息说明规则已回滚')

    const rolledBack = await call('GET', '/state')
    checkEqual(rolledBack.json.routing.rules.map((rule) => rule.id), ['ads', 'corp'], '规则回滚到上一份')
    checkEqual(rolledBack.json.status.core.state, 'running', '内核仍在运行')
    checkEqual(await curlThroughSocks(socksPort, target.port), 'hello-from-e2e', '回滚后流量仍然可用')

    console.log('e2e: 工具与内核动作')

    const statusTool = tools.get('proxy_status')
    const status = await statusTool.execute({})
    checkEqual(status.ruleCount, 2, 'proxy_status 读到规则数')
    checkEqual(status.core.running, true, 'proxy_status 看到内核在跑')

    const stopped = await call('POST', '/core', { action: 'stop' })
    checkEqual(stopped.json.ok, true, '停止内核')
    checkEqual(stopped.json.status.state, 'stopped', '停止后状态为 stopped')
  } finally {
    await target.close()
    for (const dispose of host.disposers.reverse()) {
      try {
        await dispose()
      } catch (error) {
        console.error(`  ✗ 清理时出错：${error.message}`)
      }
    }
    rmSync(home, { recursive: true, force: true })
  }

  finish('e2e')
}
