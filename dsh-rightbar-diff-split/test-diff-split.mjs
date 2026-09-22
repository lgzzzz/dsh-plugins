/**
 * 诊断脚本(非插件产物):纯 Node,无浏览器。三部分:
 *   A. 直接以 Node Type Stripping 载入 src/diff-split.ts + src/subscriptions.ts,用类方法形态的
 *      store / slots 桩驱动判定与事件分发,覆盖三种事件各自触发写入、非三事件不触发、§4.2 判定表
 *      全部行、首次读到状态只记快照、桶缺席推迟与解除、各环缺席 / 抛错时 no-op;
 *   B. 用 window.__ModuleLoader__ 桩载入构建产物 lib/client.js,验证包名 / inject 声明与 apply 装配
 *      (含 ctx.effect 退订、apply 容错);
 *   C. 装配后的端到端:产物 + 真桩,跑「打开 diff(全屏 → 分栏 / 非全屏 → 不分栏)」与「换会话重建订阅」。
 * 桩里 store 方法 / 动作一律写成读 this 的类方法形态:插件若摘引用调用会抛错 → 本脚本能测出该类缺陷。
 * 用法:node test-diff-split.mjs(需先 npm run build)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createDiffSplitSync } from './src/diff-split.ts'
import { createSubscriptionHub } from './src/subscriptions.ts'

const here = dirname(fileURLToPath(import.meta.url))

const REVIEW_KEY = '@deepseek-ai/dsh-client-ui-deliverables'

let failures = 0
/** 断言并按仓库脚本惯例记账。 */
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

/** 断言不抛(用于容错场景)。 */
function checkNoThrow(label, run) {
  try {
    run()
    check(label, true, true)
  } catch (error) {
    check(`${label}(${String(error)})`, false, true)
  }
}

// ---- 桩:引擎 store 与上游三个 store -----------------------------------------

/** 引擎 store 活实例的最小面:getSnapshot / subscribe 都是读 this 的方法(上游是类实例)。 */
class FakeStore {
  constructor(snapshot) {
    this.state = snapshot
    this.listeners = new Set()
  }
  getSnapshot() {
    return this.state
  }
  subscribe(fn) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  notify() {
    for (const fn of [...this.listeners]) fn()
  }
  get listenerCount() {
    return this.listeners.size
  }
}

/** 布局 store(root 作用域):全屏真身 layoutInfo.rightbarFullscreen(openRightbar / closeRightbar 是上游写面)。 */
class FakeLayoutStore extends FakeStore {
  constructor(fullscreen, viewportWidth = 1440) {
    super({ layoutInfo: { sidebar: 280, viewportWidth, rightbarTrack: false, rightbarFullscreen: fullscreen } })
  }
  /** 上游 LayoutController.openRightbar(track, fullscreen)。 */
  openRightbar(track, fullscreen) {
    if (this.state.layoutInfo.rightbarTrack === track && this.state.layoutInfo.rightbarFullscreen === fullscreen) return
    this.state.layoutInfo.rightbarTrack = track
    this.state.layoutInfo.rightbarFullscreen = fullscreen
    this.notify()
  }
  /** 上游 LayoutController.closeRightbar():收起即上报非全屏。 */
  closeRightbar() {
    if (this.state.layoutInfo.rightbarFullscreen === false) return
    this.state.layoutInfo.rightbarFullscreen = false
    this.notify()
  }
  /** 非全屏事件的布局写入(拖左栏 / 窗口缩放):通知但全屏值不变。 */
  setSidebar(px) {
    this.state.layoutInfo.sidebar = px
    this.notify()
  }
}

/** 右栏会话级 store:bySession[id].layout(上游 sidebar-right 的 plan* 写面按最小语义复刻)。 */
class FakeRightbarStore extends FakeStore {
  constructor() {
    super({ bySession: {} })
  }
  surface(sessionId) {
    let surface = this.state.bySession[sessionId]
    if (surface === undefined) {
      surface = { layout: { nodes: {}, tabs: {}, activePaneId: undefined, expanded: false, mode: 'push' } }
      this.state.bySession[sessionId] = surface
    }
    return surface
  }
  /** 上游 actions.open(sessionId):面板首次物化(不发新标签)。 */
  open(sessionId) {
    this.surface(sessionId)
    this.notify()
  }
  /** 上游 actions.openContent:铸新 TabId 开页 + 展开 + focus。 */
  openContent(sessionId, kind, tabId) {
    const { layout } = this.surface(sessionId)
    const paneId = layout.activePaneId ?? 'pane-1'
    const pane = layout.nodes[paneId] ?? { kind: 'pane', tabs: [], activeTabId: undefined }
    pane.tabs = [...pane.tabs, tabId]
    pane.activeTabId = tabId
    layout.nodes[paneId] = pane
    layout.activePaneId = paneId
    layout.tabs[tabId] = { id: tabId, kind }
    layout.expanded = true
    this.notify()
  }
  /** 上游 actions.focusTab:切换当前标签(当前面板内)。 */
  focusTab(sessionId, tabId) {
    const { layout } = this.surface(sessionId)
    layout.nodes[layout.activePaneId].activeTabId = tabId
    this.notify()
  }
  /** 以下都是「非事件」通知:改 bySession 但当前标签与全屏值都没变。 */
  setExpanded(sessionId, expanded) {
    this.surface(sessionId).layout.expanded = expanded
    this.notify()
  }
  placeTab(sessionId, tabId) {
    const { layout } = this.surface(sessionId)
    if (layout.tabs[tabId] === undefined) layout.tabs[tabId] = { id: tabId, kind: 'text' }
    this.notify()
  }
  resizeSplit(sessionId) {
    this.surface(sessionId)
    this.notify()
  }
  moveFloat(sessionId) {
    this.surface(sessionId)
    this.notify()
  }
}

/** 变更审阅视图 store 的写面:上游是 toggle 且桶缺席时 bucket() 抛错;写成读 this 的类方法。 */
class FakeReviewActions {
  constructor(store, toggleThrows) {
    this.store = store
    this.toggleThrows = toggleThrows
    this.splitCalls = []
    this.unboundCalls = 0
  }
  /** 上游 navigated:首次播种 split: true(左右对比)。 */
  navigated(tabId) {
    const byTab = this.store.state.byTab
    if (byTab[tabId] === undefined) byTab[tabId] = { index: 0, split: true, wrap: false, navigated: 1 }
    else byTab[tabId].navigated = 2
    this.store.notify()
  }
  toggledSplit(tabId) {
    if (this.store === undefined) {
      // 摘引用调用时 this 丢了:上游烘焙动作不读 this,但本桩故意留痕以便测出该缺陷
      this.unboundCalls += 1
      throw new Error('toggledSplit called without its actions owner')
    }
    if (this.toggleThrows) throw new Error('boom')
    const tab = this.store.state.byTab[tabId]
    if (tab === undefined) throw new Error(`ui-deliverables: no review state for tab "${tabId}"`)
    tab.split = !tab.split
    this.splitCalls.push(tabId)
    this.store.notify()
  }
}

class FakeReviewStore extends FakeStore {
  constructor(toggleThrows = false) {
    super({ byTab: {} })
    this.actions = new FakeReviewActions(this, toggleThrows)
  }
  /** 测试用:直接种一个桶(页 body 已 navigated 之后的状态)。 */
  seed(tabId, split) {
    this.state.byTab[tabId] = { index: 0, split, wrap: false, navigated: 1 }
  }
  /** 测试用:桶里的 split 换成非布尔(上游形状漂移)。 */
  seedUnknown(tabId) {
    this.state.byTab[tabId] = { index: 0, split: 'yes', wrap: false, navigated: 1 }
  }
}

// ---- 桩:座位与 slots / sessions / uiSession --------------------------------

/** 一个 store 座位:handle(注册项上的那个对象)+ 按作用域铸的活实例(resolveStore 以对象标识查表)。 */
function makeSeat(scope, createInstance) {
  const handle = {}
  const instances = new Map()
  return {
    handle,
    scope,
    instanceFor(key) {
      const mapKey = scope === 'root' ? 'root' : key
      let instance = instances.get(mapKey)
      if (instance === undefined) {
        instance = createInstance(mapKey)
        instances.set(mapKey, instance)
      }
      return instance
    },
  }
}

/**
 * 组装一整套桩服务。
 * @returns { services, layoutStore, rightbarStore, reviewStore, slotListeners, ownerOf, current }
 *   layoutStore/rightbarStore/reviewStore 都是「按会话取活实例」的函数(布局 store 忽略参数)。
 */
function makeStack(options = {}) {
  const sessionId = options.sessionId ?? 's1'
  const fullscreen = options.fullscreen ?? false
  const owners = new Map()
  const ownerOf = (id) => {
    let owner = owners.get(id)
    if (owner === undefined) {
      owner = { session: { id } }
      owners.set(id, owner)
    }
    return owner
  }
  ownerOf(sessionId)

  const layoutSeat = makeSeat('root', () => new FakeLayoutStore(fullscreen))
  const rightbarSeat = makeSeat('session', () => new FakeRightbarStore())
  const reviewSeat = makeSeat('session', () => new FakeReviewStore(options.toggleThrows === true))

  const entries = new Map()
  if (options.layout !== false) entries.set('root', [{ store: layoutSeat.handle, options: {} }])
  if (options.rightbar !== false) entries.set('rightbar.session', [{ store: rightbarSeat.handle, options: {} }])
  if (options.review !== false) {
    entries.set('sidebar.right.pane.tab', [
      { store: {}, options: { key: 'dsh-client-ui-sidebar' } },
      { store: reviewSeat.handle, options: { key: REVIEW_KEY } },
    ])
  }
  const seatByHandle = new Map([
    [layoutSeat.handle, layoutSeat],
    [rightbarSeat.handle, rightbarSeat],
  ])
  if (options.review !== false) seatByHandle.set(reviewSeat.handle, reviewSeat)

  const slotListeners = new Map()
  const slots = {
    entries(key) {
      if (options.entriesThrows === true) throw new Error('entries unavailable')
      return entries.get(key) ?? []
    },
    resolveStore(handle, binding) {
      if (options.resolveThrows === true) throw new Error('store handle is not registered')
      const seat = seatByHandle.get(handle)
      if (seat === undefined) throw new Error('store handle is not registered')
      if (seat.scope === 'root') {
        if (binding !== undefined) throw new Error('root store resolution requires no binding')
        return seat.instanceFor(undefined)
      }
      if (binding === undefined || typeof binding.key !== 'string') throw new Error(`${seat.scope} store resolution requires a session id`)
      return seat.instanceFor(binding.key)
    },
    subscribe(key, fn) {
      if (options.noSubscribe === true) return undefined
      let set = slotListeners.get(key)
      if (set === undefined) {
        set = new Set()
        slotListeners.set(key, set)
      }
      set.add(fn)
      return () => {
        set.delete(fn)
      }
    },
  }

  const current = new FakeStore({ key: sessionId })
  const uiSession = {
    current,
    bindingSource(reference) {
      if (reference === undefined || reference === null) throw new Error('ui-session: no reference')
      if (options.bindingThrows === true) throw new Error('ui-session: Session reference is not active')
      const owner = owners.get(reference.sessionId)
      if (owner === undefined || owner !== reference.binding) throw new Error('ui-session: Session reference is not active in this Controller')
      return { getSnapshot: () => ({ key: reference.sessionId, ctx: reference.binding.session }) }
    },
  }

  const services = {
    slots: options.noSlots === true ? undefined : slots,
    sessions: { binding: (id) => owners.get(id) },
    uiSession: options.noUiSession === true ? undefined : uiSession,
  }

  return {
    services,
    current,
    owners,
    ownerOf,
    layoutStore: () => layoutSeat.instanceFor(undefined),
    rightbarStore: (id = sessionId) => rightbarSeat.instanceFor(id),
    reviewStore: (id = sessionId) => reviewSeat.instanceFor(id),
    slotListenerCount: (key) => slotListeners.get(key)?.size ?? 0,
    /** 触发某个 slot 的注册变化通知(上游 slots.subscribe 是 microtask 批量,这里同步驱动)。 */
    slotNotify: (key) => {
      for (const fn of [...(slotListeners.get(key) ?? [])]) fn()
    },
    slots,
  }
}

// ---- A. 判定与事件 ----------------------------------------------------------

console.log('--- A① 打开 diff 标签 + 非全屏:先推迟(桶未播种),播种后写一次「不分栏」 ---')
{
  const stack = makeStack({ fullscreen: false })
  const sync = createDiffSplitSync(stack.services)
  sync.notifyLayout() // 首次读到 false:只记快照
  check('首次通知后无写入', sync.state().writes, 0)
  check('全屏快照已记录', sync.state().lastFullscreen, false)
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  sync.notifyRightbar()
  check('桶缺席 → 推迟', sync.hasPending(), true)
  check('推迟时未写', stack.reviewStore().actions.splitCalls, [])
  stack.reviewStore().actions.navigated('t1') // 非全屏时上游仍播种 split: true
  sync.notifyReview()
  check('播种后按非全屏写 → split=false', stack.reviewStore().getSnapshot().byTab.t1.split, false)
  check('写入次数', sync.state().writes, 1)
  check('待完成已解除', sync.hasPending(), false)
  check('上次事件口径', sync.state().lastOutcome, 'written')
}

console.log('--- A② 打开 diff 标签 + 全屏:播种后已分栏 → 幂等不写 ---')
{
  const stack = makeStack({ fullscreen: true })
  const sync = createDiffSplitSync(stack.services)
  sync.notifyLayout()
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  sync.notifyRightbar()
  stack.reviewStore().actions.navigated('t1') // split: true
  sync.notifyReview()
  check('不分栏期望=分栏现状 → 不写', sync.state().writes, 0)
  check('split 保持 true', stack.reviewStore().getSnapshot().byTab.t1.split, true)
  check('判定结果', sync.state().lastOutcome, 'aligned')
}

console.log('--- A③ 事件 ②:切到另一个 diff 标签,按当时全屏值 set 一次 ---')
{
  const stack = makeStack({ fullscreen: false })
  const sync = createDiffSplitSync(stack.services)
  sync.notifyLayout()
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  sync.notifyRightbar()
  stack.reviewStore().seed('t1', true)
  sync.notifyRightbar() // t1 已是快照 → 不再触发;此处仅确认幂等
  check('同 id 不重复触发', sync.state().writes, 0)
  stack.rightbarStore().openContent('s1', 'changes-review', 't2')
  stack.reviewStore().seed('t2', true)
  sync.notifyRightbar()
  check('切到 t2 → 写 false', stack.reviewStore().getSnapshot().byTab.t2.split, false)
  check('只写了 t2', stack.reviewStore().actions.splitCalls, ['t2'])
  check('t1 未被插件改动', stack.reviewStore().getSnapshot().byTab.t1.split, true)
}

console.log('--- A④ 切到非 diff 标签:不写且快照清空;切回 diff 按事件 ① 重设 ---')
{
  const stack = makeStack({ fullscreen: true })
  const sync = createDiffSplitSync(stack.services)
  sync.notifyLayout()
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  sync.notifyRightbar()
  stack.reviewStore().seed('t1', false) // 全屏下现状 false → 应写 true
  sync.notifyReview()
  check('切到非 diff 前:按全屏写 true', stack.reviewStore().getSnapshot().byTab.t1.split, true)
  check('写入次数', sync.state().writes, 1)

  stack.rightbarStore().openContent('s1', 'text', 't2')
  sync.notifyRightbar()
  check('切到非 diff:不写', sync.state().writes, 1)
  check('快照已清空', sync.state().lastDiffTabId, undefined)

  stack.rightbarStore().focusTab('s1', 't1')
  sync.notifyRightbar()
  check('切回 diff 重新触发(事件 ① 口径)', sync.state().lastDiffTabId, 't1')
  check('仍按全屏 true → 无变化不写', sync.state().writes, 1)
}

console.log('--- A⑤ 事件 ③:全屏翻转(当前标签是 diff) ---')
{
  const stack = makeStack({ fullscreen: false })
  const sync = createDiffSplitSync(stack.services)
  sync.notifyLayout()
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  sync.notifyRightbar()
  stack.reviewStore().seed('t1', false)
  sync.notifyReview()
  check('起步:非全屏 false 一致,不写', sync.state().writes, 0)

  stack.layoutStore().openRightbar(true, true)
  sync.notifyLayout()
  check('进入全屏 → 写 true', stack.reviewStore().getSnapshot().byTab.t1.split, true)
  check('写入次数', sync.state().writes, 1)

  stack.layoutStore().closeRightbar()
  sync.notifyLayout()
  check('退出全屏(含收起)→ 写 false', stack.reviewStore().getSnapshot().byTab.t1.split, false)
  check('写入次数', sync.state().writes, 2)
}

console.log('--- A⑥ 事件 ③ 的对象是「当时的当前 diff 标签」:当前是文件页则不写 ---')
{
  const stack = makeStack({ fullscreen: false })
  const sync = createDiffSplitSync(stack.services)
  sync.notifyLayout()
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  sync.notifyRightbar()
  stack.reviewStore().seed('t1', false)
  sync.notifyReview()
  stack.rightbarStore().openContent('s1', 'text', 't2')
  sync.notifyRightbar()
  const before = sync.state().writes
  stack.layoutStore().openRightbar(true, true)
  sync.notifyLayout()
  check('当前非 diff:事件 ③ 不写', sync.state().writes, before)
  check('t1 保持 false', stack.reviewStore().getSnapshot().byTab.t1.split, false)
}

console.log('--- A⑦ 非三事件一律不介入(手动开的分栏在下一次右栏操作后仍保留) ---')
{
  const stack = makeStack({ fullscreen: false })
  const sync = createDiffSplitSync(stack.services)
  sync.notifyLayout()
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  sync.notifyRightbar()
  stack.reviewStore().seed('t1', false)
  sync.notifyReview()
  check('起步一致', sync.state().writes, 0)

  // 用户手动点页头「左右对比」(与插件同一动作,toggle + 通知)
  stack.reviewStore().actions.toggledSplit('t1')
  check('手动开分栏', stack.reviewStore().getSnapshot().byTab.t1.split, true)
  check('插件未介入', sync.state().writes, 0)

  // 随后的各类右栏通知:标签拖拽、展开收起、拖分隔条、浮窗移动、布局宽度
  stack.rightbarStore().placeTab('s1', 't1')
  stack.rightbarStore().setExpanded('s1', false)
  stack.rightbarStore().setExpanded('s1', true)
  stack.rightbarStore().resizeSplit('s1')
  stack.rightbarStore().moveFloat('s1')
  stack.layoutStore().setSidebar(320)
  for (const _ of [0, 1, 2, 3, 4, 5]) {
    sync.notifyRightbar()
    sync.notifyLayout()
  }
  check('通知后仍未介入', sync.state().writes, 0)
  check('手动分栏被保留', stack.reviewStore().getSnapshot().byTab.t1.split, true)

  // 全屏下同样不介入:回到不分栏后进入全屏 → 事件 ③ 写一次;用户再手动关掉 → 高频通知不得纠正
  stack.reviewStore().actions.toggledSplit('t1') // 手动恢复成不分栏(false)
  stack.layoutStore().openRightbar(true, true)
  sync.notifyLayout()
  check('进入全屏按事件 ③ 写一次', sync.state().writes, 1)
  stack.reviewStore().actions.toggledSplit('t1')
  check('用户在全屏下手动关分栏', stack.reviewStore().getSnapshot().byTab.t1.split, false)
  for (const _ of [0, 1, 2, 3, 4, 5]) {
    stack.rightbarStore().resizeSplit('s1')
    sync.notifyRightbar()
    sync.notifyLayout()
  }
  check('全屏下也不持续纠正', sync.state().writes, 1)
  check('全屏下手动选择被保留', stack.reviewStore().getSnapshot().byTab.t1.split, false)
}

console.log('--- A⑧ 首次读到状态只记快照(风险 11) ---')
{
  const stack = makeStack({ fullscreen: true })
  const sync = createDiffSplitSync(stack.services)
  check('初始无快照', sync.state().lastFullscreen, undefined)
  sync.notifyLayout()
  check('首读只记快照', sync.state().lastFullscreen, true)
  check('首读不写', sync.state().writes, 0)
  sync.notifyLayout()
  check('同值再通知也不写', sync.state().writes, 0)
}

console.log('--- A⑨ §4.2 判定表(直接调 apply) ---')
{
  const at = (fullscreen, kind, split, tabId = 't1') => {
    const stack = makeStack({ fullscreen })
    const sync = createDiffSplitSync(stack.services)
    if (kind !== undefined) {
      stack.rightbarStore().openContent('s1', kind, tabId)
      if (split === 'unknown') stack.reviewStore().seedUnknown(tabId)
      else if (split !== undefined) stack.reviewStore().seed(tabId, split)
    }
    return { stack, sync }
  }

  const row1 = at(true, 'changes-review', false)
  check('全屏 + diff + false → written', row1.sync.apply(), 'written')
  check('  写入后 split', row1.stack.reviewStore().getSnapshot().byTab.t1.split, true)

  const row2 = at(true, 'changes-review', true)
  check('全屏 + diff + true → aligned', row2.sync.apply(), 'aligned')

  const row3 = at(false, 'changes-review', true)
  check('非全屏 + diff + true → written', row3.sync.apply(), 'written')
  check('  写入后 split', row3.stack.reviewStore().getSnapshot().byTab.t1.split, false)

  const row4 = at(false, 'changes-review', false)
  check('非全屏 + diff + false → aligned', row4.sync.apply(), 'aligned')

  const row5 = at(true, 'text', true)
  check('全屏 + 非 diff → no-target', row5.sync.apply(), 'no-target')

  const row6 = at(true, undefined, undefined)
  check('无标签 → no-target', row6.sync.apply(), 'no-target')

  const row7 = at(true, 'changes-review', 'unknown')
  check('桶在但 split 非布尔 → unknown', row7.sync.apply(), 'unknown')
  check('  unknown 不留待完成', row7.sync.hasPending(), false)
  check('  unknown 不写', row7.stack.reviewStore().actions.splitCalls, [])

  const row8 = at(true, 'changes-review', undefined) // 桶缺席
  check('桶缺席 → deferred', row8.sync.apply(), 'deferred')
  check('  留待完成', row8.sync.hasPending(), true)
}

console.log('--- A⑩ 推迟的解除与作废 ---')
{
  // 解除:桶诞生通知
  const stack = makeStack({ fullscreen: true })
  const sync = createDiffSplitSync(stack.services)
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  check('打开即推迟', sync.notifyRightbar(), undefined)
  check('待完成', sync.hasPending(), true)
  stack.reviewStore().seed('t1', false)
  check('槽通知解除', sync.flushPending(), 'written')
  check('写入并按全屏 true', stack.reviewStore().getSnapshot().byTab.t1.split, true)
  check('无待完成', sync.hasPending(), false)

  // 作废:目标已不是当前 diff 标签
  const stack2 = makeStack({ fullscreen: false })
  const sync2 = createDiffSplitSync(stack2.services)
  sync2.notifyLayout()
  stack2.rightbarStore().openContent('s1', 'changes-review', 't1')
  sync2.notifyRightbar()
  check('推迟中', sync2.hasPending(), true)
  stack2.rightbarStore().openContent('s1', 'text', 't2')
  sync2.notifyRightbar()
  check('切走后 flush 作废', sync2.flushPending(), 'idle')
  check('待完成已清', sync2.hasPending(), false)
  check('未写任何东西', stack2.reviewStore().actions.splitCalls, [])

  // 推迟期间全屏翻转:解除时按最新值算
  const stack3 = makeStack({ fullscreen: false })
  const sync3 = createDiffSplitSync(stack3.services)
  sync3.notifyLayout()
  stack3.rightbarStore().openContent('s1', 'changes-review', 't3')
  sync3.notifyRightbar()
  check('推迟中', sync3.hasPending(), true)
  stack3.layoutStore().openRightbar(true, true) // 待完成期间发生 ③
  sync3.notifyLayout()
  stack3.reviewStore().actions.navigated('t3') // 播种 split: true
  sync3.notifyReview()
  check('按最新全屏值 → true,不写', sync3.state().writes, 0)
  check('split', stack3.reviewStore().getSnapshot().byTab.t3.split, true)

  // 兜底重试:requestRetry 至多调度一次,flush 后解除
  const stack4 = makeStack({ fullscreen: true })
  const scheduled = []
  const sync4 = createDiffSplitSync(stack4.services, { requestRetry: (flush) => scheduled.push(flush) })
  stack4.rightbarStore().openContent('s1', 'changes-review', 't4')
  sync4.notifyRightbar()
  sync4.notifyRightbar()
  sync4.notifyReview()
  check('重试至多调度一次', scheduled.length, 1)
  stack4.reviewStore().seed('t4', false)
  scheduled[0]()
  check('重试帧内写入', stack4.reviewStore().getSnapshot().byTab.t4.split, true)
  check('写入次数', sync4.state().writes, 1)

  // 待完成与会话绑定:换会话后旧会话的待完成必须作废(哪怕新会话有同 id 的标签)
  const stack5 = makeStack({ fullscreen: false })
  const sync5 = createDiffSplitSync(stack5.services)
  sync5.notifyLayout()
  stack5.rightbarStore().openContent('s1', 'changes-review', 't1')
  sync5.notifyRightbar()
  check('s1 待完成', sync5.hasPending(), true)
  stack5.ownerOf('s2')
  stack5.rightbarStore('s2').openContent('s2', 'changes-review', 't1') // 同 id,不同会话
  stack5.reviewStore('s2').seed('t1', true)
  stack5.current.state = { key: 's2' } // 只切视图层当前会话,不触发 onSession
  check('换会话后 flush 作废', sync5.flushPending(), 'idle')
  check('待完成已清', sync5.hasPending(), false)
  check('新会话同 id 标签未被误写', stack5.reviewStore('s2').getSnapshot().byTab.t1.split, true)
}

console.log('--- A⑪ 同 tick 双通知:事件筛选 + 幂等读保证只写一次 ---')
{
  // 事件 ① 同 tick 收到两条通知(布局 + 右栏):只写一次
  const stack = makeStack({ fullscreen: true })
  const sync = createDiffSplitSync(stack.services)
  sync.notifyLayout() // 记录 true
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  stack.reviewStore().seed('t1', false)
  sync.notifyLayout()
  sync.notifyRightbar()
  check('事件 ① 双通知:恰好写一次', sync.state().writes, 1)
  check('事件 ① 双通知:split=true', stack.reviewStore().getSnapshot().byTab.t1.split, true)

  // 事件 ③ 与事件 ① 在同一 tick 指向同一标签:幂等读吃掉第二次 toggle
  const stack2 = makeStack({ fullscreen: false })
  const sync2 = createDiffSplitSync(stack2.services)
  sync2.notifyLayout() // 记录 false
  stack2.rightbarStore().openContent('s1', 'changes-review', 't1')
  stack2.reviewStore().seed('t1', false)
  stack2.layoutStore().openRightbar(true, true) // 事件 ③ 通知 + 状态翻转
  sync2.notifyLayout()
  sync2.notifyRightbar()
  check('事件 ③ + ①:历史写入只有一次 toggle', stack2.reviewStore().actions.splitCalls.length, 1)
  check('事件 ③ + ①:最终按全屏 true', stack2.reviewStore().getSnapshot().byTab.t1.split, true)
  check('事件 ③ + ①:无重复 toggle', sync2.state().writes, 1)
}

console.log('--- A⑫ 各环缺席 / 抛错:no-op 且不抛 ---')
{
  /** 建 sync 并调 apply;抛错记为 THREW:... 而不是中断脚本。 */
  const applyOf = (services) => {
    try {
      return createDiffSplitSync(services).apply()
    } catch (error) {
      return `THREW:${String(error)}`
    }
  }
  /** 造一个「当前面板停在 diff 标签、桶已播种」的栈(用于验证取数链路的中间环)。 */
  const withDiffTab = (options) => {
    const stack = makeStack(options)
    stack.rightbarStore().openContent('s1', 'changes-review', 't1')
    stack.reviewStore().seed('t1', true)
    return stack
  }

  check('slots 缺席 → unavailable', applyOf(makeStack({ noSlots: true }).services), 'unavailable')
  check('uiSession 缺席 → unavailable', applyOf(makeStack({ noUiSession: true }).services), 'unavailable')

  const noResolve = makeStack()
  delete noResolve.services.slots.resolveStore
  check('无 resolveStore → unavailable', applyOf(noResolve.services), 'unavailable')

  check('entries 抛错 → unavailable', applyOf(makeStack({ entriesThrows: true }).services), 'unavailable')
  check('resolveStore 抛错 → unavailable', applyOf(makeStack({ resolveThrows: true }).services), 'unavailable')
  check('布局 store 缺席 → unavailable', applyOf(makeStack({ layout: false }).services), 'unavailable')
  check('bindingSource 抛错 → 链路不可用(no-target)', applyOf(withDiffTab({ bindingThrows: true }).services), 'no-target')
  check('变更审阅注册项缺席 → unavailable', applyOf(withDiffTab({ review: false }).services), 'unavailable')
  check('toggledSplit 抛错 → deferred(不崩)', applyOf(withDiffTab({ toggleThrows: true }).services), 'deferred')

  // 形状漂移:布局快照没有布尔 rightbarFullscreen / 审阅快照没有 byTab / actions 缺席
  const badLayout = makeStack()
  badLayout.layoutStore().state = { layoutInfo: { sidebar: 280, viewportWidth: 1440, rightbarFullscreen: 'yes' } }
  check('布局形状漂移 → unavailable', applyOf(badLayout.services), 'unavailable')

  const badReview = withDiffTab()
  badReview.reviewStore().state = { buckets: {} }
  check('审阅形状漂移 → unavailable', applyOf(badReview.services), 'unavailable')

  const noActions = withDiffTab()
  delete noActions.reviewStore().actions
  check('动作面缺席 → unavailable', applyOf(noActions.services), 'unavailable')

  // root 上混入其它 store(问答草稿等):按形状跳到布局 store,插件仍正常工作
  const mixed = withDiffTab()
  const alienHandle = {}
  const alienInstance = { getSnapshot: () => ({ draft: { selected: [] } }), subscribe: () => () => {} }
  const realEntries = mixed.slots.entries
  const realResolve = mixed.slots.resolveStore
  mixed.slots.entries = (key) => (key === 'root' ? [{ store: alienHandle, options: {} }, ...realEntries(key)] : realEntries(key))
  mixed.slots.resolveStore = (handle, binding) => (handle === alienHandle ? alienInstance : realResolve(handle, binding))
  check('root 混入其它 store 仍按形状认布局 store', applyOf(mixed.services), 'written')

  // 服务全缺:订阅中枢 rebuild / dispose 也不抛
  checkNoThrow('订阅中枢:服务全缺 rebuild/dispose 不抛', () => {
    const hub = createSubscriptionHub({
      services: { slots: undefined, sessions: undefined, uiSession: undefined },
      onLayout: () => {}, onRightbar: () => {}, onReview: () => {}, onEntries: () => {}, onSession: () => {},
    })
    hub.rebuild()
    hub.dispose()
  })
}

console.log('--- A⑬ 订阅装配:建立 / 重建 / 退订 / 换会话 ---')
{
  const stack = makeStack({ fullscreen: false })
  const events = []
  const sync = createDiffSplitSync(stack.services)
  let hub
  hub = createSubscriptionHub({
    services: stack.services,
    onLayout: () => { events.push('layout'); sync.notifyLayout() },
    onRightbar: () => { events.push('rightbar'); sync.notifyRightbar() },
    onReview: () => { events.push('review'); sync.notifyReview() },
    onEntries: () => { hub.rebuild(); events.push('entries'); sync.notifyEntries() },
    onSession: () => { events.push('session'); sync.notifySession(); hub.rebuild() },
  })
  hub.rebuild()
  check('布局 store 订阅 1', stack.layoutStore().listenerCount, 1)
  check('右栏 store 订阅 1', stack.rightbarStore().listenerCount, 1)
  check('审阅 store 订阅 1', stack.reviewStore().listenerCount, 1)
  check('会话源订阅 1', stack.current.listenerCount, 1)
  check('slots 三键订阅', [stack.slotListenerCount('root'), stack.slotListenerCount('rightbar.session'), stack.slotListenerCount('sidebar.right.pane.tab')], [1, 1, 1])

  hub.rebuild()
  check('重建后不叠加(布局)', stack.layoutStore().listenerCount, 1)
  check('重建后不叠加(slots)', stack.slotListenerCount('root'), 1)

  // 端到端:打开 diff(非全屏)→ 推迟;播种 → 非全屏不分栏
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  check('右栏通知已到达', events.includes('rightbar'), true)
  check('推迟中', sync.hasPending(), true)
  stack.reviewStore().actions.navigated('t1')
  check('审阅通知已到达', events.includes('review'), true)
  check('split=false', stack.reviewStore().getSnapshot().byTab.t1.split, false)
  check('写入一次', sync.state().writes, 1)

  // 换会话:旧会话订阅退掉,新会话订阅建立,并按新会话重新判定
  stack.ownerOf('s2')
  stack.rightbarStore('s2').openContent('s2', 'changes-review', 'x1')
  stack.reviewStore('s2').seed('x1', true)
  stack.current.state = { key: 's2' }
  stack.current.notify()
  check('会话通知已到达', events.includes('session'), true)
  check('旧会话右栏订阅已退', stack.rightbarStore('s1').listenerCount, 0)
  check('新会话右栏订阅已建', stack.rightbarStore('s2').listenerCount, 1)
  check('换会话按新会话事件 ① 重设(非全屏 → false)', stack.reviewStore('s2').getSnapshot().byTab.x1.split, false)
  check('旧会话 split 不动', stack.reviewStore('s1').getSnapshot().byTab.t1.split, false)

  // 槽位重注册通知:解除待完成并重建订阅
  stack.rightbarStore('s2').openContent('s2', 'changes-review', 'x2')
  check('新会话第二个标签推迟', sync.hasPending(), true)
  stack.reviewStore('s2').seed('x2', true)
  stack.slotNotify('sidebar.right.pane.tab')
  check('槽位通知已解除待完成', sync.hasPending(), false)
  check('x2 已按非全屏写 false', stack.reviewStore('s2').getSnapshot().byTab.x2.split, false)

  hub.dispose()
  check('退订后布局 0', stack.layoutStore().listenerCount, 0)
  check('退订后右栏 0', stack.rightbarStore('s2').listenerCount, 0)
  check('退订后审阅 0', stack.reviewStore('s2').listenerCount, 0)
  check('退订后会话源 0', stack.current.listenerCount, 0)
  check('退订后 slots 0', stack.slotListenerCount('root'), 0)
}

// ---- B. 构建产物装配 -------------------------------------------------------

console.log('--- B① lib/client.js 注册与声明 ---')
let registration = null
globalThis.window = { __ModuleLoader__: { load: (reg) => { registration = reg } } }
;(0, eval)(readFileSync(join(here, 'lib', 'client.js'), 'utf8'))
check('registration 非空', registration !== null, true)
check('模块 id', registration.id, 'dsh-rightbar-diff-split')
const plugin = registration.factory(() => { throw new Error('unexpected external require') })
check('插件名', plugin.name, 'dsh-rightbar-diff-split')
check('服务 inject', plugin.inject, ['slots', 'sessions', 'uiSession'])

console.log('--- B② apply 装配:订阅建立 + 打开 diff 按全屏值设分栏 + ctx.effect 退订 ---')
{
  const stack = makeStack({ fullscreen: false })
  // 面板已经开着并停在一个 diff 标签上、split 现状 true:插件生效时不做首帧对齐
  const rightbar = stack.rightbarStore()
  rightbar.openContent('s1', 'changes-review', 't1')
  stack.reviewStore().seed('t1', true)

  const disposers = []
  const ctx = {
    get: (serviceName) => ({ slots: stack.services.slots, sessions: stack.services.sessions, uiSession: stack.services.uiSession })[serviceName],
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  }
  plugin.apply(ctx)
  check('apply 后布局 store 已订阅', stack.layoutStore().listenerCount, 1)
  check('apply 后右栏 store 已订阅', rightbar.listenerCount, 1)
  check('apply 后审阅 store 已订阅', stack.reviewStore().listenerCount, 1)
  check('生效时不补写既有状态', stack.reviewStore().actions.splitCalls, [])
  check('effect 已登记 disposer', disposers.length, 1)

  // 事件 ③:进入全屏 → 分栏
  stack.layoutStore().openRightbar(true, true)
  check('进入全屏 → split=true', stack.reviewStore().getSnapshot().byTab.t1.split, true)
  // 退出全屏 → 不分栏
  stack.layoutStore().closeRightbar()
  check('退出全屏 → split=false', stack.reviewStore().getSnapshot().byTab.t1.split, false)

  // 事件 ②:切到另一个 diff 标签(非全屏 → 不分栏);桶已在(页 body 早前挂载过)
  stack.reviewStore().seed('t2', true)
  rightbar.openContent('s1', 'changes-review', 't2')
  check('切到 t2 → split=false', stack.reviewStore().getSnapshot().byTab.t2.split, false)

  // 事件 ①:全屏下打开第三个 diff 标签(桶未播种 → 推迟,播种后设分栏)
  stack.layoutStore().openRightbar(true, true)
  rightbar.openContent('s1', 'changes-review', 't3')
  check('打开即推迟', stack.reviewStore().getSnapshot().byTab.t3, undefined)
  stack.reviewStore().actions.navigated('t3')
  check('播种后按全屏设分栏', stack.reviewStore().getSnapshot().byTab.t3.split, true)

  for (const dispose of disposers) dispose()
  check('HMR 退订:布局 store 0', stack.layoutStore().listenerCount, 0)
  check('HMR 退订:右栏 store 0', rightbar.listenerCount, 0)
  stack.layoutStore().openRightbar(true, false) // 退订后不再介入
  check('退订后不再写入', stack.reviewStore().getSnapshot().byTab.t3.split, true)
}

console.log('--- B③ apply 容错:ctx 缺 get / 服务全缺 / 无 effect 不抛 ---')
{
  globalThis.window = { __ModuleLoader__: { load: () => {} } }
  checkNoThrow('ctx 全缺', () => plugin.apply({}))
  checkNoThrow('ctx.get 全返回 undefined', () => plugin.apply({ get: () => undefined }))
  checkNoThrow('无 ctx.effect(仍装配订阅)', () => {
    const stack = makeStack({ fullscreen: true })
    plugin.apply({ get: (serviceName) => ({ slots: stack.services.slots, sessions: stack.services.sessions, uiSession: stack.services.uiSession })[serviceName] })
    check('无 effect 也能订阅', stack.layoutStore().listenerCount, 1)
  })
  checkNoThrow('二次 apply(HMR 重建)不抛', () => {
    const stack = makeStack({ fullscreen: true })
    const ctx = { get: (serviceName) => ({ slots: stack.services.slots, sessions: stack.services.sessions, uiSession: stack.services.uiSession })[serviceName] }
    plugin.apply(ctx)
    plugin.apply(ctx)
    check('两次 apply 各自订阅一份', stack.layoutStore().listenerCount, 2)
  })
}

console.log(failures === 0 ? '\nall diff-split probes passed' : `\n${failures} probe(s) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
