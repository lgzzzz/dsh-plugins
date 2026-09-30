/**
 * dsh-focus-free-shortcuts 行为测试的共享装置。
 *
 * 这里只放与"测什么"无关的东西:断言与失败计数、假输入 / 假 DOM / 假服务,
 * 以及把 `src/client.ts` 装进假 Cordis 上下文的 harness。各测试文件按主题
 * 分组(A–G),各自 import 本模块并独立运行:
 *
 *   node test/decide-binding.test.mjs
 *
 * 跑全部请用 `node test/run-all.mjs`(或 pnpm test)。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 打印本文件的结论并设置退出码。每个测试文件末尾调用一次。 */
export function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

// ---------------------------------------------------------------- 假输入

export function gesture(code, overrides = {}) {
  return {
    code,
    secondCode: undefined,
    control: false,
    alt: false,
    shift: false,
    meta: false,
    repeat: false,
    composing: false,
    defaultPrevented: false,
    ...overrides,
  }
}
export function shortcutContext(overrides = {}) {
  return { modal: null, region: 'page', target: null, ...overrides }
}
/** 一个 keydown 固定输入 + 它的消费计数。 */
export function keydown(gestureValue, contextValue) {
  const consumed = { count: 0 }
  return {
    consumed,
    input: {
      type: 'keydown',
      gesture: gestureValue,
      context: contextValue,
      consume: () => {
        consumed.count += 1
      },
    },
  }
}
export function row(id, binding, extra = {}) {
  return { id, binding, issue: null, conflicts: [], ...extra }
}

export const FULLSCREEN_BINDING = { code: 'Enter', modifiers: ['alt', 'meta'] }
export const SPLIT_BINDING = { code: 'Backslash', modifiers: ['meta'] }
export const PANE_IDS = { fullscreen: 'pane.fullscreen.toggle', split: 'pane.split' }
export const FULLSCREEN_PRESS = gesture('Enter', { alt: true, meta: true })
export const SPLIT_PRESS = gesture('Backslash', { meta: true })

// ---------------------------------------------------------------- 假 DOM

export class FakeNode {
  constructor(tag = 'div', attrs = []) {
    this.tag = tag
    this.attrs = new Set(attrs)
    this.parent = null
    this.children = []
  }
  append(child) {
    child.parent = this
    this.children.push(child)
    return child
  }
  closest(selector) {
    for (let node = this; node !== null; node = node.parent) {
      for (const part of selector.split(',')) {
        if (matchesSelector(node, part.trim())) return node
      }
    }
    return null
  }
  contains(other) {
    for (let node = other; node !== null && node !== undefined; node = node.parent) {
      if (node === this) return true
    }
    return false
  }
}
/** 只支持 `[attr]` / `[attr="value"]` / 裸标签名,够本插件用到的那几个选择器。 */
function matchesSelector(node, selector) {
  const attribute = /^\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/.exec(selector)
  if (attribute !== null) return node.attrs.has(attribute[1])
  return node.tag === selector
}

export const domBody = new FakeNode('body')
export const domSession = domBody.append(new FakeNode('div', ['data-conversation-session']))
export const domRegion = domSession.append(new FakeNode('div', ['data-conversation-region']))
export const domComposer = domRegion.append(new FakeNode('textarea'))
export const domApproval = domRegion.append(new FakeNode('div', ['data-approval-key']))
export const domFrame = domRegion.append(new FakeNode('iframe'))
export const domInert = domRegion.append(new FakeNode('div', ['inert']))
export const domLooseRegion = domBody.append(new FakeNode('div', ['data-conversation-region']))

// ---------------------------------------------------------------- 假服务

export function fakeShortcuts({ runtime = 'web', platform = 'macos', rows = [], stopSequenceMs = 500 } = {}) {
  const listeners = new Set()
  return {
    runtime,
    platform,
    stopSequenceMs,
    catalog: { getSnapshot: () => rows },
    fixedCatalog: { getSnapshot: () => [] },
    observeFixedInput(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(input) {
      for (const listener of [...listeners]) listener(input)
    },
    listenerCount: () => listeners.size,
  }
}

export function fakeSidebar() {
  const sidebar = {
    focused: undefined,
    command: undefined,
    expanded: true,
    current: true,
    calls: [],
    focusedTarget: () => sidebar.focused,
    commandTarget: () => sidebar.command,
    isExpanded: () => sidebar.expanded,
    isTargetCurrent: () => sidebar.current,
    toggleFullscreen: (target) => sidebar.calls.push(['fullscreen', target]),
    split: (paneId) => {
      sidebar.calls.push(['split', paneId])
      return 'new-pane'
    },
  }
  return sidebar
}

export function fakeSessions({ summary = {}, bindingSnapshot = {}, scope } = {}) {
  const binding = {
    session: {
      getSnapshot: () => ({
        running: true,
        removed: false,
        subagent: null,
        ...bindingSnapshot,
      }),
    },
  }
  const sessions = {
    list: {
      getSnapshot: () => ({
        ids: Object.keys(summary),
        byId: summary,
        phase: 'ready',
        projectionsBySession: {},
      }),
    },
    binding: (id) => (summary[id] === undefined ? undefined : binding),
    scope: (id) => (scope === undefined ? undefined : scope(id)),
    bindingObject: binding,
  }
  return sessions
}

export function session(id, { mainView = 1, running = true } = {}) {
  return { id, running, retainedBy: mainView > 0 ? { mainView } : {} }
}

export class FakeCtx {
  constructor(services) {
    this.services = services
    this.effects = []
  }
  get(name) {
    return this.services[name]
  }
  inject(deps, callback) {
    if (deps.some((name) => this.services[name] === undefined)) return undefined
    const scope = {
      get: (name) => this.services[name],
      effect: (execute, label) => {
        const dispose = execute()
        this.effects.push({ label, dispose })
        return { dispose }
      },
    }
    for (const [key, value] of Object.entries(this.services)) scope[key] = value
    callback(scope)
    return scope
  }
}

/** 装配一次性完整场景,返回各部件与已注册的固定输入监听。 */
export function harness({
  runtime = 'web',
  rows = [row('pane.fullscreen.toggle', FULLSCREEN_BINDING), row('pane.split', SPLIT_BINDING)],
  summary = { s1: session('s1') },
  bindingSnapshot = {},
  sidebar = fakeSidebar(),
  conversation = { cancel: () => Promise.resolve() },
  uiSession,
  withSidebar = true,
  withSessions = true,
} = {}) {
  const shortcuts = fakeShortcuts({ runtime, rows })
  const sessions = fakeSessions({ summary, bindingSnapshot, scope: () => ({ get: (name) => (name === 'conversation' ? conversation ?? undefined : undefined) }) })
  const services = { shortcuts }
  if (withSidebar) services.sidebarRight = sidebar
  if (withSessions) services.sessions = sessions
  if (uiSession !== undefined) services.uiSession = uiSession
  const ctx = new FakeCtx(services)
  const warnings = captureWarnings(() => applyPlugin(ctx))
  return { ctx, shortcuts, sessions, sidebar, conversation, warnings }
}

export { applyPlugin }
