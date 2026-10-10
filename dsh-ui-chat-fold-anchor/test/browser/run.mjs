#!/usr/bin/env node
// 浏览器实测：用 headless Chrome 打开 test/browser/fold-harness.html，跑完五组折叠场景并断言
// 「装了插件之后阅读位置不动」。需要本机有 Chrome；找不到时只告警并跳过（退出码 0），
// 与 check-css.mjs 找不到 DSH 根目录时的态度一致。
//
// 为什么要有这一层：本插件补偿的是浏览器绘制流程里的滚动位置，假 DOM 测不出真实时序，
// 只有真浏览器能证明「折叠前后锚点的视觉位置不变」。装置与结论见
// docs/dsh-ui-chat-fold-anchor/03-build-test-and-enable.md。
//
// 用法: node dsh-ui-chat-fold-anchor/test/browser/run.mjs [--chrome <path>]
// 退出码: 0 = 通过或跳过, 1 = 断言失败, 2 = 装置本身出错(页面没吐出结果)

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** 常见安装位置；`$CHROME` 与 `--chrome` 优先。 */
const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((value) => typeof value === 'string' && value !== '')

/** 调试端口；被占用时换下一个。 */
const PORTS = [9333, 9334, 9335]

/** 每组场景的断言：对照组建模「问题确实存在」，装插件后允许亚像素残差。 */
const EXPECTATIONS = [
  { label: 'control animated (no plugin)', min: -400, max: -300 },
  { label: 'control instant, no native anchoring (no plugin)', min: -400, max: -300 },
  { label: 'patched animated (plugin)', min: -30, max: 30 },
  { label: 'patched instant, no native anchoring (plugin)', min: -5, max: 5 },
  { label: 'patched instant, native anchoring on (plugin)', min: -5, max: 5 },
]

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--chrome') out.chrome = argv[++i]
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true
  }
  return out
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

/** 等待 Chrome 的调试端点就绪并返回 page target。 */
async function waitForPage(port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page !== undefined) return page
    } catch {
      // 还没起来：继续等。
    }
    await sleep(100)
  }
  return null
}

/** 一个够用的 CDP 客户端：连上 page target，发一条 Runtime.evaluate。 */
class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const waiter = this.pending.get(message.id)
      if (waiter === undefined) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    }
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolveOpen, rejectOpen) => {
      socket.onopen = resolveOpen
      socket.onerror = rejectOpen
    })
    return new Cdp(socket)
  }

  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('node dsh-ui-chat-fold-anchor/test/browser/run.mjs [--chrome <path>]')
    return 0
  }

  const chrome = args.chrome ?? CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
  if (chrome === undefined) {
    console.warn('[browser] 找不到 Chrome（可用 --chrome 或 $CHROME 指定）— 跳过实测')
    return 0
  }

  const harness = `file://${join(here, 'fold-harness.html')}`
  const profile = mkdtempSync(join(tmpdir(), 'dsh-fold-anchor-'))
  let child = null
  let cdp = null
  try {
    for (const port of PORTS) {
      const candidate = spawn(chrome, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
        '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
        `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, harness,
      ], { stdio: 'ignore' })
      const page = await waitForPage(port)
      if (page !== null) {
        child = candidate
        cdp = await Cdp.connect(page.webSocketDebuggerUrl)
        break
      }
      candidate.kill('SIGKILL')
    }
    if (cdp === null) {
      console.error('[browser] Chrome 的调试端口没起来 — 装置无法运行')
      return 2
    }

    await cdp.send('Runtime.enable')
    const evaluated = await cdp.send('Runtime.evaluate', { expression: 'window.__run()', awaitPromise: true, returnByValue: true })
    if (evaluated.exceptionDetails !== undefined) {
      console.error(`[browser] 装置抛错: ${evaluated.exceptionDetails.text}`)
      return 2
    }

    const results = JSON.parse(evaluated.result.value)
    let failures = 0
    for (const expectation of EXPECTATIONS) {
      const result = results.find((entry) => entry.label === expectation.label)
      if (result === undefined || typeof result.finalDelta !== 'number') {
        console.error(`✗  ${expectation.label}  —  没有拿到 finalDelta`)
        failures += 1
        continue
      }
      const ok = result.finalDelta >= expectation.min && result.finalDelta <= expectation.max
      if (!ok) failures += 1
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${expectation.label}  —  折叠 ${result.foldedHeight}px，锚点位移 ${result.finalDelta}px`)
    }
    console.log(failures === 0 ? '\n[browser] 全部通过' : `\n[browser] ${failures} 组失败`)
    return failures === 0 ? 0 : 1
  } finally {
    cdp?.socket.close()
    child?.kill('SIGKILL')
    rmSync(profile, { recursive: true, force: true })
  }
}

process.exitCode = await main()
