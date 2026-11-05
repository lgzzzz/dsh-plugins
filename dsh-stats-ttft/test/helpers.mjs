/**
 * dsh-stats-ttft 行为测试的共享装置：断言与失败计数、假 slots 账本、以及构建产物加载器。
 *
 * 跑全部请用 `node test/run-all.mjs`（或 pnpm test）。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { STATS_ID, STATS_SLOT } from '../src/shadow.ts'

/** 本插件的包根目录（测试文件在 test/ 下，所以是上一级）。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 产物 factory 的 `require`：平台模块表在本仓库的替身就是根 node_modules。 */
export const platformRequire = createRequire(import.meta.url)

export { STATS_ID, STATS_SLOT }

let failures = 0

/** 已失败的断言数。 */
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

export function checkFalse(label, actual) {
  const ok = actual === false
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 false,实得 ${JSON.stringify(actual)}`}`)
}

/** 对象同一性断言（函数与条目对象用）。 */
export function checkSame(label, actual, expected) {
  const ok = Object.is(actual, expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ' — 期望同一个对象'}`)
}

/** 字符串包含断言。 */
export function checkIncludes(label, actual, expected) {
  const ok = typeof actual === 'string' && actual.includes(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望包含 ${JSON.stringify(expected)},实得 ${JSON.stringify(actual)}`}`)
}

/** 打印本文件的结论并设置退出码。每个测试文件末尾调用一次。 */
export function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/**
 * 假 slots 注册表：镜像本插件依赖的那部分真实语义。
 *
 * 关键的一条是 `register` 的同格冲突判定——真实 `SlotCore.register` 在 list 槽里对**同 id
 * 同 priority** 的注册直接抛错（「register at a different priority to shadow it」），所以
 * 本替身也抛，于是测试能证明遮蔽项的 priority 确实与源项不同。
 *
 * `inject` 只登记回调（真实语义是等槽位声明），由测试调用 `declare()` 模拟声明落地。
 */
export class FakeSlots {
  constructor() {
    this.entriesByKey = new Map()
    this.subscribers = []
    this.registrations = []
    this.injections = []
    this.registerError = null
  }

  entries(key) {
    return this.entriesByKey.get(key) ?? []
  }

  /** 覆盖某个槽的账本内容并通知订阅者。 */
  setEntries(key, entries) {
    this.entriesByKey.set(key, entries)
    this.notify(key)
  }

  register(options, component) {
    if (this.registerError !== null) throw this.registerError
    const list = this.entries(options.name)
    const clash = list.find(
      (entry) => entry.options?.id === options.id && (entry.options?.priority ?? 0) === (options.priority ?? 0),
    )
    if (clash !== undefined) throw new Error(`duplicate registration ${options.name}#${options.id}`)
    const entry = { component, options: { ...options } }
    this.entriesByKey.set(options.name, [...list, entry])
    this.registrations.push({ options, component, entry })
    this.notify(options.name)
    return () => {
      this.entriesByKey.set(options.name, this.entries(options.name).filter((item) => item !== entry))
      this.notify(options.name)
    }
  }

  subscribe(key, fn) {
    const record = { key, fn }
    this.subscribers.push(record)
    return () => {
      this.subscribers = this.subscribers.filter((item) => item !== record)
    }
  }

  inject(key, callback) {
    this.injections.push({ key, callback })
  }

  /** 模拟槽位声明落地：运行已登记的 inject 回调，登记它们的撤销函数。 */
  declare() {
    const disposers = []
    for (const injection of this.injections) {
      const disposer = injection.callback()
      if (typeof disposer === 'function') disposers.push(disposer)
    }
    return () => {
      for (const disposer of disposers) disposer()
    }
  }

  notify(key) {
    for (const subscriber of [...this.subscribers]) {
      if (subscriber.key === key) subscriber.fn()
    }
  }
}

/** 以假 `window.__ModuleLoader__` 载入构建产物，返回注册对象。 */
export function loadClientArtifact() {
  let registration = null
  const previous = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load: (value) => {
        registration = value
      },
    },
  }
  try {
    // eslint-disable-next-line no-eval
    ;(0, eval)(readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8'))
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
  return registration
}
