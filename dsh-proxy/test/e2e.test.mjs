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
import { curlThroughSocks, curlThroughSocksHost, echoServer, findOnPath, freePorts } from './net-utils.mjs'

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

    console.log('e2e: 访问日志记录实际出口')

    let traffic = await call('GET', '/traffic?host=127.0.0.1&limit=20')
    for (let attempt = 0; attempt < 40 && traffic.json.entries.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      traffic = await call('GET', '/traffic?host=127.0.0.1&limit=20')
    }
    checkEqual(traffic.status, 200, '/traffic 返回 200')
    checkEqual(traffic.json.live, true, '内核运行时访问日志 live')
    check(traffic.json.entries.length >= 1, '访问日志里有一条经 SOCKS 的连接')
    checkEqual(traffic.json.entries[0]?.host, '127.0.0.1', '记录的目的地址')
    checkEqual(traffic.json.entries[0]?.inbound, 'socks', '记录的入站 tag')
    checkEqual(traffic.json.entries[0]?.out, 'direct', '记录的实际出口')
    checkEqual(traffic.json.entries[0]?.verdict, 'direct', '记录归一化为直连')
    check(traffic.json.summary.matched >= 1, '汇总统计到命中项')

    const trafficTool = tools.get('proxy_traffic_read')
    const toolTraffic = await trafficTool.execute({ host: '127.0.0.1' })
    check(toolTraffic.summary.matched >= 1, 'proxy_traffic_read 读到同一条连接')
    checkEqual(toolTraffic.entries[0]?.out, 'direct', '工具返回的出口一致')

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

    console.log('e2e: 走 proxy 出口的连接')

    const proxied = await call('POST', '/write', {
      mode: 'replace',
      routing: { default: 'proxy', rules: [] },
      reason: 'e2e 走 proxy 出口',
    })
    checkEqual(proxied.json.applied, true, '切到默认 proxy 出口并应用')
    try {
      // 目的用域名：目标 IP 是 127.0.0.1 时会命中「代理服务器自身地址 → direct」的防环规则。
      await curlThroughSocksHost(socksPort, 'localhost', target.port)
    } catch {
      // 假节点不可达：curl 失败是预期结果，访问日志仍会在接受连接时写一行。
    }
    let proxyTraffic = await call('GET', '/traffic?verdict=proxy&limit=20')
    for (let attempt = 0; attempt < 40 && proxyTraffic.json.entries.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      proxyTraffic = await call('GET', '/traffic?verdict=proxy&limit=20')
    }
    check(proxyTraffic.json.entries.length >= 1, '访问日志记录到发往 proxy 出口的连接')
    checkEqual(proxyTraffic.json.entries[0]?.host, 'localhost', '记录的目的域名')
    checkEqual(proxyTraffic.json.entries[0]?.out, 'proxy', '实际出口 tag 是 proxy')
    checkEqual(proxyTraffic.json.entries[0]?.outLabel, 'e2e-node', 'proxy 出口显示入队时快照的节点名')

    const stopped = await call('POST', '/core', { action: 'stop' })
    checkEqual(stopped.json.ok, true, '停止内核')
    checkEqual(stopped.json.status.state, 'stopped', '停止后状态为 stopped')

    const afterStop = await call('GET', '/traffic')
    checkEqual(afterStop.json.live, false, '停止后访问日志不再 live')
    check(afterStop.json.entries.length > 0, '停止后仍能看本次会话的历史记录')
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
