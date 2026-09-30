/**
 * dsh-ui-chat-verbose-fold 行为测试的共享装置。
 *
 * 这里只放与"测什么"无关的东西:断言与失败计数、模式策略夹具、活的
 * presentation source、ui-chat 形状的注册项、极简 slots 注册表,以及定位
 * `lib/client.js` 用的包根路径。各测试文件按主题分组(A–C),各自 import
 * 本模块并独立运行:
 *
 *   node test/projection.test.mjs
 *
 * 跑全部请用 `node test/run-all.mjs`(或 pnpm test)。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CHAT_VIEW_ID, CHAT_VIEW_SLOT } from '../src/policy-fold.ts'

/** 本插件的包根目录(测试文件在 test/ 下,所以是上一级)。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export { CHAT_VIEW_ID, CHAT_VIEW_SLOT }

// ---------------------------------------------------------------- 断言

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

/** Capture console.warn for the duration of `run`. */
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

// ---------------------------------------------------------------- 夹具

/** Fresh policy objects per mode, mirroring upstream's table (verbose starts open). */
export function policyFor(mode) {
  const table = {
    compact: { mode: 'compact', foldCompletedTurns: false, stepGrouping: 'collapsed' },
    standard: { mode: 'standard', foldCompletedTurns: true, stepGrouping: 'collapsed' },
    detailed: { mode: 'detailed', foldCompletedTurns: true, stepGrouping: 'history' },
    verbose: { mode: 'verbose', foldCompletedTurns: false, stepGrouping: 'none' },
  }
  return { ...table[mode] }
}

/** A live presentation source whose mode can be flipped between reads. */
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

/** One ui-chat-shaped view entry carrying the given presentation source. */
export function chatEntry(source) {
  return {
    options: { id: CHAT_VIEW_ID },
    inject: () => ({ hooks: { presentation: source }, openFile: () => {} }),
  }
}

/** Minimal slots registry: no declaration wait, entries + change fan-out. */
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
