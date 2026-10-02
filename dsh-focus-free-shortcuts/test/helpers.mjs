/**
 * dsh-focus-free-shortcuts 行为测试的共享装置。
 *
 * 这里只放与"测什么"无关的东西:断言与失败计数、假输入 / 假 DOM / 假服务,
 * 以及把 `src/client.ts` 装进假 Cordis 上下文的 harness。各测试文件按主题
 * 分组(A–I),各自 import 本模块并独立运行:
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
/** 一条已挂载的固定行(只读快捷键):它存在本身就是它的键位预约。 */
export function fixedRow(id, bindings, extra = {}) {
  return { id, keys: [], bindings, group: 'approval', ...extra }
}

export const FULLSCREEN_BINDING = { code: 'Enter', modifiers: ['alt', 'meta'] }
export const SPLIT_BINDING = { code: 'Backslash', modifiers: ['meta'] }
export const PANE_IDS = { fullscreen: 'pane.fullscreen.toggle', split: 'pane.split' }
export const FULLSCREEN_PRESS = gesture('Enter', { alt: true, meta: true })
export const SPLIT_PRESS = gesture('Backslash', { meta: true })

export const APPROVAL_IDS = { allow: 'approval.allow', reject: 'approval.reject' }
export const APPROVAL_ALLOW_BINDING = { code: 'Enter', modifiers: [] }
export const APPROVAL_REJECT_BINDING = { code: 'Escape', modifiers: [] }
/** ui-approval 挂载时真实预约的两条固定行。 */
export const APPROVAL_FIXED_ROWS = [
  fixedRow('approval.allow', [APPROVAL_ALLOW_BINDING]),
  fixedRow('approval.reject', [APPROVAL_REJECT_BINDING]),
]

export const FOCUS_COMPOSER_ID = 'dsh-focus-free-shortcuts.focus-composer'
export const FOCUS_COMPOSER_BINDING = { code: 'KeyJ', modifiers: ['control', 'alt'] }
/** 本插件自己挂载的固定行:存在即预约 `Ctrl+Alt+J`。 */
export const FOCUS_COMPOSER_FIXED_ROWS = [
  fixedRow(FOCUS_COMPOSER_ID, [FOCUS_COMPOSER_BINDING], { group: 'input' }),
]
export const FOCUS_COMPOSER_PRESS = gesture('KeyJ', { control: true, alt: true })

export const PAGE_CYCLE_ID = 'dsh-focus-free-shortcuts.page-cycle'
export const PAGE_PREVIOUS_BINDING = { code: 'ArrowLeft', modifiers: ['control', 'alt'] }
export const PAGE_NEXT_BINDING = { code: 'ArrowRight', modifiers: ['control', 'alt'] }
/** 本插件自己挂载的固定行:一行同时预约 `Ctrl+Alt+←` 与 `Ctrl+Alt+→`。 */
export const PAGE_CYCLE_FIXED_ROWS = [
  fixedRow(PAGE_CYCLE_ID, [PAGE_PREVIOUS_BINDING, PAGE_NEXT_BINDING], { group: 'application' }),
]
export const PAGE_PREVIOUS_PRESS = gesture('ArrowLeft', { control: true, alt: true })
export const PAGE_NEXT_PRESS = gesture('ArrowRight', { control: true, alt: true })

/** 内置"展开/折叠右侧栏"命令 id(展开补位跟随的 effective 行)。 */
export const SIDEBAR_TOGGLE_ID = 'sidebar.right.toggle'
/** Web 上的默认绑定:primary+shift+B(Windows/Linux 的 primary 是 control)。 */
export const SIDEBAR_TOGGLE_BINDING = { code: 'KeyB', modifiers: ['control', 'shift'] }
export const SIDEBAR_TOGGLE_PRESS = gesture('KeyB', { control: true, shift: true })

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
/**
 * 只支持 `[attr]` / `[attr="value"]`(可多个连续谓词,如模态选择器
 * `[role="dialog"][aria-modal="true"]`) / `.class` / 裸标签名,够本插件用到的那
 * 几个选择器。`.class` 按 `getAttribute('class')` 的空白分词匹配;`FakeNode` 没有
 * 该读数,故 `.class` 与带值谓词对它恒假。
 */
function matchesSelector(node, selector) {
  if (selector.startsWith('.')) {
    const className = node.getAttribute?.('class') ?? ''
    return className.split(/\s+/).includes(selector.slice(1))
  }
  const groups = [...selector.matchAll(/\[([a-zA-Z-]+)(?:="([^"]*)")?\]/g)]
  if (groups.length > 0) {
    // 连续多个 [attr] 谓词须全部匹配;一旦出现括号外内容(如标签前缀),回落为标签名比较。
    if (groups.map((group) => group[0]).join('') !== selector.replace(/\s/g, '')) return node.tag === selector
    return groups.every(([, name, value]) => {
      if (value === undefined) return node.attrs.has(name) || node.values?.has(name) === true
      return node.getAttribute?.(name) === value
    })
  }
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

/**
 * 值感知的假元素:属性带值(`FakeNode` 的 `attrs` 集合仍兼任"存在性"匹配,
 * `closest` 因此照常用)。本插件页面循环的 DOM 步只读存在性选择器 + 一个
 * 值比较(`data-sidebar-right-session`),与真实 HTML 元素足够同形。
 */
export class FakeElement extends FakeNode {
  constructor(tag = 'div', attributes = {}) {
    super(tag)
    this.values = new Map()
    for (const [name, value] of Object.entries(attributes)) {
      this.attrs.add(name)
      this.values.set(name, value)
    }
    this.focusCount = 0
    this.lastFocusOptions = undefined
  }
  getAttribute(name) {
    return this.values.has(name) ? this.values.get(name) : null
  }
  hasAttribute(name) {
    return this.values.has(name)
  }
  setAttribute(name, value) {
    this.attrs.add(name)
    this.values.set(name, value)
  }
  querySelectorAll(selector) {
    const found = []
    const parts = selector.split(',').map((part) => part.trim())
    const walk = (node) => {
      for (const child of node.children) {
        if (parts.some((part) => matchesSelector(child, part))) found.push(child)
        walk(child)
      }
    }
    walk(this)
    return found
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }
  focus(options) {
    this.focusCount += 1
    this.lastFocusOptions = options
  }
}

/** 假 document:只实现本插件用到的三个读数(根级选择查询 + 当前焦点)。 */
export function fakeDocument({ root, activeElement = null } = {}) {
  return {
    activeElement,
    querySelectorAll(selector) {
      return root === undefined ? [] : root.querySelectorAll(selector)
    },
    querySelector(selector) {
      const found = root === undefined ? [] : root.querySelectorAll(selector)
      return found[0] ?? null
    },
  }
}

/**
 * 假 window:只登记捕获/冒泡阶段的 keydown 监听,`emit` 按注册顺序调用与
 * `phase` 相符的那批。页面循环桥的捕获钩子是这里唯一的常驻监听,足够仿真。
 */
export function fakeWindow() {
  const listeners = new Set()
  const capture = (options) => options === true || (typeof options === 'object' && options !== null && options.capture === true)
  return {
    listeners,
    addEventListener(type, listener, options) {
      if (type !== 'keydown') return
      listeners.add({ listener, atCapture: capture(options) })
    },
    removeEventListener(type, listener) {
      if (type !== 'keydown') return
      for (const entry of [...listeners]) {
        if (entry.listener === listener) listeners.delete(entry)
      }
    },
    emit(event, phase = 'capture') {
      for (const entry of [...listeners]) {
        if (entry.atCapture === (phase === 'capture')) entry.listener(event)
      }
    },
  }
}

/**
 * 假键盘事件:原生 KeyboardEvent 的一个最小同形,记录 preventDefault /
 * stopPropagation 的调用次数,`composedPath` 返回测试给的元素链。
 */
export function fakeKeyEvent({
  path = [],
  type = 'keydown',
  code = '',
  ctrlKey = false,
  altKey = false,
  shiftKey = false,
  metaKey = false,
  repeat = false,
  isComposing = false,
} = {}) {
  const event = {
    type,
    code,
    ctrlKey,
    altKey,
    shiftKey,
    metaKey,
    repeat,
    isComposing,
    prevented: 0,
    stopped: 0,
    composedPath: () => path,
    preventDefault() {
      event.prevented += 1
    },
    stopPropagation() {
      event.stopped += 1
    },
  }
  return event
}

// ---------------------------------------------------------------- 假服务

export function fakeShortcuts({ runtime = 'web', platform = 'macos', rows = [], fixedRows = [], stopSequenceMs = 500 } = {}) {
  const listeners = new Set()
  // 可变固定行表:registerFixed 会往里追加(每次 harness 复制一份,不污染共享常量)。
  const fixed = [...fixedRows]
  const registrations = new Map()
  return {
    runtime,
    platform,
    stopSequenceMs,
    catalog: { getSnapshot: () => rows },
    fixedCatalog: { getSnapshot: () => fixed },
    observeFixedInput(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    registerFixed(command) {
      if (registrations.has(command.id)) return () => {}
      const entry = {
        id: command.id,
        label: command.label(),
        keys: command.keys,
        group: command.group,
        bindings: command.bindings.map((binding) => ({
          code: binding.code,
          modifiers: [...binding.modifiers],
          ...(binding.secondCode === void 0 ? {} : { secondCode: binding.secondCode }),
        })),
      }
      registrations.set(command.id, entry)
      fixed.push(entry)
      return () => {
        if (registrations.get(command.id) !== entry) return
        registrations.delete(command.id)
        const index = fixed.indexOf(entry)
        if (index >= 0) fixed.splice(index, 1)
      }
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

/**
 * 页面循环桥用的侧栏假面:`mounted` / `tabsIn` / `active` / `isExpanded` /
 * `focus`。`list` 给出按记录顺序的页面 id,`active` 给出当前页;`null` 表示
 * "没有当前页 / 没有会话"(避免与缺省默认值混同)。`isExpanded()` 读可变字段
 * `expanded`,展开补位用例可以在"按下 → pump 下一帧"之间把折叠翻成展开,
 * 模拟内置 toggle 的提交。
 */
export function fakePageSidebar({ list = ['t1', 't2', 't3'], active = 't1', expanded = true, mounted = 's1' } = {}) {
  const mountedId = mounted === null ? undefined : mounted
  const activeId = active === null ? undefined : active
  const sidebar = {
    mounted: { getSnapshot: () => mountedId },
    expanded,
    isExpanded: () => sidebar.expanded,
    tabsIn: (sessionId) => (sessionId !== mountedId ? [] : list.map((id) => ({ id }))),
    active: () => (activeId === undefined ? undefined : { id: activeId }),
    focusCalls: [],
    focus(tabId) {
      sidebar.focusCalls.push(tabId)
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

/**
 * 一个可作答的审批(与 `PendingApproval` 同形):记录每次决定,可注入失败。
 * 真机上 `answerable` 由发布者撤销;这个假对象保持可写,便于测"已作答不再接"。
 */
export function approvalPending({ key = 'approval:1', kind = 'approval', answerable = true, onAnswer } = {}) {
  const pending = {
    key,
    kind,
    answerable,
    answers: [],
    answer(outcome) {
      pending.answers.push(outcome)
      return onAnswer === undefined ? Promise.resolve() : onAnswer(outcome)
    },
  }
  return pending
}

/** 待答交互发布者:状态表按引用读取,测试可随时改写。 */
export function fakeUiSession({ status = new Map() } = {}) {
  return { sessionStatus: { getSnapshot: () => status } }
}

/** 把一条待答交互发布给某个会话的状态表。 */
export function statusWith(sessionId, pendingInteraction) {
  return new Map([[sessionId, { running: true, pendingInteraction, completionUnread: false }]])
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
  fixedRows = APPROVAL_FIXED_ROWS,
  summary = { s1: session('s1') },
  bindingSnapshot = {},
  sidebar = fakeSidebar(),
  conversation = { cancel: () => Promise.resolve() },
  uiSession = fakeUiSession(),
  withSidebar = true,
  withSessions = true,
  withUiSession = true,
} = {}) {
  const shortcuts = fakeShortcuts({ runtime, rows, fixedRows })
  const sessions = fakeSessions({ summary, bindingSnapshot, scope: () => ({ get: (name) => (name === 'conversation' ? conversation ?? undefined : undefined) }) })
  const services = { shortcuts }
  if (withSidebar) services.sidebarRight = sidebar
  if (withSessions) services.sessions = sessions
  if (withUiSession) services.uiSession = uiSession
  const ctx = new FakeCtx(services)
  const warnings = captureWarnings(() => applyPlugin(ctx))
  return { ctx, shortcuts, sessions, sidebar, conversation, uiSession, warnings }
}

export { applyPlugin }
