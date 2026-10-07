/**
 * dsh-ui-chat-verbose-fold 行为测试的共享装置:断言与失败计数、模式策略夹具、活的
 * presentation source、ui-chat 形状的注册项、极简 slots 注册表,以及定位
 * `lib/client.js` 用的包根路径。
 *
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CHAT_VIEW_ID, CHAT_VIEW_SLOT } from '../src/policy-fold.ts'
import { MISSING_PROBE_ATTEMPTS, MISSING_PROBE_MS } from '../src/client.ts'

/** 本插件的包根目录(测试文件在 test/ 下,所以是上一级)。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export { CHAT_VIEW_ID, CHAT_VIEW_SLOT, MISSING_PROBE_ATTEMPTS, MISSING_PROBE_MS }

let failures = 0

export function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

export function checkTrue(label, actual) {
  const ok = actual === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 true,实得 ${JSON.stringify(actual)}`}`)
}

/** 在 `run` 执行期间捕获 console.warn。 */
export function captureWarnings(run) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args[0])
  try {
    run()
  } finally {
    console.warn = original
  }
  return warnings
}

/** 打印本文件的结论并设置退出码。每个测试文件末尾调用一次。 */
export function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/** 等待若干毫秒:自检窗口的测试用它等真实定时器跑完。 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 轮询等到 `predicate` 为真(或超时):自检窗口的告警由定时器异步发出。 */
export async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) return false
    await sleep(10)
  }
  return true
}

/** 自检窗口的总时长(毫秒),外加一点余量:等在窗口内排下的最后一拍跑完。 */
export function probeWindowMs() {
  return MISSING_PROBE_MS * MISSING_PROBE_ATTEMPTS + 300
}

/** 按模式返回全新的策略对象(verbose 初始不折叠)。 */
export function policyFor(mode) {
  const table = {
    compact: { mode: 'compact', foldCompletedTurns: false, stepGrouping: 'collapsed' },
    standard: { mode: 'standard', foldCompletedTurns: true, stepGrouping: 'collapsed' },
    detailed: { mode: 'detailed', foldCompletedTurns: true, stepGrouping: 'history' },
    verbose: { mode: 'verbose', foldCompletedTurns: false, stepGrouping: 'none' },
  }
  return { ...table[mode] }
}

/** 可切换 mode 的实时 presentation source。 */
export function makeSource(initialMode) {
  let mode = initialMode
  const listeners = new Set()
  const source = {
    getSnapshot() {
      return policyFor(mode)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    source,
    listeners,
    setMode(next) {
      mode = next
    },
  }
}

/** 一个 ui-chat 形状的视图注册项,携带给定的 presentation source。 */
export function chatEntry(source) {
  return {
    options: { id: CHAT_VIEW_ID },
    inject: () => ({ hooks: { presentation: source }, openFile: () => {} }),
  }
}

/** 极简 slots 注册表:entries 查询 + 变化广播,不做声明等待。 */
export class FakeSlots {
  constructor(entries) {
    this.list = entries
    this.listeners = new Set()
    this.injected = []
    this.entriesThrows = false
  }
  entries(key) {
    if (this.entriesThrows) throw new Error('entries boom')
    if (key !== CHAT_VIEW_SLOT) return []
    return this.list
  }
  inject(key, callback) {
    this.injected.push(key)
    this.dispose = callback()
    return () => {}
  }
  subscribe(key, listener) {
    if (key !== CHAT_VIEW_SLOT) return () => {}
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  register(next) {
    this.list = [...this.list, next]
    for (const listener of [...this.listeners]) listener()
  }
  listenerCount() {
    return this.listeners.size
  }
}
