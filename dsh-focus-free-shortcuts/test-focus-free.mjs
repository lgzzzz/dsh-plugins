/**
 * dsh-focus-free-shortcuts 的行为测试。
 *
 * 覆盖四层:(1) `src/decide.ts` 的纯判定(绑定匹配、准入、主视图会话判定、
 * Escape 序列计时);(2) 两个桥接在假 Cordis 上下文里的完整走线(谁消费、
 * 谁掌权、何时不动作);(3) 失败模式(服务缺席、会话歧义、cancel 拒绝);
 * (4) `lib/client.js` 产物的模块 id / 插件名 / inject 声明与端到端装配。
 *
 * 运行:`node test-focus-free.mjs`(依赖 Node 22+ 的 Type Stripping 直接 import .ts)。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  bindingMatches,
  conversationOwnsTarget,
  createStopSequence,
  enabledBinding,
  escapeEligible,
  mainViewSessionId,
  modifiersOf,
  paneActionFor,
  sameStopToken,
} from './src/decide.ts'
import { apply as applyPlugin } from './src/client.ts'

const here = dirname(fileURLToPath(import.meta.url))

let failures = 0
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}
function checkTrue(label, actual) {
  const ok = actual === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 true,实得 ${JSON.stringify(actual)}`}`)
}
/** 收集 console.warn,同时把原文打出来,便于人工核对诊断文本。 */
function captureWarnings(run) {
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- 假输入

function gesture(code, overrides = {}) {
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
function shortcutContext(overrides = {}) {
  return { modal: null, region: 'page', target: null, ...overrides }
}
/** 一个 keydown 固定输入 + 它的消费计数。 */
function keydown(gestureValue, contextValue) {
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
function row(id, binding, extra = {}) {
  return { id, binding, issue: null, conflicts: [], ...extra }
}

const FULLSCREEN_BINDING = { code: 'Enter', modifiers: ['alt', 'meta'] }
const SPLIT_BINDING = { code: 'Backslash', modifiers: ['meta'] }
const PANE_IDS = { fullscreen: 'pane.fullscreen.toggle', split: 'pane.split' }
const FULLSCREEN_PRESS = gesture('Enter', { alt: true, meta: true })
const SPLIT_PRESS = gesture('Backslash', { meta: true })

// ---------------------------------------------------------------- 假 DOM

class FakeNode {
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

const domBody = new FakeNode('body')
const domSession = domBody.append(new FakeNode('div', ['data-conversation-session']))
const domRegion = domSession.append(new FakeNode('div', ['data-conversation-region']))
const domComposer = domRegion.append(new FakeNode('textarea'))
const domApproval = domRegion.append(new FakeNode('div', ['data-approval-key']))
const domFrame = domRegion.append(new FakeNode('iframe'))
const domInert = domRegion.append(new FakeNode('div', ['inert']))
const domLooseRegion = domBody.append(new FakeNode('div', ['data-conversation-region']))

// ---------------------------------------------------------------- 假服务

function fakeShortcuts({ runtime = 'web', platform = 'macos', rows = [], stopSequenceMs = 500 } = {}) {
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

function fakeSidebar() {
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

function fakeSessions({ summary = {}, bindingSnapshot = {}, scope } = {}) {
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

function session(id, { mainView = 1, running = true } = {}) {
  return { id, running, retainedBy: mainView > 0 ? { mainView } : {} }
}

class FakeCtx {
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
function harness({
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

// ================================================================ A 绑定判定

console.log('--- A① 修饰键顺序与绑定匹配 ---')
{
  check('control+shift 归一顺序', modifiersOf(gesture('KeyK', { shift: true, control: true })), ['control', 'shift'])
  check('alt+meta 归一顺序', modifiersOf(FULLSCREEN_PRESS), ['alt', 'meta'])
  checkTrue('⌘⌥Enter 命中默认绑定', bindingMatches(FULLSCREEN_BINDING, FULLSCREEN_PRESS))
  check('多一个 shift 不命中', bindingMatches(FULLSCREEN_BINDING, gesture('Enter', { alt: true, meta: true, shift: true })), false)
  check('少一个 alt 不命中', bindingMatches(FULLSCREEN_BINDING, gesture('Enter', { meta: true })), false)
  check('物理码不同不命中', bindingMatches(FULLSCREEN_BINDING, gesture('NumpadEnter', { alt: true, meta: true })), false)
  check('双键和弦不命中', bindingMatches({ code: 'KeyK', secondCode: 'KeyS', modifiers: ['meta'] }, gesture('KeyK', { meta: true })), false)
  check(
    '手势带 secondCode 不命中',
    bindingMatches(FULLSCREEN_BINDING, gesture('Enter', { alt: true, meta: true, secondCode: 'KeyS' })),
    false,
  )
}

console.log('--- A② 生效绑定:未绑 / 被系统拒绝 / 冲突都不算掌权 ---')
{
  const rows = [row('pane.fullscreen.toggle', FULLSCREEN_BINDING)]
  check('正常行', enabledBinding(rows, 'pane.fullscreen.toggle'), FULLSCREEN_BINDING)
  check('解绑(null)', enabledBinding([row('pane.fullscreen.toggle', null)], 'pane.fullscreen.toggle'), undefined)
  check('被保留键拒绝', enabledBinding([row('pane.fullscreen.toggle', FULLSCREEN_BINDING, { issue: 'reserved' })], 'pane.fullscreen.toggle'), undefined)
  check('冲突中', enabledBinding([row('pane.fullscreen.toggle', FULLSCREEN_BINDING, { conflicts: ['x.y'] })], 'pane.fullscreen.toggle'), undefined)
  check('未注册', enabledBinding(rows, 'pane.split'), undefined)
}

console.log('--- A③ 谁是这一按的owner ---')
{
  const rows = [row('pane.fullscreen.toggle', FULLSCREEN_BINDING), row('pane.split', SPLIT_BINDING)]
  check('⌘⌥Enter → 全屏', paneActionFor(rows, FULLSCREEN_PRESS, PANE_IDS), 'fullscreen')
  check('⌘\\ → 分屏', paneActionFor(rows, SPLIT_PRESS, PANE_IDS), 'split')
  check('无修饰 Enter → 无', paneActionFor(rows, gesture('Enter'), PANE_IDS), undefined)
  check('⌘Enter → 无', paneActionFor(rows, gesture('Enter', { meta: true }), PANE_IDS), undefined)
  const rebound = [row('pane.fullscreen.toggle', { code: 'KeyJ', modifiers: ['meta', 'shift'] })]
  check('改绑后新键命中', paneActionFor(rebound, gesture('KeyJ', { meta: true, shift: true }), PANE_IDS), 'fullscreen')
  check('改绑后旧键落空', paneActionFor(rebound, FULLSCREEN_PRESS, PANE_IDS), undefined)
  const unbound = [row('pane.fullscreen.toggle', null)]
  check('解绑后落空', paneActionFor(unbound, FULLSCREEN_PRESS, PANE_IDS), undefined)
  const conflicted = [row('pane.fullscreen.toggle', FULLSCREEN_BINDING, { conflicts: ['other.cmd'] })]
  check('冲突后落空', paneActionFor(conflicted, FULLSCREEN_PRESS, PANE_IDS), undefined)
}

// ================================================================ B Escape 准入

console.log('--- B① 裸 Escape 的准入与逐项否决 ---')
{
  const base = gesture('Escape')
  checkTrue('裸 Escape 准入', escapeEligible(base, shortcutContext()))
  check('repeat 否决', escapeEligible(gesture('Escape', { repeat: true }), shortcutContext()), false)
  check('composing 否决', escapeEligible(gesture('Escape', { composing: true }), shortcutContext()), false)
  check('已被消费否决', escapeEligible(gesture('Escape', { defaultPrevented: true }), shortcutContext()), false)
  check('control 否决', escapeEligible(gesture('Escape', { control: true }), shortcutContext()), false)
  check('alt 否决', escapeEligible(gesture('Escape', { alt: true }), shortcutContext()), false)
  check('shift 否决', escapeEligible(gesture('Escape', { shift: true }), shortcutContext()), false)
  check('meta 否决', escapeEligible(gesture('Escape', { meta: true }), shortcutContext()), false)
  check('模态中否决', escapeEligible(base, shortcutContext({ modal: 'settings' })), false)
  check('终端区否决', escapeEligible(base, shortcutContext({ region: 'terminal' })), false)
  check('editable 区允许', escapeEligible(base, shortcutContext({ region: 'editable' })), true)
  check('别的物理码否决', escapeEligible(gesture('Backspace'), shortcutContext()), false)
}

// ================================================================ C 目标归属

console.log('--- C① 内置 stop 是否按 target 掌权 ---')
{
  checkTrue('会话区内的输入框 → 内置掌权', conversationOwnsTarget(domComposer))
  check('审批控件 → 不掌权', conversationOwnsTarget(domApproval), false)
  check('内嵌 iframe → 不掌权', conversationOwnsTarget(domFrame), false)
  check('inert 内容 → 不掌权', conversationOwnsTarget(domInert), false)
  check('body(无聚焦)→ 不掌权', conversationOwnsTarget(domBody), false)
  check('只有 region 没有 session → 不掌权', conversationOwnsTarget(domLooseRegion), false)
  check('null → 不掌权', conversationOwnsTarget(null), false)
}

console.log('--- C② 主视图会话:靠 retainedBy.mainView 判定,歧义就不动手 ---')
{
  const list = (summary) => ({ ids: Object.keys(summary), byId: summary })
  check('唯一主视图', mainViewSessionId(list({ s1: session('s1'), s2: session('s2', { mainView: 0 }) })), 's1')
  check('没有主视图', mainViewSessionId(list({ s1: session('s1', { mainView: 0 }) })), undefined)
  check('两个主视图(切换中)', mainViewSessionId(list({ s1: session('s1'), s2: session('s2') })), undefined)
  check('计数为 0 不算', mainViewSessionId(list({ s1: { id: 's1', running: true, retainedBy: { mainView: 0 } } })), undefined)
  check('无 retainedBy', mainViewSessionId(list({ s1: { id: 's1', running: true } })), undefined)
  check('空列表', mainViewSessionId(list({})), undefined)
}

// ================================================================ D Escape 序列

console.log('--- D① 两按窗口与同一代际 ---')
{
  const bindingA = { id: 'binding-a' }
  const bindingB = { id: 'binding-b' }
  const tokenA = { sessionId: 's1', binding: bindingA }
  let clock = 1000
  const sequence = createStopSequence({ intervalMs: 500, now: () => clock })
  check('第一按不算停止', sequence.press(tokenA), false)
  check('窗口内同一代际的第二按成立', sequence.press({ sessionId: 's1', binding: bindingA }), true)
  check('停止后状态清空(下一按重新开始)', sequence.press(tokenA), false)
  clock = 2000
  check('超过窗口的第一按', sequence.press(tokenA), false)
  clock = 2600
  check('超时后第二按只是新的第一按', sequence.press(tokenA), false)
  check('不同会话的第二按不算停止', sequence.press({ sessionId: 's2', binding: bindingA }), false)
  check('同会话同代际的第二按成立', sequence.press({ sessionId: 's2', binding: bindingA }), true)
  checkTrue('同一 token 判定成立', sameStopToken(tokenA, { sessionId: 's1', binding: bindingA }))
  check('换 binding 代际不成立', sameStopToken(tokenA, { sessionId: 's1', binding: bindingB }), false)
  check('换会话不成立', sameStopToken(tokenA, { sessionId: 's2', binding: bindingA }), false)
  sequence.reset()
  check('reset 后需重新两按', sequence.press(tokenA), false)
  sequence.reset()
}
{
  const sequence = createStopSequence({ intervalMs: 20 })
  const token = { sessionId: 's1', binding: {} }
  check('真实计时器:第一按', sequence.press(token), false)
  await sleep(35)
  check('真实计时器:超时后第二按不算停止', sequence.press(token), false)
  sequence.reset()
}
{
  const sequence = createStopSequence({ intervalMs: 500 })
  sequence.press({ sessionId: 's1', binding: {} })
  check('不同会话的第二按不算停止', sequence.press({ sessionId: 's2', binding: {} }), false)
  sequence.reset()
}

// ================================================================ E 桥接:面板键

console.log('--- E① 已聚焦面板:让内置命令独占这一按 ---')
{
  const { shortcuts, sidebar } = harness()
  sidebar.focused = { paneId: 'p1' }
  const { input, consumed } = keydown(FULLSCREEN_PRESS, shortcutContext({ region: 'page' }))
  shortcuts.emit(input)
  check('未调用面板操作', sidebar.calls, [])
  check('未消费', consumed.count, 0)
}
console.log('--- E② 焦点在输入框:回退到活动 dock pane 并消费 ---')
{
  const { shortcuts, sidebar } = harness()
  const target = { paneId: 'p1', host: 'dock' }
  sidebar.focused = undefined
  sidebar.command = target
  const { input, consumed } = keydown(FULLSCREEN_PRESS, shortcutContext({ region: 'editable', target: domComposer }))
  shortcuts.emit(input)
  check('全屏该 pane', sidebar.calls, [['fullscreen', target]])
  check('消费一次', consumed.count, 1)
}
console.log('--- E③ 折叠 / 没有可用 pane / 模态 / repeat / 目标过期 ---')
{
  const collapsed = harness()
  collapsed.sidebar.focused = undefined
  collapsed.sidebar.command = { paneId: 'p1' }
  collapsed.sidebar.expanded = false
  const a = keydown(FULLSCREEN_PRESS, shortcutContext())
  collapsed.shortcuts.emit(a.input)
  check('折叠时不动作', collapsed.sidebar.calls, [])
  check('折叠时不消费', a.consumed.count, 0)

  const noTarget = harness()
  noTarget.sidebar.focused = undefined
  noTarget.sidebar.command = undefined
  const b = keydown(FULLSCREEN_PRESS, shortcutContext())
  noTarget.shortcuts.emit(b.input)
  check('无 pane 时不动作', noTarget.sidebar.calls, [])
  check('无 pane 时不消费', b.consumed.count, 0)

  const modal = harness()
  modal.sidebar.focused = undefined
  modal.sidebar.command = { paneId: 'p1' }
  const c = keydown(FULLSCREEN_PRESS, shortcutContext({ modal: 'settings' }))
  modal.shortcuts.emit(c.input)
  check('模态中不动作', modal.sidebar.calls, [])
  check('模态中不消费', c.consumed.count, 0)

  const repeat = harness()
  repeat.sidebar.focused = undefined
  repeat.sidebar.command = { paneId: 'p1' }
  const d = keydown(gesture('Enter', { alt: true, meta: true, repeat: true }), shortcutContext())
  repeat.shortcuts.emit(d.input)
  check('repeat 不动作', repeat.sidebar.calls, [])
  check('repeat 仍消费', d.consumed.count, 1)

  const stale = harness()
  stale.sidebar.focused = undefined
  stale.sidebar.command = { paneId: 'p1' }
  stale.sidebar.current = false
  const e = keydown(FULLSCREEN_PRESS, shortcutContext())
  stale.shortcuts.emit(e.input)
  check('目标过期不动作', stale.sidebar.calls, [])
  check('目标过期仍消费', e.consumed.count, 1)

  const composing = harness()
  composing.sidebar.focused = undefined
  composing.sidebar.command = { paneId: 'p1' }
  const f = keydown(gesture('Enter', { alt: true, meta: true, composing: true }), shortcutContext())
  composing.shortcuts.emit(f.input)
  check('输入法中不动作', composing.sidebar.calls, [])
  check('输入法中不消费', f.consumed.count, 0)
}
console.log('--- E④ 分屏键走同一条回退 ---')
{
  const { shortcuts, sidebar } = harness()
  sidebar.focused = undefined
  sidebar.command = { paneId: 'p2' }
  const { input, consumed } = keydown(SPLIT_PRESS, shortcutContext())
  shortcuts.emit(input)
  check('按 paneId 分屏', sidebar.calls, [['split', 'p2']])
  check('分屏也消费', consumed.count, 1)
}
console.log('--- E⑤ 跟随生效绑定:改绑 / 解绑 / 冲突都不接管 ---')
{
  const rebound = harness({ rows: [row('pane.fullscreen.toggle', { code: 'KeyJ', modifiers: ['meta', 'shift'] })] })
  rebound.sidebar.command = { paneId: 'p1' }
  const old = keydown(FULLSCREEN_PRESS, shortcutContext())
  rebound.shortcuts.emit(old.input)
  check('旧键不再触发', rebound.sidebar.calls, [])
  const fresh = keydown(gesture('KeyJ', { meta: true, shift: true }), shortcutContext())
  rebound.shortcuts.emit(fresh.input)
  check('新键触发', rebound.sidebar.calls, [['fullscreen', { paneId: 'p1' }]])

  const unbound = harness({ rows: [row('pane.fullscreen.toggle', null)] })
  unbound.sidebar.command = { paneId: 'p1' }
  const press = keydown(FULLSCREEN_PRESS, shortcutContext())
  unbound.shortcuts.emit(press.input)
  check('解绑后不接管', unbound.sidebar.calls, [])

  const conflicted = harness({ rows: [row('pane.fullscreen.toggle', FULLSCREEN_BINDING, { conflicts: ['other.cmd'] })] })
  conflicted.sidebar.command = { paneId: 'p1' }
  const clash = keydown(FULLSCREEN_PRESS, shortcutContext())
  conflicted.shortcuts.emit(clash.input)
  check('冲突后不接管', conflicted.sidebar.calls, [])
}
console.log('--- E⑥ 失败模式:desktop 让位、服务缺席即 no-op ---')
{
  // Desktop 只关掉面板桥接(配置键由原生通道派发);停止序列照常安装。
  const desktop = harness({ runtime: 'desktop' })
  check('desktop 只注册停止序列', desktop.shortcuts.listenerCount(), 1)
  checkTrue('desktop 记一条 warn', desktop.warnings.some((line) => line.includes('native keyboard bridge')))
  desktop.sidebar.command = { paneId: 'p1' }
  const press = keydown(FULLSCREEN_PRESS, shortcutContext({ target: domComposer }))
  desktop.shortcuts.emit(press.input)
  check('desktop 面板键不动作', desktop.sidebar.calls, [])
  check('desktop 面板键不消费', press.consumed.count, 0)

  const noSidebar = harness({ withSidebar: false })
  check('无 sidebarRight 只注册停止序列', noSidebar.shortcuts.listenerCount(), 1)
  check('无 sidebarRight 不抛', noSidebar.warnings.length, 0)
  const orphan = keydown(FULLSCREEN_PRESS, shortcutContext({ target: domComposer }))
  noSidebar.shortcuts.emit(orphan.input)
  check('无 sidebarRight 面板键不动', orphan.consumed.count, 0)
}

// ================================================================ F 桥接:停止序列

console.log('--- F① 焦点不在输入框:Esc Esc 仍能停止 ---')
{
  let cancelled = 0
  const { shortcuts } = harness({ conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })
  const first = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  shortcuts.emit(first.input)
  check('第一按不停止', cancelled, 0)
  check('第一按仍消费', first.consumed.count, 1)
  const second = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  shortcuts.emit(second.input)
  check('第二按停止一次', cancelled, 1)
  check('第二按消费', second.consumed.count, 1)
  const third = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  shortcuts.emit(third.input)
  check('第三按只是新的第一按', cancelled, 1)
}
console.log('--- F② 焦点在会话区内:内置序列掌权,本插件不插手 ---')
{
  let cancelled = 0
  const { shortcuts } = harness({ conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })
  const first = keydown(gesture('Escape'), shortcutContext({ region: 'editable', target: domComposer }))
  shortcuts.emit(first.input)
  const second = keydown(gesture('Escape'), shortcutContext({ region: 'editable', target: domComposer }))
  shortcuts.emit(second.input)
  check('不重复停止', cancelled, 0)
  check('不消费(交给内置)', first.consumed.count + second.consumed.count, 0)
}
console.log('--- F③ reset 输入清空待完成的第一按 ---')
{
  let cancelled = 0
  const { shortcuts } = harness({ conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  shortcuts.emit({ type: 'reset' })
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  check('reset 后两按被拆开', cancelled, 0)
}
console.log('--- F④ 不在运行 / 有待答交互 / 会话歧义 / 有修饰键 / 超窗 ---')
{
  const stop = (options) => {
    let cancelled = 0
    const { shortcuts } = harness({ ...options, conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })
    for (let index = 0; index < 2; index += 1) {
      shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
    }
    return cancelled
  }
  check('列表 saying not running', stop({ summary: { s1: session('s1', { running: false }) } }), 0)
  check('对象层 not running', stop({ bindingSnapshot: { running: false } }), 0)
  check('已移除会话', stop({ bindingSnapshot: { removed: true } }), 0)
  check('不可续子代理', stop({ bindingSnapshot: { subagent: { address: { mode: 'one-shot' } } } }), 0)
  check('两个主视图(切换中)', stop({ summary: { s1: session('s1'), s2: session('s2') } }), 0)
  check('没有主视图', stop({ summary: { s1: session('s1', { mainView: 0 }) } }), 0)
  check(
    '有待答交互',
    stop({
      uiSession: {
        sessionStatus: { getSnapshot: () => new Map([['s1', { running: true, pendingInteraction: { key: 'k' }, completionUnread: false }]]) },
      },
    }),
    0,
  )
  check('正常场景作对照', stop({}), 1)
}
{
  let cancelled = 0
  const { shortcuts } = harness({ conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })
  shortcuts.emit(keydown(gesture('Escape', { shift: true }), shortcutContext({ target: domBody })).input)
  shortcuts.emit(keydown(gesture('Escape', { shift: true }), shortcutContext({ target: domBody })).input)
  check('带修饰键不停止', cancelled, 0)

  const timedShortcuts = fakeShortcuts({ stopSequenceMs: 20, rows: [] })
  const timedCtx = new FakeCtx({
    shortcuts: timedShortcuts,
    sessions: fakeSessions({ summary: { s1: session('s1') }, scope: () => ({ get: () => ({ cancel: () => { cancelled += 1; return Promise.resolve() } }) }) }),
  })
  applyPlugin(timedCtx)
  timedShortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  await sleep(35)
  timedShortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  check('超窗不停止', cancelled, 0)
}
console.log('--- F⑤ 失败模式:conversation 缺席 / cancel 拒绝 ---')
{
  const { shortcuts } = harness({ conversation: null })
  const warnings = captureWarnings(() => {
    shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
    const second = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
    shortcuts.emit(second.input)
    check('缺席时仍消费该序列', second.consumed.count, 1)
  })
  checkTrue('缺席 conversation 记一条 warn', warnings.some((line) => line.includes('conversation service unavailable')))

  const rejecting = harness({ conversation: { cancel: () => Promise.reject(new Error('boom')) } })
  const warnings2 = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings2.push(args.map(String).join(' '))
  try {
    rejecting.shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
    rejecting.shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
    await sleep(1)
  } finally {
    console.warn = originalWarn
  }
  checkTrue('cancel 拒绝被捕获并告警', warnings2.some((line) => line.includes('stop failed')))
}

console.log('--- F⑥ 卸载:效果被释放,固定监听移除 ---')
{
  const { shortcuts, ctx } = harness()
  check('注册了固定监听', shortcuts.listenerCount(), 2)
  for (const effect of ctx.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  check('释放后监听清空', shortcuts.listenerCount(), 0)
}

// ================================================================ G 产物

console.log('--- G① lib/client.js 注册、声明与端到端装配 ---')
{
  let registration = null
  globalThis.window = {
    __ModuleLoader__: {
      load: (reg) => {
        registration = reg
      },
    },
  }
  try {
    // eslint-disable-next-line no-eval
    ;(0, eval)(readFileSync(join(here, 'lib', 'client.js'), 'utf8'))
  } finally {
    delete globalThis.window
  }
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-focus-free-shortcuts')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-focus-free-shortcuts')
  check('inject 声明', plugin.inject, ['shortcuts'])

  let cancelled = 0
  const shortcuts = fakeShortcuts({
    rows: [row('pane.fullscreen.toggle', FULLSCREEN_BINDING)],
  })
  const sidebar = fakeSidebar()
  sidebar.command = { paneId: 'p1' }
  const ctx = new FakeCtx({
    shortcuts,
    sidebarRight: sidebar,
    sessions: fakeSessions({ summary: { s1: session('s1') }, scope: () => ({ get: () => ({ cancel: () => { cancelled += 1; return Promise.resolve() } }) }) }),
  })
  const warnings = captureWarnings(() => plugin.apply(ctx))
  check('产物装配无告警', warnings, [])
  shortcuts.emit(keydown(FULLSCREEN_PRESS, shortcutContext({ target: domComposer })).input)
  check('产物里全屏桥接生效', sidebar.calls, [['fullscreen', { paneId: 'p1' }]])
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  check('产物里停止桥接生效', cancelled, 1)
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exitCode = failures === 0 ? 0 : 1
