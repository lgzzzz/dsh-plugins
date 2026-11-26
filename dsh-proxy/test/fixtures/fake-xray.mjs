#!/usr/bin/env node
/**
 * 测试用的假内核：只模拟插件依赖的 CLI 契约 —— `version`、`-test -config`、
 * 监听入站端口的常驻进程。配置里可用顶层 `__fake` 控制行为：
 *
 *   "__fake": { "failTest": true }   → -test 退出码 1
 *   "__fake": { "failStart": true }  → 启动时退出码 1（-test 仍通过）
 *   "__fake": { "accessLine": "…" }  → 写进 `log.access` 的访问日志行（默认一条直连）
 *
 * 配置了 `log.access` 时，正常启动会追加一行访问日志，用来验证插件的文件尾随；
 * 真实 xray 的访问日志格式见 src/access.ts 顶部注释。
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'

const argv = process.argv.slice(2)

if (argv.includes('version')) {
  console.log('Xray 0.0.0-fake (fake xray for dsh-proxy tests)')
  process.exit(0)
}

const configIndex = argv.indexOf('-config')
if (configIndex === -1 || argv[configIndex + 1] === undefined) {
  console.error('fake xray: missing -config')
  process.exit(2)
}

const config = JSON.parse(readFileSync(argv[configIndex + 1], 'utf8'))
const fake = typeof config.__fake === 'object' && config.__fake !== null ? config.__fake : {}
const testing = argv.includes('-test')

if (testing) {
  if (fake.failTest === true) {
    console.error(`fake xray: configuration rejected (${fake.reason ?? 'synthetic test failure'})`)
    process.exit(1)
  }
  console.log('Configuration OK.')
  process.exit(0)
}

if (fake.failStart === true) {
  console.error(`fake xray: failed to start (${fake.reason ?? 'synthetic start failure'})`)
  process.exit(1)
}

// 访问日志：插件按 `log.access` 尾随这个文件。
if (typeof config.log === 'object' && config.log !== null && typeof config.log.access === 'string' && config.log.access !== '') {
  const rules = Array.isArray(config.routing?.rules) ? config.routing.rules : []
  const outboundTag = rules[rules.length - 1]?.outboundTag ?? 'direct'
  const line = typeof fake.accessLine === 'string'
    ? fake.accessLine
    : `2026/01/01 00:00:00.000000 from tcp:127.0.0.1:2 accepted tcp:example.com:443 [socks -> ${outboundTag}]`
  try {
    appendFileSync(config.log.access, `${line}\n`)
  } catch (error) {
    console.error(`fake xray: 写访问日志失败：${error.message}`)
  }
}

const ports = Array.isArray(config.inbounds)
  ? config.inbounds.map((inbound) => inbound.port).filter((port) => Number.isInteger(port))
  : []
const servers = ports.map((port) => createServer((socket) => socket.destroy()).listen(port, '127.0.0.1'))
console.log(`fake xray: listening on ${ports.join(', ')}`)

const stop = () => {
  for (const server of servers) server.close()
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
