/**
 * 插件加载后自动启动内核：用假内核验证「有节点才启动」、`autoStart: false`、
 * 二进制缺失、端口被占用与卸载时停进程，不需要真实 xray。
 *
 * 存储用跨多次 `open()` 复用的替身（`createFakeStorageDomain`），模拟插件重载后
 * 节点与选中状态仍在；每次 `apply()` 都是一次「插件重新加载」。
 */

import { chmodSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probePort } from '../src/core.ts'
import { createFakeHost, createFakeStorageDomain } from './fake-host.mjs'
import { check, checkEqual, finish } from './helpers.mjs'
import { localSubprocess } from './local-subprocess.mjs'
import { freePorts } from './net-utils.mjs'

const home = mkdtempSync(join(tmpdir(), 'dsh-proxy-autostart-'))
process.env.DSH_HOME = home

// 假内核的 CLI 契约与 core.test.mjs 一致：`version`、`-test`、监听入站端口。
const fakeBinary = join(home, 'fake-xray')
copyFileSync(new URL('./fixtures/fake-xray.mjs', import.meta.url), fakeBinary)
chmodSync(fakeBinary, 0o755)

const { apply } = await import('../index.ts')
const storageDomain = createFakeStorageDomain()
const [socksPort, httpPort] = await freePorts(2)
const baseConfig = { coreBinary: fakeBinary, socksPort, httpPort, accessLog: false }
const subscription = 'vless://11111111-2222-3333-4444-555555555555@127.0.0.1:443?security=tls&sni=example.com#auto-node'

const hosts = []
const unloaded = new Set()

/** 建一套宿主并加载插件。 */
async function load(config) {
  const host = createFakeHost({ subprocess: localSubprocess(), storageDomain })
  hosts.push(host)
  await apply(host.ctx, config)
  return host
}

/** 卸载一套宿主：逆序执行 disposer，先停内核再关存储。 */
async function unload(host) {
  if (unloaded.has(host)) return
  unloaded.add(host)
  for (const dispose of host.disposers.reverse()) {
    try {
      await dispose()
    } catch (error) {
      console.error(`  ✗ 清理时出错：${error.message}`)
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 轮询等待，超时返回 false。 */
async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await sleep(50)
  }
  return false
}

/** 等到日志里出现某段文字。 */
async function waitForLog(host, needle, timeoutMs = 5000) {
  return await waitFor(async () => {
    const logs = await host.call('GET', '/logs?limit=500')
    return logs.json.lines.some((line) => line.text.includes(needle))
  }, timeoutMs)
}

/** 等到端口不再被监听。 */
async function waitForPortClosed(port, timeoutMs = 3000) {
  return await waitFor(async () => !(await probePort(port)), timeoutMs)
}

try {
  console.log('autostart: 没有选中节点时不启动')

  const first = await load(baseConfig)
  check(await waitForLog(first, '自动启动跳过：还没有选中节点'), '日志说明跳过的原因')
  checkEqual((await first.call('GET', '/state')).json.status.core.state, 'stopped', '内核保持 stopped')
  checkEqual(await probePort(socksPort), false, '没有进程监听 socks 端口')

  const imported = await first.call('POST', '/subscription', { text: subscription, name: 'auto' })
  checkEqual(imported.json.added, 1, '导入订阅并自动选中节点')
  checkEqual((await first.call('GET', '/state')).json.status.core.state, 'stopped', '导入节点不会临时拉起内核')

  await unload(first)
  checkEqual(await probePort(socksPort), false, '卸载后仍没有内核在跑')

  console.log('autostart: 重新加载后有节点就自动启动')

  const second = await load(baseConfig)
  const started = await waitFor(async () => (await second.call('GET', '/state')).json.status.core.state === 'running', 8000)
  check(started, '插件加载后自动启动内核')
  const running = (await second.call('GET', '/state')).json
  checkEqual(running.status.core.state, 'running', '状态为 running')
  checkEqual(running.status.core.binarySource, 'config', '用的是配置指定的内核')
  checkEqual(await probePort(socksPort), true, 'SOCKS 端口已就绪')
  checkEqual(await probePort(httpPort), true, 'HTTP 端口已就绪')

  await unload(second)
  check(await waitForPortClosed(socksPort), '卸载后内核进程被停掉')

  console.log('autostart: autoStart: false 保持手动启动')

  const third = await load({ ...baseConfig, autoStart: false })
  check(await waitForLog(third, '自动启动已关闭（autoStart: false）'), '日志说明自动启动被关闭')
  await sleep(200)
  checkEqual((await third.call('GET', '/state')).json.status.core.state, 'stopped', '显式关闭后不启动')
  checkEqual(await probePort(socksPort), false, '端口没有被占用')
  await unload(third)

  console.log('autostart: 二进制缺失只记日志')

  const fourth = await load({ ...baseConfig, coreBinary: join(home, 'no-such-xray') })
  check(await waitForLog(fourth, '自动启动失败'), '启动失败写进日志')
  const failed = (await fourth.call('GET', '/state')).json
  checkEqual(failed.status.core.state, 'error', '状态转 error')
  check(typeof failed.status.core.lastError === 'string' && failed.status.core.lastError.length > 0, '状态里保留失败原因')
  await unload(fourth)

  console.log('autostart: 端口被占用时给明确原因')

  const blocker = createNetServer((socket) => socket.destroy())
  await new Promise((resolve) => blocker.listen(socksPort, '127.0.0.1', resolve))
  try {
    const fifth = await load(baseConfig)
    check(await waitForLog(fifth, '端口已被占用'), '日志点名端口被占用')
    const busy = (await fifth.call('GET', '/state')).json
    checkEqual(busy.status.core.state, 'error', '端口冲突时状态为 error')
    check(busy.status.core.lastError.includes('socks'), '错误信息点名 socks 端口')
    await unload(fifth)
  } finally {
    await new Promise((resolve) => blocker.close(resolve))
  }

  console.log('autostart: 加载后立刻卸载不残留内核')

  const sixth = await load(baseConfig)
  await unload(sixth)
  // 给启动流程留出「本来会拉起内核」的时间，再确认端口始终是关的。
  await sleep(800)
  check(await waitForPortClosed(socksPort, 1000), '卸载后端口保持关闭，启动流程不会在卸载后拉起内核')
} finally {
  for (const host of hosts.reverse()) await unload(host)
  rmSync(home, { recursive: true, force: true })
}

finish('autostart')
