/**
 * dsh-changes-hover-off 行为测试的共享装置:断言与失败计数、假元素 / 假文档 / 假事件,
 * 以及产物加载器。
 *
 * 跑全部请用 `node test/run-all.mjs`(或 pnpm test)。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CARD_SELECTOR, HOVER_GESTURES, MARKER_ATTRIBUTE, PREVIEW_ATTRIBUTE } from '../src/hover-gate.ts'

/** 本插件的包根目录(测试文件在 test/ 下,所以是上一级)。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export { CARD_SELECTOR, HOVER_GESTURES, MARKER_ATTRIBUTE, PREVIEW_ATTRIBUTE }

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

/** 打印本文件的结论并设置退出码。每个测试文件末尾调用一次。 */
export function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/** 只对给定选择器 `closest` 命中的假元素(镜像上游捕获层的鸭子类型判定)。 */
export function element(selectors, label = 'element') {
  return {
    label,
    closest(selector) {
      return selectors.includes(selector) ? { selector } : null
    },
  }
}

/** 改动文件卡片内的手势目标。 */
export function cardTarget() {
  return element([CARD_SELECTOR], 'card-target')
}

/** 改动文件卡片外的手势目标(右栏 review tab 这类同族但不同锚点的区域)。 */
export function outsideTarget() {
  return element(['[data-changes-review]'], 'outside-target')
}

/** 文档根元素的假替身:记录 data-* 标记。 */
export class FakeRootElement {
  constructor() {
    this.attributes = new Map()
  }

  setAttribute(name, value) {
    this.attributes.set(name, value)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  /** 读取标记值;未设置时返回 null。 */
  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }
}

/** 记录 observe / disconnect 与回调的假 MutationObserver。 */
export class FakeObserver {
  static instances = []

  constructor(callback) {
    this.callback = callback
    this.observed = []
    this.disconnected = false
    FakeObserver.instances.push(this)
  }

  observe(target, options) {
    this.observed.push({ target, options })
  }

  disconnect() {
    this.disconnected = true
  }

  /** 把一批变更记录交给回调。 */
  emit(records) {
    this.callback(records)
  }

  /** 最近一个实例。 */
  static last() {
    return FakeObserver.instances[FakeObserver.instances.length - 1]
  }

  /** 清空实例登记(每个用例开始前调用)。 */
  static reset() {
    FakeObserver.instances = []
  }
}

/** portal 外壳的假替身:`marker` 决定标记挂在自己身上、后代身上还是没有。 */
export function shellElement(marker = 'child', label = 'shell') {
  return {
    label,
    style: { display: '' },
    matches: (selector) => marker === 'self' && selector === `[${PREVIEW_ATTRIBUTE}]`,
    querySelector: (selector) => (marker !== 'none' && selector === `[${PREVIEW_ATTRIBUTE}]` ? { tag: 'preview' } : null),
  }
}

/** 与浮层无关的普通节点。 */
export function plainNode(label = 'plain') {
  return { label, style: { display: '' } }
}

/** 记录捕获监听、根标记与 body 的假文档。 */
export class FakeDocument {
  constructor(options = {}) {
    this.listeners = new Map()
    this.documentElement = new FakeRootElement()
    this.body = options.withBody === false ? undefined : { tag: 'body' }
    this.defaultView = options.withObserver === false ? {} : { MutationObserver: FakeObserver }
  }

  addEventListener(type, listener, capture) {
    const list = this.listeners.get(type) ?? []
    list.push({ listener, capture })
    this.listeners.set(type, list)
  }

  removeEventListener(type, listener, capture) {
    const list = (this.listeners.get(type) ?? []).filter((item) => item.listener !== listener || item.capture !== capture)
    if (list.length === 0) this.listeners.delete(type)
    else this.listeners.set(type, list)
  }

  /** 只派发给捕获阶段监听器(闸门只用捕获阶段)。 */
  dispatch(type, event) {
    for (const item of this.listeners.get(type) ?? []) {
      if (item.capture === true) item.listener(event)
    }
  }

  /** 当前有监听的手势类型。 */
  get types() {
    return [...this.listeners.keys()]
  }
}

/** 假手势事件:可观测 `stopPropagation`。 */
export function hoverEvent(target, options = {}) {
  return {
    target,
    stopped: false,
    stopPropagation() {
      this.stopped = true
    },
    composedPath() {
      return options.path ?? [target]
    },
  }
}

/** 以假 `window.__ModuleLoader__` 载入构建产物,返回注册对象。 */
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
