/**
 * 行为测试的共享装置:断言与失败计数、假输入 / 假 DOM / 假服务,以及把 `src/client.ts`
 * 装进假 Cordis 上下文的 harness。依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { apply as applyPlugin } from '../src/client.ts'

/** 本插件的包根目录(测试文件在 test/ 下,即上一级)。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

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
/** 收集 console.warn 的文本(期间替换实现,不打印原文)。 */
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
/** 一条已挂载的固定行(只读快捷键):存在即预约它的键位。 */
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
/** ui-approval 挂载时预约的两条固定行。 */
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

export const SESSION_CYCLE_ID = 'dsh-focus-free-shortcuts.session-cycle'
export const SESSION_PREVIOUS_BINDING = { code: 'ArrowUp', modifiers: ['control', 'alt'] }
export const SESSION_NEXT_BINDING = { code: 'ArrowDown', modifiers: ['control', 'alt'] }
/** 本插件自己挂载的固定行:一行同时预约 `Ctrl+Alt+↑` 与 `Ctrl+Alt+↓`。 */
export const SESSION_CYCLE_FIXED_ROWS = [
  fixedRow(SESSION_CYCLE_ID, [SESSION_PREVIOUS_BINDING, SESSION_NEXT_BINDING], { group: 'application' }),
]
export const SESSION_PREVIOUS_PRESS = gesture('ArrowUp', { control: true, alt: true })
export const SESSION_NEXT_PRESS = gesture('ArrowDown', { control: true, alt: true })

/** 内置"展开/折叠右侧栏"命令 id,展开补位跟随它的有效行。 */
export const SIDEBAR_TOGGLE_ID = 'sidebar.right.toggle'
/** Web 上的默认绑定:primary+shift+B(Windows/Linux 的 primary 是 control)。 */
export const SIDEBAR_TOGGLE_BINDING = { code: 'KeyB', modifiers: ['control', 'shift'] }
export const SIDEBAR_TOGGLE_PRESS = gesture('KeyB', { control: true, shift: true })

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
  /** 真实 DOM 的读数名:本插件的分组归属按 `parentElement` 上溯。 */
  get parentElement() {
    return this.parent
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
 * 选择器匹配:支持 `[attr]` / `[attr="value"]`(可多个连续谓词,如
 * `[role="dialog"][aria-modal="true"]`) / `.class` / 裸标签名。
 * `.class` 按 `getAttribute('class')` 的空白分词匹配;`FakeNode` 没有该读数,
 * 故 `.class` 与带值谓词对它恒假。
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

/** 提问卡片的请求键(测试里发的待答提问与卡片标记必须同名)。 */
export const QUESTION_KEY = 'question:s1:call-1'
/** Plan-review 卡片的请求键(与提问卡片同形,只是换一个根标记)。 */
export const PLAN_REVIEW_KEY = 'question:s1:call-2'

/**
 * 值感知的假元素:属性带值,同时保留 `FakeNode` 的 `attrs` 存在性匹配;并支持
 * `data-dsh-automatic-focus` 标记所需的真实属性写入与 `blur` / `keydown` 监听。
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
    this.listeners = new Map()
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }
  /** 手动派发一个合成事件给本元素的监听(测试用;不做冒泡)。 */
  dispatch(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }
  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0
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
  removeAttribute(name) {
    this.attrs.delete(name)
    this.values.delete(name)
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

/** 提问卡片根 + 它的自定义答案文本域(焦点常落在文本域里)。 */
export const domQuestionCard = domRegion.append(new FakeElement('div', { 'data-question-key': QUESTION_KEY }))
export const domQuestionField = domQuestionCard.append(new FakeElement('textarea'))
/** Plan-review 卡片根 + 它的一个动作按钮(与提问卡片同形,换根标记)。 */
export const domPlanReviewCard = domRegion.append(new FakeElement('div', { 'data-plan-review-key': PLAN_REVIEW_KEY }))
export const domPlanReviewButton = domPlanReviewCard.append(new FakeElement('button'))
/** 没有 `getAttribute` 的裸卡片根:属性存在性匹配命中,值比较无从谈起。 */
export const domBareQuestionCard = domRegion.append(new FakeNode('div', ['data-question-key']))

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
 * 假 window:只登记捕获 / 冒泡阶段的 keydown 监听,`emit` 按注册顺序调用与 `phase` 相符的那批。
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
 * 假键盘事件:记录 preventDefault / stopPropagation 的调用次数,
 * `composedPath` 返回测试给的元素链。
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

export function fakeShortcuts({ runtime = 'web', platform = 'macos', rows = [], fixedRows = [], stopSequenceMs = 500 } = {}) {
  const listeners = new Set()
  // 可变固定行表:registerFixed 会往里追加。
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
 * 页面循环桥用的侧栏假面:`mounted` / `tabsIn` / `active` / `isExpanded` / `focus`。
 * `list` 是按记录顺序的页面 id,`active` 是当前页;`null` 表示"没有当前页 / 没有会话"。
 * `isExpanded()` 读可变字段 `expanded`。
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

/**
 * 会话导航假面:上游 `UiWorkspace` 的公开面里本插件要用的那一个动词。
 * `openSession` 记录每一次切换,`opened` 就是调用顺序。
 */
export function fakeSessionNavigation() {
  const navigation = {
    opened: [],
    openSession(target) {
      navigation.opened.push(target)
    },
  }
  return navigation
}

/** 会话状态表:按 id → 部分状态构造(未给的字段取假值),供活跃判定读取。 */
export function statusTable(entries = {}) {
  return new Map(Object.entries(entries).map(([id, status]) => [id, {
    running: false,
    pendingInteraction: undefined,
    completionUnread: false,
    ...status,
  }]))
}

/**
 * 一段侧栏工作区浏览器的假 DOM:外层是 `role="tree"` 的列表,里面一个分组一层容器。
 *
 * 容器里的顺序与官方渲染一致:自己的分组行 →(嵌套子分组)→ 自己名下的会话行 →
 *(「展开更多」行);分组行与会话行外面都包着一层 HoverCard 的 `span`,所以本插件
 * 按「最近的 div 祖先」找分组容器。
 *
 * @param groups - `[{ key, sessions?, children?, overflow?, archived? }]`;
 *   `key` 为 `''` 表示「未分组」桶,`archived` 里的会话行带官方那个「不可打开」标记。
 */
export function sidebarTree(groups = []) {
  const tree = new FakeElement('div', { role: 'tree' })
  for (const group of groups) tree.append(sidebarGroup(group))
  return tree
}

/** 一个分组容器;`hoverRow` 复刻官方那层 HoverCard 包装。 */
function sidebarGroup({ key, sessions = [], children = [], overflow = false, archived = [] }) {
  const section = new FakeElement('div')
  section.append(hoverRow(`workspace:${key}`))
  if (children.length > 0) {
    const nested = section.append(new FakeElement('div', { role: 'group' }))
    for (const child of children) nested.append(sidebarGroup(child))
  }
  for (const id of sessions) {
    const attributes = { 'data-row-key': `session:${id}` }
    if (archived.includes(id)) attributes['aria-description'] = 'Archived sessions cannot be opened.'
    section.append(hoverRow(undefined, attributes))
  }
  if (overflow) section.append(new FakeElement('button', { 'data-row-key': `overflow:${key}` }))
  return section
}

/** 官方给每个行外面包一层 HoverCard 的 `span`;行本身是它唯一的锚点子节点。 */
function hoverRow(rowKey, attributes = {}) {
  const wrapper = new FakeElement('span')
  wrapper.append(new FakeElement('div', rowKey === undefined ? attributes : { 'data-row-key': rowKey, ...attributes }))
  return wrapper
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

/** 一个可作答的审批(与 `PendingApproval` 同形):记录每次决定,可注入失败。 */
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

/**
 * 一个可关闭的待答提问(与 `PendingQuestion` 的公开面同形):记录每次关闭,可注入失败;
 * `kind`(`question` / `plan-review`)与 `dismiss()` 决定它是否可关。
 */
export function questionPending({ key = QUESTION_KEY, kind = 'question', onDismiss } = {}) {
  const pending = {
    key,
    kind,
    dismissals: 0,
    dismiss() {
      pending.dismissals += 1
      return onDismiss === undefined ? Promise.resolve() : onDismiss()
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
    /** 依赖未就绪的注入:复刻 Cordis 的「等」,而不是直接放弃。 */
    this.pending = []
  }
  get(name) {
    return this.services[name]
  }
  /** 新增一项服务,并按 Cordis 的语义重试等待中的注入。 */
  provide(name, value) {
    this.services[name] = value
    const waiting = this.pending
    this.pending = []
    for (const entry of waiting) this.inject(entry.deps, entry.callback)
  }
  inject(deps, callback) {
    if (deps.some((name) => this.services[name] === undefined)) {
      // 服务缺席时 Cordis 让这段逻辑停在等待中,服务到齐后再跑(见 provide)。
      this.pending.push({ deps, callback })
      return undefined
    }
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
  navigation = fakeSessionNavigation(),
  withSidebar = true,
  withSessions = true,
  withUiSession = true,
  withUiWorkspace = true,
} = {}) {
  const shortcuts = fakeShortcuts({ runtime, rows, fixedRows })
  const sessions = fakeSessions({ summary, bindingSnapshot, scope: () => ({ get: (name) => (name === 'conversation' ? conversation ?? undefined : undefined) }) })
  const services = { shortcuts }
  if (withSidebar) services.sidebarRight = sidebar
  if (withSessions) services.sessions = sessions
  if (withUiSession) services.uiSession = uiSession
  if (withUiWorkspace) services.uiWorkspace = navigation
  const ctx = new FakeCtx(services)
  const warnings = captureWarnings(() => applyPlugin(ctx))
  return { ctx, shortcuts, sessions, sidebar, conversation, uiSession, navigation, warnings }
}

export { applyPlugin }
