/**
 * 诊断脚本(非插件产物):纯 Node,无浏览器、无 DOM、无定时器。三部分:
 *   A. 直接以 Node Type Stripping 载入 src/diff-split.ts + src/subscriptions.ts,用类方法形态的
 *      store / slots 桩驱动「持续回正」:判定表全部行、**点击回正的同步性**(用户 toggle 返回后的
 *      下一条语句就断言已回正)、稳态不失写、写失败自愈、加载即对齐、三条通知路径各自都能回正、
 *      订阅 A–E 的建立 / 重建 / 换会话重绑 / 退订、各环缺席或抛错时 no-op;
 *   B. 用 window.__ModuleLoader__ 桩载入构建产物 lib/client.js,验证包名 / inject 声明与 apply 装配
 *      (含加载即对齐、五路订阅、ctx.effect 退订)与产物级端到端;
 *   C. ctx 全缺 / 无 effect / 二次 apply(HMR 重建)等装配容错。
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
  /** 以下都是「非发散」通知:改 bySession 但当前标签与全屏值都没变。 */
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
  /** 上游 navigated:首次播种 split: true(左右对比),并提交 store(⇒ 通知)。 */
  navigated(tabId) {
    const byTab = this.store.state.byTab
    if (byTab[tabId] === undefined) byTab[tabId] = { index: 0, split: true, wrap: false, navigated: 1 }
    else byTab[tabId].navigated = 2
    this.store.notify()
  }
  /** 上游页头按钮 / 热键调用的都是这一个动作。 */
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
  /** 测试用:绕过 actions 直接改桶(不通知),制造「无人通知的发散」。 */
  forceSplit(tabId, split) {
    this.state.byTab[tabId].split = split
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
 * @returns { services, current, owners, ownerOf, layoutStore, rightbarStore, reviewStore,
 *   layoutSeat, rightbarSeat, reviewSeat, instanceFor, slotListenerCount, slotNotify, slots }
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

  /** 活实例的直接入口(测试要 patch 实例的 actions 面,故不能只留函数式包装)。 */
  const instanceFor = (seat, key) => seat.instanceFor(seat.scope === 'root' ? undefined : key)

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
    layoutStore: () => instanceFor(layoutSeat, undefined),
    rightbarStore: (id = sessionId) => instanceFor(rightbarSeat, id),
    reviewStore: (id = sessionId) => instanceFor(reviewSeat, id),
    layoutSeat,
    rightbarSeat,
    reviewSeat,
    instanceFor,
    slotListenerCount: (key) => slotListeners.get(key)?.size ?? 0,
    /** 触发某个 slot 的注册变化通知(上游 slots.subscribe 是 microtask 批量,这里同步驱动)。 */
    slotNotify: (key) => {
      for (const fn of [...(slotListeners.get(key) ?? [])]) fn()
    },
    slots,
  }
}

/** 建一个「当前会话当前面板停在 diff 标签」的栈;seedSplit 省略则桶缺席(未播种)。 */
function stackWithDiff(options = {}, seedSplit = undefined) {
  const stack = makeStack(options)
  stack.rightbarStore().openContent(options.sessionId ?? 's1', 'changes-review', options.tabId ?? 't1')
  if (seedSplit !== undefined) stack.reviewStore().seed(options.tabId ?? 't1', seedSplit)
  return stack
}

/** 按产品装配把核心接到订阅中枢上(与 src/client.ts 同构):A/B/E 直接回正,C/D 先重建再回正。 */
function wire(stack) {
  const sync = createDiffSplitSync(stack.services)
  let hub
  hub = createSubscriptionHub({
    services: stack.services,
    onNotify: () => {
      sync.drive()
    },
    onRebuild: () => {
      hub.rebuild()
      sync.drive()
    },
  })
  hub.rebuild()
  return { sync, hub }
}

/** 直接调 drive() 并把抛错记为 THREW:...(容错场景不中断脚本)。 */
function driveOf(services) {
  try {
    return createDiffSplitSync(services).drive()
  } catch (error) {
    return `THREW:${String(error)}`
  }
}

// ---- A. 判定与回正 ----------------------------------------------------------

console.log('--- A① 打开 diff + 非全屏:桶缺席回 no-bucket,播种通知后收敛 ---')
{
  const stack = makeStack({ fullscreen: false })
  const { sync, hub } = wire(stack)
  check('桶未播种前 drive:no-target', sync.drive(), 'no-target')
  check('首次 drive:无写入', sync.state().writes, 0)
  check('全屏诊断值已读到', sync.state().fullscreen, false)
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  check('桶缺席 → no-bucket', sync.drive(), 'no-bucket')
  check('未写任何东西', stack.reviewStore().actions.splitCalls, [])
  check('不留任何待完成状态(state 只有 3 个只读字段)', Object.keys(sync.state()).sort(), ['fullscreen', 'lastOutcome', 'writes'])
  check('no-bucket 未计数', sync.state().writes, 0)

  stack.reviewStore().actions.navigated('t1') // 上游播种 split: true,并提交 store(⇒ 通知我们)
  check('播种通知后按非全屏收敛', stack.reviewStore().getSnapshot().byTab.t1.split, false)
  check('写入次数', sync.state().writes, 1)
  check('判定结果', sync.state().lastOutcome, 'written')
  hub.dispose()
}

console.log('--- A② 全屏下打开:播种 split=true → aligned,零写入 ---')
{
  const stack = makeStack({ fullscreen: true })
  const { sync, hub } = wire(stack)
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  check('桶缺席', sync.drive(), 'no-bucket')
  stack.reviewStore().actions.navigated('t1') // split: true,并提交 store
  check('期望=分栏现状 → 不写', sync.state().writes, 0)
  check('split 保持 true', stack.reviewStore().getSnapshot().byTab.t1.split, true)
  check('判定结果', sync.state().lastOutcome, 'aligned')
  hub.dispose()
}

console.log('--- A③ 核心:点击页头按钮 → 同一次同步通知内回正(非全屏) ---')
{
  const stack = stackWithDiff({ fullscreen: false }, false)
  const review = stack.reviewStore()
  const { sync, hub } = wire(stack)
  sync.drive()
  check('起点:非全屏 + split=false 已对齐', sync.state().lastOutcome, 'aligned')

  // 「用户点击页头按钮」= 直接调那个动作(桩会同步 notify)。下一句不许 await / 不许 flush 定时器。
  review.actions.toggledSplit('t1')
  check('点击返回后立刻:split 已回正为 false', review.getSnapshot().byTab.t1.split, false)
  check('点击返回后立刻:回正 1 次', sync.state().writes, 1)
  check('点击返回后立刻:toggle 共 2 次(用户 1 + 纠正 1)', review.actions.splitCalls.length, 2)
  check('点击返回后立刻:无 unbound 调用(写面以方法形式调用)', review.actions.unboundCalls, 0)
  hub.dispose()
}

console.log('--- A③b 核心:点击页头按钮 → 同一次同步通知内回正(全屏) ---')
{
  const stack = stackWithDiff({ fullscreen: true }, true)
  const review = stack.reviewStore()
  const { sync, hub } = wire(stack)
  sync.drive()
  check('起点:全屏 + split=true 已对齐', sync.state().lastOutcome, 'aligned')

  review.actions.toggledSplit('t1')
  check('点击返回后立刻:split 已回正为 true', review.getSnapshot().byTab.t1.split, true)
  check('点击返回后立刻:回正 1 次', sync.state().writes, 1)
  check('点击返回后立刻:toggle 共 2 次', review.actions.splitCalls.length, 2)

  // 再点一次也一样:没有「上次写入值」记忆,唯一判据是现读快照
  review.actions.toggledSplit('t1')
  check('再点一次:仍然被回正', review.getSnapshot().byTab.t1.split, true)
  check('再点一次:回正 2 次', sync.state().writes, 2)
  check('再点一次:toggle 共 4 次', review.actions.splitCalls.length, 4)
  hub.dispose()
}

console.log('--- A④ 稳态:各类非发散通知连续跑,不写也不变 ---')
{
  const stack = makeStack({ fullscreen: false })
  const sync = createDiffSplitSync(stack.services)
  const review = stack.reviewStore()
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  review.seed('t1', false)
  sync.drive()
  check('起点已对齐', sync.state().writes, 0)

  const outcomes = []
  for (let round = 0; round < 6; round += 1) {
    stack.rightbarStore().placeTab('s1', 't1')
    outcomes.push(sync.drive())
    stack.rightbarStore().setExpanded('s1', round % 2 === 0)
    outcomes.push(sync.drive())
    stack.rightbarStore().resizeSplit('s1')
    outcomes.push(sync.drive())
    stack.rightbarStore().moveFloat('s1')
    outcomes.push(sync.drive())
    stack.layoutStore().setSidebar(300 + round)
    outcomes.push(sync.drive())
    stack.layoutStore().notify()
    outcomes.push(sync.drive())
  }
  check('稳态零写入', sync.state().writes, 0)
  check('split 未变', review.getSnapshot().byTab.t1.split, false)
  check('每轮都是 aligned', [...new Set(outcomes)], ['aligned'])
  check('轮数', outcomes.length, 36)
}

console.log('--- A⑤ 判定表(直接调 drive) ---')
{
  // written / aligned 四象限
  const on = (fullscreen, split) => {
    const stack = stackWithDiff({ fullscreen }, split)
    return { stack, sync: createDiffSplitSync(stack.services) }
  }
  const row1 = on(true, false)
  check('全屏 + diff + false → written', row1.sync.drive(), 'written')
  check('  写入后 split=true', row1.stack.reviewStore().getSnapshot().byTab.t1.split, true)
  check('  写入计数 1', row1.sync.state().writes, 1)
  const row2 = on(true, true)
  check('全屏 + diff + true → aligned', row2.sync.drive(), 'aligned')
  const row3 = on(false, true)
  check('非全屏 + diff + true → written', row3.sync.drive(), 'written')
  check('  写入后 split=false', row3.stack.reviewStore().getSnapshot().byTab.t1.split, false)
  const row4 = on(false, false)
  check('非全屏 + diff + false → aligned', row4.sync.drive(), 'aligned')

  // no-bucket
  const rowBucket = createDiffSplitSync(stackWithDiff({ fullscreen: true }).services)
  check('桶缺席 → no-bucket', rowBucket.drive(), 'no-bucket')

  // unknown
  const rowUnknown = (() => {
    const stack = stackWithDiff({ fullscreen: true }, true)
    stack.reviewStore().seedUnknown('t1')
    return { stack, sync: createDiffSplitSync(stack.services) }
  })()
  check('split 非布尔 → unknown', rowUnknown.sync.drive(), 'unknown')
  check('  unknown 不写', rowUnknown.stack.reviewStore().actions.splitCalls, [])

  // no-target
  const rowKind = stackWithDiff({ fullscreen: true }, true)
  rowKind.rightbarStore().openContent('s1', 'text', 't2')
  check('当前标签非 changes-review → no-target', createDiffSplitSync(rowKind.services).drive(), 'no-target')
  const rowNoTab = makeStack({ fullscreen: true })
  check('无标签 → no-target', createDiffSplitSync(rowNoTab.services).drive(), 'no-target')
  const rowNoPane = (() => {
    const stack = makeStack({ fullscreen: true })
    stack.rightbarStore().surface('s1').layout.activePaneId = 'pane-9' // 面板不存在
    return stack
  })()
  check('面板形状漂移 → no-target', createDiffSplitSync(rowNoPane.services).drive(), 'no-target')
}

console.log('--- A⑥ unavailable:取数链任一环读不到 ---')
{
  const withDiff = (options) => stackWithDiff(options, true)
  check('slots 缺席', driveOf(makeStack({ noSlots: true }).services), 'unavailable')
  check('uiSession 缺席', driveOf(makeStack({ noUiSession: true }).services), 'unavailable')
  // sessions 缺席时「当前标签」这一环先读不到 ⇒ no-target(判定顺序:先全屏值、后当前标签)
  check('sessions 缺席', driveOf({ ...makeStack().services, sessions: undefined }), 'no-target')
  check('会话绑定不可解析(未注册的会话 id)', driveOf({ ...makeStack().services, sessions: { binding: () => undefined } }), 'no-target')
  check('bindingSource 抛错', driveOf(withDiff({ bindingThrows: true }).services), 'no-target')

  const noResolve = makeStack()
  delete noResolve.services.slots.resolveStore
  check('无 resolveStore', driveOf(noResolve.services), 'unavailable')

  check('entries 抛错', driveOf(makeStack({ entriesThrows: true }).services), 'unavailable')
  check('resolveStore 抛错', driveOf(makeStack({ resolveThrows: true }).services), 'unavailable')
  check('布局 store 缺席', driveOf(makeStack({ layout: false }).services), 'unavailable')
  check('右栏 store 缺席', driveOf(withDiff({ rightbar: false }).services), 'no-target')
  check('变更审阅注册项缺席', driveOf(withDiff({ review: false }).services), 'unavailable')
  // 动作面缺席(桩里 toggledSplit 是原型方法,故用 undefined 屏蔽掉它)
  check('toggledSplit 缺席', (() => {
    const stack = withDiff()
    stack.reviewStore().actions.toggledSplit = undefined
    return driveOf(stack.services)
  })(), 'unavailable')

  // 形状漂移
  const badLayout = makeStack()
  badLayout.layoutStore().state = { layoutInfo: { sidebar: 280, viewportWidth: 1440, rightbarFullscreen: 'yes' } }
  check('布局快照 rightbarFullscreen 非布尔', driveOf(badLayout.services), 'unavailable')
  const noLayoutInfo = makeStack()
  noLayoutInfo.layoutStore().state = { viewport: {} }
  check('布局快照缺 layoutInfo', driveOf(noLayoutInfo.services), 'unavailable')
  const emptyRoot = makeStack()
  emptyRoot.layoutStore().state = { layoutInfo: { sidebar: 280 } }
  check('root 无形状匹配项', driveOf(emptyRoot.services), 'unavailable')
  const badReview = withDiff()
  badReview.reviewStore().state = { buckets: {} }
  check('审阅快照缺 byTab', driveOf(badReview.services), 'unavailable')
  const noActions = withDiff()
  delete noActions.reviewStore().actions
  check('审阅实例缺 actions', driveOf(noActions.services), 'unavailable')
  const badRightbar = withDiff()
  badRightbar.rightbarStore().state = { sessions: {} }
  check('右栏快照缺 bySession', driveOf(badRightbar.services), 'no-target')
  const badSessionKey = makeStack()
  badSessionKey.current.state = { key: '' }
  check('当前会话 key 为空', driveOf(badSessionKey.services), 'unavailable')

  // root 上混入其它 store(问答草稿等):按形状跳到布局 store,插件仍正常工作
  const mixed = withDiff({ fullscreen: true })
  const alienHandle = {}
  const alienInstance = { getSnapshot: () => ({ draft: { selected: [] } }), subscribe: () => () => {} }
  const realEntries = mixed.slots.entries
  const realResolve = mixed.slots.resolveStore
  mixed.slots.entries = (key) => (key === 'root' ? [{ store: alienHandle, options: {} }, ...realEntries(key)] : realEntries(key))
  mixed.slots.resolveStore = (handle, binding) => (handle === alienHandle ? alienInstance : realResolve(handle, binding))
  mixed.reviewStore().forceSplit('t1', false) // 发散,验证回的确实是真布局 store 的全屏值
  check('root 混入其它 store 仍按形状认布局 store', driveOf(mixed.services), 'written')
  check('  按全屏 true 回正', mixed.reviewStore().getSnapshot().byTab.t1.split, true)

  // 快照读取抛错
  const throwSnap = withDiff()
  throwSnap.layoutStore().getSnapshot = () => {
    throw new Error('snapshot unavailable')
  }
  check('getSnapshot 抛错', driveOf(throwSnap.services), 'unavailable')
}

console.log('--- A⑦ 写失败自愈:write-failed 后由下一次通知收敛 ---')
{
  const stack = stackWithDiff({ fullscreen: true }, true) // 全屏 + split=true → 已对齐
  const review = stack.reviewStore()
  const { sync, hub } = wire(stack)
  sync.drive()
  check('起点已对齐', sync.state().lastOutcome, 'aligned')

  // 绕过 actions 直接把桶改成与全屏值相反(不 notify):没人通知,故我们不介入
  review.forceSplit('t1', false)
  check('绕过 actions 的发散:无人通知时不动', review.getSnapshot().byTab.t1.split, false)

  review.actions.toggleThrows = true
  check('写入抛错 → write-failed(不抛)', sync.drive(), 'write-failed')
  check('  状态未变', review.getSnapshot().byTab.t1.split, false)
  check('  未计数', sync.state().writes, 0)
  check('  未留待完成字段', Object.keys(sync.state()).sort(), ['fullscreen', 'lastOutcome', 'writes'])

  review.actions.toggleThrows = false
  review.notify() // 下一次通知(走订阅的 onNotify)
  check('恢复后由下一次通知收敛', review.getSnapshot().byTab.t1.split, true)
  check('收敛计数 1', sync.state().writes, 1)

  // 桶真的缺席时 toggledSplit 抛错(上游 bucket() 抛)也一样只是 write-failed
  const stack2 = stackWithDiff({ fullscreen: true }, true)
  const { sync: sync2, hub: hub2 } = wire(stack2)
  const actions = stack2.reviewStore().actions
  const original = actions.toggledSplit
  actions.toggledSplit = function (tabId) {
    void tabId
    throw new Error('no review state for tab')
  }
  stack2.reviewStore().forceSplit('t1', false)
  check('上游 bucket() 抛 → write-failed', sync2.drive(), 'write-failed')
  actions.toggledSplit = original
  stack2.reviewStore().notify() // 下一次通知即自愈
  check('随后即收敛', stack2.reviewStore().getSnapshot().byTab.t1.split, true)
  check('收敛计数', sync2.state().writes, 1)
  hub.dispose()
  hub2.dispose()
}

console.log('--- A⑧ 加载 / 首帧即对齐(不再有「生效时不补写」) ---')
{
  const stack = stackWithDiff({ fullscreen: true }, false) // 已发散:全屏但 split=false
  const sync = createDiffSplitSync(stack.services)
  check('第一次 drive 就回正', sync.drive(), 'written')
  check('split=true', stack.reviewStore().getSnapshot().byTab.t1.split, true)
  check('写入计数 1', sync.state().writes, 1)

  const stack2 = stackWithDiff({ fullscreen: false }, true)
  const sync2 = createDiffSplitSync(stack2.services)
  check('反向也已对齐口径:第一次 drive 回正', sync2.drive(), 'written')
  check('split=false', stack2.reviewStore().getSnapshot().byTab.t1.split, false)
}

console.log('--- A⑨ 持续:三条 store 通知路径各自都能回正 ---')
{
  /** 造一个已接订阅的栈,绕过 actions 制造成发散(不通知),再只发指定来源的那一次通知。 */
  const diverge = (fullscreen, split) => {
    const stack = stackWithDiff({ fullscreen }, split)
    const { sync, hub } = wire(stack)
    stack.reviewStore().forceSplit('t1', !split) // 发散,且这个改动本身不通知
    return { stack, sync, hub }
  }

  // 只驱动「布局通知」
  const byLayout = diverge(true, true)
  byLayout.stack.layoutStore().setSidebar(320) // 布局 store 的提交(全屏值不变)
  check('仅布局通知也能回正', byLayout.stack.reviewStore().getSnapshot().byTab.t1.split, true)
  check('  回正计数', byLayout.sync.state().writes, 1)
  byLayout.hub.dispose()

  // 只驱动「右栏通知」
  const byRightbar = diverge(false, false)
  byRightbar.stack.rightbarStore().resizeSplit('s1')
  check('仅右栏通知也能回正', byRightbar.stack.reviewStore().getSnapshot().byTab.t1.split, false)
  check('  回正计数', byRightbar.sync.state().writes, 1)
  byRightbar.hub.dispose()

  // 只驱动「审阅通知」
  const byReview = diverge(true, true)
  byReview.stack.reviewStore().notify()
  check('仅审阅通知也能回正', byReview.stack.reviewStore().getSnapshot().byTab.t1.split, true)
  check('  回正计数', byReview.sync.state().writes, 1)
  byReview.hub.dispose()

  // 全屏翻转(布局通知)本身就是发散源
  const flip = stackWithDiff({ fullscreen: false }, false)
  const { sync: flipSync, hub: flipHub } = wire(flip)
  flipSync.drive()
  flip.layoutStore().openRightbar(true, true)
  check('进入全屏 → 分栏', flip.reviewStore().getSnapshot().byTab.t1.split, true)
  flip.layoutStore().closeRightbar()
  check('退出全屏 → 不分栏', flip.reviewStore().getSnapshot().byTab.t1.split, false)
  check('两次回正', flipSync.state().writes, 2)
  flipHub.dispose()
}

console.log('--- A⑩ 订阅装配 A–E:建立 / 重建不叠加 / 换会话重绑 / 拓扑通知先重建再回正 ---')
{
  const stack = makeStack({ fullscreen: false })
  const events = []
  const sync = createDiffSplitSync(stack.services)
  let hub
  hub = createSubscriptionHub({
    services: stack.services,
    onNotify: () => {
      events.push('notify')
      sync.drive()
    },
    onRebuild: () => {
      events.push('rebuild')
      hub.rebuild()
      sync.drive()
    },
  })
  hub.rebuild()
  check('A 布局 store 订阅 1', stack.layoutStore().listenerCount, 1)
  check('B 右栏 store 订阅 1', stack.rightbarStore().listenerCount, 1)
  check('E 审阅 store 订阅 1', stack.reviewStore().listenerCount, 1)
  check('C 会话源订阅 1', stack.current.listenerCount, 1)
  check('D slots 三键各 1', [stack.slotListenerCount('root'), stack.slotListenerCount('rightbar.session'), stack.slotListenerCount('sidebar.right.pane.tab')], [1, 1, 1])

  hub.rebuild()
  check('重建不叠加(布局)', stack.layoutStore().listenerCount, 1)
  check('重建不叠加(右栏)', stack.rightbarStore().listenerCount, 1)
  check('重建不叠加(审阅)', stack.reviewStore().listenerCount, 1)
  check('重建不叠加(slots)', stack.slotListenerCount('root'), 1)

  // 端到端(非全屏):打开 diff → 桶缺席 no-bucket;播种 → 收敛 false
  stack.rightbarStore().openContent('s1', 'changes-review', 't1')
  check('右栏通知走 onNotify', events.at(-1), 'notify')
  check('播种前未写', stack.reviewStore().actions.splitCalls, [])
  stack.reviewStore().actions.navigated('t1')
  check('审阅通知走 onNotify', events.at(-1), 'notify')
  check('播种后 split=false', stack.reviewStore().getSnapshot().byTab.t1.split, false)
  check('回正一次', sync.state().writes, 1)

  // D:slots 键通知 → 先重建再回正
  stack.rightbarStore().openContent('s1', 'changes-review', 't2')
  stack.reviewStore().seed('t2', true)
  events.length = 0
  stack.slotNotify('sidebar.right.pane.tab')
  check('slots 通知顺序 = 先重建再回正', events, ['rebuild', 'notify'])
  check('槽位通知后 t2 已收敛 false', stack.reviewStore().getSnapshot().byTab.t2.split, false)

  // C:换会话 → 旧会话订阅退掉、新会话订阅建立,并按新会话当前标签回正
  stack.ownerOf('s2')
  stack.rightbarStore('s2').openContent('s2', 'changes-review', 'x1')
  stack.reviewStore('s2').seed('x1', true)
  stack.current.state = { key: 's2' }
  events.length = 0
  stack.current.notify()
  check('会话通知顺序 = 先重建再回正', events, ['rebuild', 'notify'])
  check('旧会话右栏订阅已退', stack.rightbarStore('s1').listenerCount, 0)
  check('旧会话审阅订阅已退', stack.reviewStore('s1').listenerCount, 0)
  check('新会话右栏订阅已建', stack.rightbarStore('s2').listenerCount, 1)
  check('新会话审阅订阅已建', stack.reviewStore('s2').listenerCount, 1)
  check('按新会话当前标签回正(非全屏 → false)', stack.reviewStore('s2').getSnapshot().byTab.x1.split, false)
  check('旧会话 split 不动', stack.reviewStore('s1').getSnapshot().byTab.t1.split, false)

  // 退订后归零且不再介入
  hub.dispose()
  check('退订后布局 0', stack.layoutStore().listenerCount, 0)
  check('退订后右栏 0', stack.rightbarStore('s2').listenerCount, 0)
  check('退订后审阅 0', stack.reviewStore('s2').listenerCount, 0)
  check('退订后会话源 0', stack.current.listenerCount, 0)
  check('退订后 slots 0', stack.slotListenerCount('root'), 0)
  const writesAfterDispose = sync.state().writes
  stack.layoutStore().openRightbar(true, true)
  check('退订后不再介入', sync.state().writes, writesAfterDispose)

  // 服务全缺:rebuild / dispose 也不抛
  checkNoThrow('订阅中枢:服务全缺 rebuild/dispose 不抛', () => {
    const bare = createSubscriptionHub({
      services: { slots: undefined, sessions: undefined, uiSession: undefined },
      onNotify: () => {},
      onRebuild: () => {},
    })
    bare.rebuild()
    bare.dispose()
  })
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

console.log('--- B② apply 装配:五路订阅 + ctx.effect + 加载即对齐 ---')
{
  // 面板已经开着并停在一个 diff 标签上、全屏且 split 发散:apply 时立刻回正
  const stack = stackWithDiff({ fullscreen: true }, false)
  const disposers = []
  const ctx = {
    get: (serviceName) => ({ slots: stack.services.slots, sessions: stack.services.sessions, uiSession: stack.services.uiSession })[serviceName],
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  }
  plugin.apply(ctx)
  check('加载即对齐:split=true', stack.reviewStore().getSnapshot().byTab.t1.split, true)
  check('加载即对齐:toggle 1 次', stack.reviewStore().actions.splitCalls, ['t1'])
  check('apply 后布局 store 已订阅', stack.layoutStore().listenerCount, 1)
  check('apply 后右栏 store 已订阅', stack.rightbarStore().listenerCount, 1)
  check('apply 后审阅 store 已订阅', stack.reviewStore().listenerCount, 1)
  check('apply 后会话语义源已订阅', stack.current.listenerCount, 1)
  check('apply 后 slots 三键已订阅', [stack.slotListenerCount('root'), stack.slotListenerCount('rightbar.session'), stack.slotListenerCount('sidebar.right.pane.tab')], [1, 1, 1])
  check('effect 已登记 1 个 disposer', disposers.length, 1)

  for (const dispose of disposers) dispose()
  check('HMR 退订:布局 store 0', stack.layoutStore().listenerCount, 0)
  check('HMR 退订:右栏 store 0', stack.rightbarStore().listenerCount, 0)
  stack.layoutStore().openRightbar(true, false) // 退订后不再介入
  check('退订后不再介入', stack.reviewStore().getSnapshot().byTab.t1.split, true)
}

console.log('--- B③ 产物级端到端:全屏翻转 / 换标签 / 新开标签 / 模拟点击 ---')
{
  const stack = makeStack({ fullscreen: false })
  const review = stack.reviewStore()
  const rightbar = stack.rightbarStore()
  const ctx = {
    get: (serviceName) => ({ slots: stack.services.slots, sessions: stack.services.sessions, uiSession: stack.services.uiSession })[serviceName],
    effect: () => () => {},
  }
  plugin.apply(ctx)

  // 打开 diff(非全屏)→ 桶缺席不崩;播种后不分栏
  rightbar.openContent('s1', 'changes-review', 't1')
  check('桶未播种时不崩且未写', review.actions.splitCalls, [])
  review.actions.navigated('t1')
  check('播种后非全屏 → 不分栏', review.getSnapshot().byTab.t1.split, false)

  // 翻全屏 → 分栏;退全屏 → 不分栏
  stack.layoutStore().openRightbar(true, true)
  check('进入全屏 → 分栏', review.getSnapshot().byTab.t1.split, true)
  stack.layoutStore().closeRightbar()
  check('退出全屏 → 不分栏', review.getSnapshot().byTab.t1.split, false)

  // 切到另一个 diff 标签(桶已在)→ 立即对齐
  review.seed('t2', true)
  rightbar.openContent('s1', 'changes-review', 't2')
  check('切到 t2 → 立即对齐 false', review.getSnapshot().byTab.t2.split, false)
  check('t1 未被带动', review.getSnapshot().byTab.t1.split, false)

  // 全屏下打开第三个 diff 标签(桶未播种 → 不崩;播种后对齐)
  stack.layoutStore().openRightbar(true, true)
  rightbar.openContent('s1', 'changes-review', 't3')
  check('新开标签桶未播种时不崩', review.getSnapshot().byTab.t3, undefined)
  review.actions.navigated('t3')
  check('播种后按全屏 → 分栏', review.getSnapshot().byTab.t3.split, true)

  // 模拟点击页头「左右对比」按钮:同一次同步通知内回正
  review.actions.toggledSplit('t3')
  check('点按钮后立刻:split 仍为 true', review.getSnapshot().byTab.t3.split, true)
  check('点按钮后立刻:该标签 toggle 2 次', review.actions.splitCalls.filter((id) => id === 't3').length, 2)
  check('点按钮后立刻:写面以方法形式调用', review.actions.unboundCalls, 0)

  // 非全屏下同样
  stack.layoutStore().closeRightbar()
  check('退全屏后 t3 不分栏', review.getSnapshot().byTab.t3.split, false)
  review.actions.toggledSplit('t3')
  check('非全屏点击后立刻:仍 false', review.getSnapshot().byTab.t3.split, false)
}

// ---- C. apply 容错 ---------------------------------------------------------

console.log('--- C apply 容错:ctx 全缺 / 无 effect / 二次 apply ---')
{
  globalThis.window = { __ModuleLoader__: { load: () => {} } }
  const ctxOf = (stack) => ({
    get: (serviceName) => ({ slots: stack.services.slots, sessions: stack.services.sessions, uiSession: stack.services.uiSession })[serviceName],
  })
  checkNoThrow('ctx 全缺', () => plugin.apply({}))
  checkNoThrow('ctx.get 全返回 undefined', () => plugin.apply({ get: () => undefined }))
  checkNoThrow('ctx.get 抛错', () => plugin.apply({ get: () => { throw new Error('no such service') } }))
  checkNoThrow('服务全缺时 apply 不抛', () => plugin.apply({ get: () => undefined, effect: () => () => {} }))
  checkNoThrow('无 ctx.effect(仍装配订阅)', () => {
    const stack = makeStack({ fullscreen: true })
    plugin.apply(ctxOf(stack))
    check('无 effect 也能订阅', stack.layoutStore().listenerCount, 1)
  })
  checkNoThrow('二次 apply(HMR 重建)不抛', () => {
    const stack = makeStack({ fullscreen: true })
    plugin.apply(ctxOf(stack))
    plugin.apply(ctxOf(stack))
    check('两次 apply 各自订阅一份', stack.layoutStore().listenerCount, 2)
  })
}

console.log(failures === 0 ? '\nall diff-split probes passed' : `\n${failures} probe(s) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
