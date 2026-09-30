/**
 * dsh-header-action-order 行为测试的共享装置。
 *
 * 这里只放与"测什么"无关的东西:断言与失败计数、上游注册项夹具、
 * 假 slots,以及包根路径常量。各测试文件按主题分组(A–C),各自 import
 * 本模块并独立运行:
 *
 *   node test/order-plan.test.mjs
 *
 * 跑全部请用 `node test/run-all.mjs`(或 pnpm test)。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { HEADER_ACTION_SLOT } from '../src/order.ts'
import { apply as applyPlugin } from '../src/client.ts'

/** 本插件的包根目录(测试文件在 test/ 下,所以是上一级)。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- 断言

let failures = 0

/** 已失败的断言数,供测试文件自行判断。 */
export function failureCount() {
  return failures
}

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

/** 收集 console.warn,同时把原文打出来,便于人工核对诊断文本。 */
export function captureWarnings(run) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
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

export function entry(id, order) {
  return { options: { id, order } }
}

export function upstreamEntries() {
  return [
    entry('agent-preset', -10),
    entry('schedule-catalog', 10),
    entry('job-list', 20),
    entry('agent-team', 20),
    entry('subagent-catalog', 30),
  ]
}

export const EXPECTED = ['agent-preset', 'agent-team', 'subagent-catalog', 'schedule-catalog', 'job-list']

export function renderedOrder(entries) {
  return [...entries]
    .sort((a, b) => (a.options?.order ?? 0) - (b.options?.order ?? 0))
    .map((e) => e.options?.id)
}

// ---------------------------------------------------------------- 假 slots

export class FakeSlots {
  constructor(entries) {
    this.list = entries
    this.listeners = new Set()
    this.injected = []
    this.entriesThrows = false
  }
  entries(key) {
    if (this.entriesThrows) throw new Error('entries boom')
    if (key !== HEADER_ACTION_SLOT) return []
    return this.list
  }
  inject(key, callback) {
    this.injected.push(key)
    this.dispose = callback()
    return () => {}
  }
  subscribe(key, listener) {
    if (key !== HEADER_ACTION_SLOT) return () => {}
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  register(next) {
    this.list = [...this.list, next]
    for (const listener of [...this.listeners]) listener()
  }
  renderedOrder() {
    return renderedOrder(this.list)
  }
  listenerCount() {
    return this.listeners.size
  }
}

export { applyPlugin, HEADER_ACTION_SLOT }
