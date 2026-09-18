/**
 * 诊断脚本(非插件产物):用最小 DOM 桩加载 lib/client.js,验证 Ctrl+Alt+↑/↓ 沿侧栏可见顺序跳转活跃会话且无降级。
 * 覆盖:① 视图 store 活实例(工作区分组 + 本地顺序);② flat 单列表;③ 权威来源不可用(服务缺失 / 无 resolveStore /
 * 快照非对象 / groupBy 未知 / workspaces 缺 items)→ 一律 no-op。用法: node test-dispatch.mjs */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// ---- 最小 DOM 桩 ----------------------------------------------------------
class FakeNode {}
class FakeHTMLElement extends FakeNode {
  constructor(tag = 'DIV') {
    super()
    this.tagName = tag
    this.isContentEditable = false
    this.disabled = false
  }
  focus() {}
  click() { this.clicked = true }
  getAttribute() { return null }
  querySelector() { return null }
  querySelectorAll() { return [] }
  closest() { return null }
  contains() { return false }
  remove() {}
  appendChild() {}
  addEventListener() {}
}
class FakeDocument {
  constructor() { this.listeners = new Map() }
  addEventListener(type, fn, capture) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push({ fn, capture })
  }
  removeEventListener() {}
  querySelector() { return null }
  querySelectorAll() { return [] }
  createElement(tag) { return new FakeHTMLElement(tag.toUpperCase()) }
  getElementById() { return null }
  get body() { return new FakeHTMLElement('BODY') }
  get head() { return new FakeHTMLElement('HEAD') }
}
class FakeKeyboardEvent {
  constructor(init) {
    Object.assign(this, {
      ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      repeat: false, isComposing: false, key: '', code: '',
      target: null,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { this.propagationStopped = true },
    }, init)
  }
}

globalThis.Node = FakeNode
globalThis.HTMLElement = FakeHTMLElement
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' },
})
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
}

// ---- 模块加载器桩 ---------------------------------------------------------
let registration = null
globalThis.window = {
  __ModuleLoader__: {
    load: (reg) => { registration = reg },
  },
}

const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
// eslint-disable-next-line no-eval
;(0, eval)(source)
if (registration === null) throw new Error('bundle did not register')
const plugin = registration.factory(() => { throw new Error('unexpected external require') })
console.log('plugin name:', plugin.name, '| inject:', JSON.stringify(plugin.inject))

/** 用给定服务集合装配一次插件,返回按键函数与 open 记录。 */
function boot(services) {
  const doc = new FakeDocument()
  globalThis.document = doc
  const opened = []
  const withOpen = {
    ...services,
    // 0.1.6-alpha.2:sessions.open 已删除,打开会话只走 uiWorkspace.openSession
    uiWorkspace: { ...services.uiWorkspace, openSession: (id) => { opened.push(id) } },
  }
  const ctx = {
    get: (name) => withOpen[name],
    effect: (cb) => { const d = cb(); if (typeof d === 'function') d() },
  }
  plugin.apply(ctx)
  const handler = doc.listeners.get('keydown')?.[0]?.fn
  if (handler === undefined) throw new Error('no keydown listener installed')
  return {
    opened,
    press: (key, extra = {}) => {
      const event = new FakeKeyboardEvent({
        key,
        code: key,
        ctrlKey: true,
        altKey: true,
        ...extra,
      })
      handler(event)
      return event
    },
  }
}

/** 视图层会话源(alpha.2:当前会话在 uiSession.current,完成未读在 uiSession.sessionStatus)。 */
function viewOf(currentId, completionUnread = []) {
  return {
    pendingInteractions: { getSnapshot: () => new Map() },
    current: { getSnapshot: () => (currentId === undefined ? undefined : { key: currentId }) },
    sessionStatus: {
      getSnapshot: () => new Map(completionUnread.map((id) => [id, { completionUnread: true }])),
    },
  }
}

const pending = viewOf(undefined)
const sidebarRight = { toggleExpanded() {} }

/** 会话快照:running / 完成未读(source 在 uiSession.sessionStatus)决定活跃集。 */
function snapshotOf(rows) {
  return {
    ids: rows.map((row) => row.id),
    byId: Object.fromEntries(rows.map((row) => [row.id, { blank: false, ...row }])),
    subagentsByParent: {},
  }
}

/** 侧栏视图 store 的假 handle + slots 服务(活实例路径)。 */
function liveSlots(viewState) {
  const handle = { spec: { persist: 'dsh.workspace.view.test' } }
  return {
    handle,
    slots: {
      entries: (key) => (key === 'sidebar.workspaces' ? [{ store: handle }] : []),
      resolveStore: (h, scope) => {
        if (h !== handle || scope !== undefined) throw new Error('bad resolveStore call')
        return { getSnapshot: () => viewState }
      },
    },
  }
}

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`)
}

// 场景 1:工作区分组 + 视图 store 活实例 —— 跳转走侧栏顺序 [s-1,s-2,s-4,s-3],而非最近更新序
{
  const snapshot = snapshotOf([
    { id: 's-1', running: false, updatedAt: 2000 },
    { id: 's-2', running: true, updatedAt: 1000 },
    { id: 's-3', running: false, updatedAt: 4000 },
    { id: 's-4', running: false, updatedAt: 3000 },
  ])
  const { slots } = liveSlots({
    groupBy: 'workspace',
    orderBy: 'manual',
    groupExpansion: { 'ws-1': true, 'ws-2': true },
    sessionOrderByAccount: { 'ws-1': ['s-1', 's-2'], 'ws-2': ['s-4', 's-3'] },
  })
  const env = boot({
    sessions: { list: { getSnapshot: () => snapshot } },
    uiSession: viewOf('s-2', ['s-1', 's-4']),
    sidebarRight,
    workspaces: {
      list: {
        getSnapshot: () => ({
          archivedSessionIds: [],
          items: [
            { workspaceId: 'ws-1', sessionIds: ['s-1', 's-2'] },
            { workspaceId: 'ws-2', sessionIds: ['s-3', 's-4'] },
          ],
        }),
      },
    },
    slots,
  })
  console.log('\n--- 场景 1:工作区分组 + store 活实例 ---')
  env.press('ArrowUp')
  check('↑ 侧栏上一行活跃会话 s-1', env.opened, ['s-1'])
  env.press('ArrowDown')
  check('↓ 侧栏下一行活跃会话 s-4(跳过 s-3)', env.opened, ['s-1', 's-4'])
}

// 场景 2:flat 单列表 —— 顺序来自视图 store 的扁平账号 [s-1,s-2,s-3],非最近更新序
{
  const snapshot = snapshotOf([
    { id: 's-1', running: false, updatedAt: 1 },
    { id: 's-2', running: true, updatedAt: 2 },
    { id: 's-3', running: false, updatedAt: 3 },
  ])
  const { slots } = liveSlots({
    groupBy: 'flat',
    orderBy: 'manual',
    sessionOrderByAccount: { __flat_session_order__: ['s-1', 's-2', 's-3'] },
  })
  const env = boot({
    sessions: { list: { getSnapshot: () => snapshot } },
    uiSession: viewOf('s-2', ['s-1']),
    sidebarRight,
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    slots,
  })
  console.log('\n--- 场景 2:单列表(flat)模式 ---')
  env.press('ArrowUp')
  check('↑ 落到 s-1(账号序,非最近更新序)', env.opened, ['s-1'])
}

// 场景 3:权威来源不可用 → 一律 no-op(无降级)
{
  console.log('\n--- 场景 3:权威来源不可用 → no-op ---')
  const snapshot = snapshotOf([
    { id: 's-1', running: false, updatedAt: 1 },
    { id: 's-2', running: true, updatedAt: 2 },
    { id: 's-3', running: false, updatedAt: 3 },
  ])
  const sessions = { list: { getSnapshot: () => snapshot } }
  const items = [{ workspaceId: 'ws-1', sessionIds: ['s-1', 's-2', 's-3'] }]
  const cases = [
    ['slots 服务缺失', { slots: undefined }, { archivedSessionIds: [], items }],
    ['slots 无 resolveStore', { slots: { entries: () => [{ store: { spec: { persist: 'x' } } }] } }, { archivedSessionIds: [], items }],
    ['store 快照非对象', { slots: { entries: () => [{ store: {} }], resolveStore: () => ({ getSnapshot: () => null }) } }, { archivedSessionIds: [], items }],
    ['groupBy 未知', (() => { const { slots } = liveSlots({ groupBy: 'unknown' }); return { slots } })(), { archivedSessionIds: [], items }],
    ['workspaces 缺 items', (() => { const { slots } = liveSlots({ groupBy: 'workspace' }); return { slots } })(), { archivedSessionIds: [] }],
    ['workspaces 服务缺失', (() => { const { slots } = liveSlots({ groupBy: 'workspace' }); return { slots } })(), undefined],
  ]
  for (const [label, extra, workspacesSnapshot] of cases) {
    const env = boot({
      sessions,
      uiSession: viewOf('s-2', ['s-1', 's-3']),
      sidebarRight,
      workspaces: workspacesSnapshot === undefined ? undefined : { list: { getSnapshot: () => workspacesSnapshot } },
      ...extra,
    })
    env.press('ArrowUp')
    env.press('ArrowDown')
    check(`${label} → no-op`, env.opened, [])
  }
}

// 场景 4:⌘/Ctrl+B(左栏)/ ⌘/Ctrl+O(右栏)在 browse 与 editing 态都生效
{
  console.log('\n--- 场景 4:侧栏开关的键位与态闸门 ---')
  const snapshot = snapshotOf([{ id: 's-1', running: false, updatedAt: 1 }])
  let left = 0
  let right = 0
  const env = boot({
    sessions: { list: { getSnapshot: () => snapshot } },
    uiSession: viewOf('s-1'),
    layout: { toggleSidebar: () => { left += 1 } },
    sidebarRight: { toggleExpanded: () => { right += 1 } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    slots: undefined,
  })
  const editable = new FakeHTMLElement('DIV')
  editable.isContentEditable = true

  let event = env.press('b', { altKey: false })
  check('browse 态 ⌘/Ctrl+B → 左栏 + 吞键', [left, right, event.propagationStopped], [1, 0, true])
  event = env.press('b', { altKey: false, target: editable })
  check('editing 态 ⌘/Ctrl+B → 左栏 + 吞键', [left, right, event.propagationStopped], [2, 0, true])

  // 右栏 = ⌘/Ctrl+O;altKey 显式关掉,免得落到 mod+alt 的会话跳转上
  event = env.press('o', { altKey: false })
  check('browse 态 ⌘/Ctrl+O → 右栏 + 吞键', [left, right, event.propagationStopped], [2, 1, true])
  event = env.press('o', { altKey: false, target: editable })
  check('editing 态 ⌘/Ctrl+O → 右栏 + 吞键', [left, right, event.propagationStopped], [2, 2, true])
}

// 场景 5:uiSession.current 不可读 → 回退目录里 retainedBy.mainView > 0 的那一行(与上游 publishMain 同判据)
{
  const snapshot = {
    ids: ['s-1', 's-2'],
    byId: {
      's-1': { id: 's-1', running: false, blank: false, updatedAt: 1 },
      's-2': { id: 's-2', running: true, blank: false, updatedAt: 2, retainedBy: { mainView: 1 } },
    },
    subagentsByParent: {},
  }
  const { slots } = liveSlots({
    groupBy: 'flat',
    orderBy: 'manual',
    sessionOrderByAccount: { __flat_session_order__: ['s-1', 's-2'] },
  })
  const env = boot({
    sessions: { list: { getSnapshot: () => snapshot } },
    // 只给状态源、不给 current:插件必须回退到 retainedBy.mainView
    uiSession: {
      pendingInteractions: { getSnapshot: () => new Map() },
      sessionStatus: { getSnapshot: () => new Map([['s-1', { completionUnread: true }]]) },
    },
    sidebarRight,
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    slots,
  })
  console.log('\n--- 场景 5:uiSession.current 缺席 → retainedBy.mainView 回退 ---')
  env.press('ArrowUp')
  check('↑ 以 s-2 为锚 → s-1', env.opened, ['s-1'])
}

console.log(failures === 0 ? '\nall dispatch probes passed' : `\n${failures} probe(s) FAILED`)
process.exitCode = failures === 0 ? 0 : 1