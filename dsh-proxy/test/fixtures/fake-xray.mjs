#!/usr/bin/env node
/**
 * 测试用的假内核：只模拟插件依赖的 CLI 契约 —— `version`、`-test -config`、
 * 监听入站端口的常驻进程。配置里可用顶层 `__fake` 控制行为：
 *
 *   "__fake": { "failTest": true }   → -test 退出码 1
 *   "__fake": { "failStart": true }  → 启动时退出码 1（-test 仍通过）
 *
 * 用来覆盖「-test 通过但启动失败 → 回滚」这条真实 xray 很难稳定制造的分支。
 */

import { readFileSync } from 'node:fs'
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
