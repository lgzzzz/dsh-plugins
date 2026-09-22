/**
 * 诊断脚本(非插件产物):右栏全屏开关:⌘/Ctrl+S 写会话级 store 的 `actions.setMode(sessionId, mode)`(dockkit
 * `planSetMode` 的唯一入口);判定复刻面板 chrome 按钮(生效全屏 → push,否则 → fullscreen),
 * 窄窗(< 768px)退出全屏时先 `setExpanded(false)`;含 767/768 断点、面板收起时仍写 mode、
 * `getSnapshot` / `setMode` 抛错与缺 `setExpanded` 的分支、速查表展示行与 `bindings` 覆盖。
 *
 * 另覆盖本动作独有的**分栏同步**:触发时按切换后的生效全屏让当前 diff 标签的左右对比
 * = 全屏(见 `rightbar-view.ts` 的 `setRightSidebarDiffSplit`)——分栏是 toggle 语义,
 * 故先读快照的 split 再决定写不写(已是期望值不盲调);当前标签不是 diff、链路不可用、
 * 状态桶缺席即只跳过分栏,不影响 mode 写入与吞键。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/rightbar-fullscreen.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, check, clone, isMain, loadPlugin, nodeText, report, same, sessions, storage } from './harness.mjs'

// ---- 阶段 5c:⌘/Ctrl+S → 切换右栏 fullscreen(与面板全屏按钮同一入口) ----
// 写面 = 会话级 store 的 actions.setMode(sessionId, mode)(dockkit planSetMode 的唯一入口);
// 判定复刻面板 chrome 按钮:生效全屏(autoFullscreen ∪ mode==='fullscreen')→ push,否则 → fullscreen;
// 窄窗(< 768px)退出全屏时先 setExpanded(false)(上游按钮同款),否则面板仍被 autoFullscreen 留在全屏。
console.log('\n--- ⌘/Ctrl+S → 右侧栏切换全屏 ---')
{
  /** 假右栏会话级 store:快照 { bySession: { <id>: { layout } } } + 动作面 setMode / setExpanded。 */
  function makeModeStore() {
    const handle = { spec: {} }
    let state = { bySession: {} }
    const calls = []
    return {
      handle,
      instance: {
        getSnapshot: () => state,
        actions: {
          // 与上游同一语义:呈现方式只经 setMode 写入(dockkit 初始 'push')
          setMode(sessionId, mode) {
            const surface = state.bySession[sessionId]
            if (surface === undefined) throw new Error('sidebarRight: no session surface is mounted')
            calls.push({ action: 'setMode', sessionId, mode })
            surface.layout = { ...surface.layout, mode }
          },
          setExpanded(sessionId, expanded) {
            const surface = state.bySession[sessionId]
            if (surface === undefined) throw new Error('sidebarRight: no session surface is mounted')
            calls.push({ action: 'setExpanded', sessionId, expanded })
            surface.layout = { ...surface.layout, expanded }
          },
        },
      },
      calls,
      read: () => state.bySession['sess-b']?.layout,
      seed: (layout, sessionId = 'sess-b') => {
        state = { bySession: { [sessionId]: { layout: clone(layout) } } }
        calls.length = 0
      },
    }
  }
  /** 右栏布局:面板已展开、手动呈现为 `mode`(缺省即 dockkit 初始 'push')。 */
  const layoutMode = (over = {}) => ({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    mode: 'push',
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t2'], activeTabId: 't2' } },
    tabs: { t2: { id: 't2', kind: 'text' } },
    ...over,
  })
  /** 右栏布局:当前标签是**变更审阅 diff**(分栏同步的目标页)。 */
  const diffLayout = (over = {}) => layoutMode({
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t-diff'], activeTabId: 't-diff' } },
    tabs: { 't-diff': { id: 't-diff', kind: 'changes-review' } },
    ...over,
  })
  /**
   * 假「变更审阅」视图 store:只声明分栏动作 `toggledSplit`(与页头「左右对比」按钮同一入口),
   * 快照 { byTab: { 't-diff': { split } } };`bucket: 'none'` 模拟「该标签还没有状态桶」。
   * `split` 复刻上游语义:无桶即抛。
   */
  function makeSplitStore({ split = true, bucket } = {}) {
    const handle = { spec: {} }
    const calls = []
    const state = { byTab: bucket === 'none' ? {} : { 't-diff': { split } } }
    const instance = {
      getSnapshot: () => state,
      actions: {
        toggledSplit(tabId) {
          const tab = state.byTab[tabId]
          if (tab === undefined) throw new Error(`ui-deliverables: no review state for tab "${tabId}"`)
          calls.push(['toggledSplit', tabId])
          tab.split = !tab.split
        },
      },
    }
    return { handle, calls, instance, split: () => state.byTab['t-diff']?.split }
  }
  /** rightbar.session 假 slots:无 store 的干扰项 + 承载 handle 的注册项(另一 slot 给变更审阅视图 store)。 */
  function modeSlots(store, review) {
    return {
      entries: (key) => {
        if (key === 'rightbar.session') return [{ select: () => ({}) }, { store: store.handle }]
        if (key === 'sidebar.right.pane.tab') {
          return [{ options: { key: '@deepseek-ai/dsh-client-ui-deliverables' }, store: review.handle }]
        }
        return []
      },
      resolveStore: (handle, binding) => {
        if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
        if (handle === store.handle) return store.instance
        if (handle === review.handle) return review.instance
        throw new Error('store handle is not registered')
      },
    }
  }
  /**
   * 装一个「右栏完整可用」的环境;视口宽度可调(默认宽窗)。
   * @param over - `width` 调视口;`split` / `bucket` 控制变更审阅 store 的初始分栏状态;
   *   其余字段覆盖服务桩(显式传 `slots` 即整条替换,用于退化用例)。
   */
  function env(store, over = {}) {
    const { width = 1280, split, bucket, ...rest } = over
    globalThis.window.innerWidth = width
    const review = makeSplitStore({ split, bucket })
    const pressKey = loadPlugin({
      sessions,
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      slots: modeSlots(store, review),
      sidebarRight: { toggleExpanded() {} },
      ...rest,
    })
    return { press: pressKey, layout: () => store.read(), calls: () => store.calls, review }
  }
  /** ⌘/Ctrl+S(按 code 判定,与其它键位一致)。 */
  const save = { key: 's', code: 'KeyS', ctrlKey: true }

  // ① 宽窗 push → fullscreen(写 mode 不动 expanded)
  const wide = makeModeStore()
  wide.seed(layoutMode())
  const wideEnv = env(wide)
  let event = wideEnv.press(save)
  check('⌘/Ctrl+S 宽窗 push → setMode(sess-b, fullscreen)',
    same(wideEnv.calls(), [{ action: 'setMode', sessionId: 'sess-b', mode: 'fullscreen' }]), JSON.stringify(wideEnv.calls()))
  check('⌘/Ctrl+S 被吞(不留给浏览器保存页)', event.propagationStopped === true)
  check('宽窗 push → fullscreen 后 mode 落盘', wideEnv.layout()?.mode === 'fullscreen', JSON.stringify(wideEnv.layout()))

  // ② 宽窗 fullscreen → push(再按一次回来)
  event = wideEnv.press(save)
  check('⌘/Ctrl+S 宽窗 fullscreen → setMode(sess-b, push)',
    same(wideEnv.calls().at(-1), { action: 'setMode', sessionId: 'sess-b', mode: 'push' }), JSON.stringify(wideEnv.calls()))
  check('宽窗回 push 时不做 setExpanded', wideEnv.calls().every((call) => call.action === 'setMode') === true, JSON.stringify(wideEnv.calls()))
  check('宽窗 fullscreen → push 后 mode 落盘', wideEnv.layout()?.mode === 'push', JSON.stringify(wideEnv.layout()))
  check('宽窗往返不动 expanded', wideEnv.layout()?.expanded === true)

  // ③ 窄窗(< 768px)autoFullscreen 生效:按 ⌘/Ctrl+S 先收起(上游按钮分支)再写 push
  const narrow = makeModeStore()
  narrow.seed(layoutMode({ mode: 'fullscreen' }))
  const narrowEnv = env(narrow, { width: 640 })
  event = narrowEnv.press(save)
  check('窄窗退出全屏 → setExpanded(sess-b, false) 先收起',
    same(narrowEnv.calls()[0], { action: 'setExpanded', sessionId: 'sess-b', expanded: false }), JSON.stringify(narrowEnv.calls()))
  check('窄窗退出全屏 → 再 setMode(sess-b, push)',
    same(narrowEnv.calls().at(-1), { action: 'setMode', sessionId: 'sess-b', mode: 'push' }), JSON.stringify(narrowEnv.calls()))
  check('窄窗退出全屏被吞', event.propagationStopped === true)
  check('窄窗退出后 expanded=false 且 mode=push',
    narrowEnv.layout()?.expanded === false && narrowEnv.layout()?.mode === 'push', JSON.stringify(narrowEnv.layout()))

  // ④ 窄窗判据是「生效全屏」而非按钮字面:手动 mode='push' 也按全屏处理(与上游 autoFullscreen 一致)
  const narrowPush = makeModeStore()
  narrowPush.seed(layoutMode({ mode: 'push' }))
  const narrowPushEnv = env(narrowPush, { width: 640 })
  narrowPushEnv.press(save)
  check('窄窗手动 push 仍按全屏处理 → 收起 + 写 push',
    same(narrowPushEnv.calls(), [
      { action: 'setExpanded', sessionId: 'sess-b', expanded: false },
      { action: 'setMode', sessionId: 'sess-b', mode: 'push' },
    ]), JSON.stringify(narrowPushEnv.calls()))

  // ⑤ 边界 767 / 768:断点归上游(viewportWidth < 768)
  const edge = [
    [767, true, '767px 视为窄窗(上游 < 768)'],
    [768, false, '768px 视为宽窗(边界不含)'],
  ]
  for (const [width, isNarrow, label] of edge) {
    const store = makeModeStore()
    store.seed(layoutMode({ mode: 'fullscreen' }))
    const edgeEnv = env(store, { width })
    edgeEnv.press(save)
    const hasCollapse = edgeEnv.calls().some((call) => call.action === 'setExpanded')
    check(label, hasCollapse === isNarrow, `${String(width)}px → ${JSON.stringify(edgeEnv.calls())}`)
  }

  // ⑥ 面板已收起时仍写 mode(与上游按钮一致:呈现方式与展开态正交)
  const collapsed = makeModeStore()
  collapsed.seed(layoutMode({ expanded: false }))
  const collapsedEnv = env(collapsed)
  event = collapsedEnv.press(save)
  check('面板收起时仍 setMode(fullscreen)(下次展开即生效)',
    same(collapsedEnv.calls(), [{ action: 'setMode', sessionId: 'sess-b', mode: 'fullscreen' }]), JSON.stringify(collapsedEnv.calls()))
  check('面板收起时被吞', event.propagationStopped === true)

  // ⑦ 该会话尚无面板(store 里没有 bySession[sid])→ no-op 不吞键
  const otherSession = makeModeStore()
  otherSession.seed(layoutMode(), 'sess-other')
  event = env(otherSession).press(save)
  check('该会话尚无面板 → 不调 setMode(no-op)', same(otherSession.calls, []), JSON.stringify(otherSession.calls))
  check('该会话尚无面板 → 不吞键', event.propagationStopped !== true)

  // ⑧ 无降级:服务 / 注册项 / store / setMode 面任一环不可用 → no-op 不吞键
  const noopCases = [
    ['sidebarRight 缺席', { sidebarRight: undefined }],
    ['slots 缺席', { slots: undefined }],
    ['slots 无 resolveStore', { slots: { entries: () => [{ store: wide.handle }] } }],
    ['注册项都没有 store', { slots: { entries: () => [{ select: () => ({}) }], resolveStore: () => wide.instance } }],
    ['uiSession 无 bindingSource', { uiSession: { pendingInteractions: { getSnapshot: () => new Map() }, bindingSource: undefined } }],
    ['resolveStore 抛错(handle 未注册)', {
      slots: { entries: () => [{ store: wide.handle }], resolveStore: () => { throw new Error('store handle is not registered') } },
    }],
    ['快照缺 bySession', {
      slots: { entries: () => [{ store: wide.handle }], resolveStore: () => ({ getSnapshot: () => ({}) }) },
    }],
    ['活实例无 setMode(旧 store 面)', {
      slots: {
        entries: () => [{ store: wide.handle }],
        resolveStore: () => ({ getSnapshot: () => clone({ bySession: { 'sess-b': { layout: layoutMode() } } }) }),
      },
    }],
  ]
  for (const [label, extra] of noopCases) {
    const caseEnv = env(makeModeStore(), extra)
    const pressed = caseEnv.press(save)
    check(`${label} → 不吞键(no-op)`, pressed.propagationStopped !== true)
    // 全屏没切成时**不得**顺手改分栏(分栏只随成功的 ⌘/Ctrl+S 同步)
    check(`${label} → 不同步分栏`, same(caseEnv.review.calls, []), JSON.stringify(caseEnv.review.calls))
  }

  // ⑧′ 抛错面:活实例的 getSnapshot / setMode 抛错都被吞掉,只当 no-op(不吞键、不带崩分发器)
  const throwingSnapshot = env(makeModeStore(), {
    slots: {
      entries: () => [{ store: wide.handle }],
      resolveStore: () => ({ getSnapshot: () => { throw new Error('store instance disposed') } }),
    },
  })
  event = throwingSnapshot.press(save)
  check('getSnapshot 抛错 → 不吞键(no-op)', event.propagationStopped !== true)

  // 当前标签是 diff 时也一并不动分栏:setMode 抛错 → outcome 为「没做成」,分栏同步整条跳过
  const throwingMode = makeModeStore()
  throwingMode.seed(diffLayout())
  const throwingModeInstance = throwingMode.instance
  throwingModeInstance.actions.setMode = () => { throw new Error('sidebarRight: no session surface is mounted') }
  const throwingModeEnv = env(throwingMode, { split: false })
  event = throwingModeEnv.press(save)
  check('setMode 抛错 → 不吞键(no-op)', event.propagationStopped !== true)
  check('setMode 抛错 → 也不动分栏(分栏只随成功的全屏切换)', same(throwingModeEnv.review.calls, []),
    JSON.stringify(throwingModeEnv.review.calls))

  // ⑧″ 窄窗而活实例没有 setExpanded(旧 store 面):跳过收起、仍写 push(不因缺一面整条 no-op)
  const narrowNoExpand = makeModeStore()
  narrowNoExpand.seed(layoutMode({ mode: 'fullscreen' }))
  const narrowNoExpandInstance = narrowNoExpand.instance
  delete narrowNoExpandInstance.actions.setExpanded
  const narrowNoExpandEnv = env(narrowNoExpand, {
    width: 640,
    slots: {
      entries: () => [{ store: narrowNoExpand.handle }],
      resolveStore: () => narrowNoExpandInstance,
    },
  })
  event = narrowNoExpandEnv.press(save)
  check('窄窗缺 setExpanded → 仍 setMode(push) 并吞键',
    event.propagationStopped === true && narrowNoExpand.calls.at(-1)?.mode === 'push',
    JSON.stringify(narrowNoExpand.calls))
  check('窄窗缺 setExpanded → 不记录收起调用', narrowNoExpand.calls.every((call) => call.action === 'setMode') === true,
    JSON.stringify(narrowNoExpand.calls))

  // ⑧‴ diff 分栏同步:⌘/Ctrl+S 触发时按切换后的**生效全屏**设置当前 diff 标签的左右对比
  // (分栏是 toggle 语义 → 先读快照里的 split,已是期望值就不写;当前标签不是 diff / 链路不可用
  //  只跳过分栏,不影响 mode 写入与吞键)
  const splitOff = makeModeStore()
  splitOff.seed(diffLayout())
  const splitOffEnv = env(splitOff, { split: false })
  event = splitOffEnv.press(save)
  check('宽窗进全屏 → 当前 diff split false → true',
    splitOffEnv.review.split() === true && same(splitOffEnv.review.calls, [['toggledSplit', 't-diff']]),
    JSON.stringify(splitOffEnv.review.calls))
  check('分栏同步发生在 setMode 之后(先写呈现、再设分栏)',
    same(splitOffEnv.calls(), [{ action: 'setMode', sessionId: 'sess-b', mode: 'fullscreen' }]), JSON.stringify(splitOffEnv.calls()))
  check('宽窗进全屏(带分栏同步)被吞', event.propagationStopped === true)

  // 再按一次退出全屏 → 分栏关(上一步已打开,故再写一次 toggle)
  event = splitOffEnv.press(save)
  check('宽窗退回 push → 当前 diff split true → false',
    splitOffEnv.review.split() === false && splitOffEnv.review.calls.length === 2 && splitOffEnv.layout()?.mode === 'push',
    JSON.stringify(splitOffEnv.review.calls))
  check('宽窗退回 push 仍被吞', event.propagationStopped === true)

  // 幂等:进全屏时 split 已经是 true → 不盲调
  const alreadySplit = makeModeStore()
  alreadySplit.seed(diffLayout())
  const alreadySplitEnv = env(alreadySplit, { split: true })
  event = alreadySplitEnv.press(save)
  check('进全屏时 split 已是 true → 不调 toggledSplit(不盲调)', same(alreadySplitEnv.review.calls, []),
    JSON.stringify(alreadySplitEnv.review.calls))
  check('进全屏时 split 已是 true → 仍写 mode 并吞键',
    alreadySplitEnv.layout()?.mode === 'fullscreen' && event.propagationStopped === true)

  // 幂等:退出全屏时 split 已经是 false → 不盲调
  const alreadyUnified = makeModeStore()
  alreadyUnified.seed(diffLayout({ mode: 'fullscreen' }))
  const alreadyUnifiedEnv = env(alreadyUnified, { split: false })
  event = alreadyUnifiedEnv.press(save)
  check('退出全屏时 split 已是 false → 不调 toggledSplit(不盲调)', same(alreadyUnifiedEnv.review.calls, []),
    JSON.stringify(alreadyUnifiedEnv.review.calls))
  check('退出全屏时 split 已是 false → 仍写 push 并吞键',
    alreadyUnifiedEnv.layout()?.mode === 'push' && event.propagationStopped === true)

  // 窄窗:⌘/Ctrl+S = 收起面板(用户看不到全屏)→ 分栏也要关
  const narrowSplit = makeModeStore()
  narrowSplit.seed(diffLayout())
  const narrowSplitEnv = env(narrowSplit, { width: 640, split: true })
  event = narrowSplitEnv.press(save)
  check('窄窗(收起面板)退出全屏 → 当前 diff split true → false',
    narrowSplitEnv.review.split() === false && same(narrowSplitEnv.review.calls, [['toggledSplit', 't-diff']]),
    JSON.stringify(narrowSplitEnv.review.calls))
  check('窄窗仍按上游按钮语义「先收起再写 push」并吞键',
    same(narrowSplitEnv.calls(), [
      { action: 'setExpanded', sessionId: 'sess-b', expanded: false },
      { action: 'setMode', sessionId: 'sess-b', mode: 'push' },
    ]) && event.propagationStopped === true, JSON.stringify(narrowSplitEnv.calls()))

  // 当前标签不是 diff(文件预览 / 终端 / 引导页等)→ 分栏无此页,只写 mode、不动分栏、仍吞键
  const textTab = makeModeStore()
  textTab.seed(layoutMode())
  const textTabEnv = env(textTab, { split: false })
  event = textTabEnv.press(save)
  check('当前标签不是 diff → 不碰分栏', same(textTabEnv.review.calls, []), JSON.stringify(textTabEnv.review.calls))
  check('当前标签不是 diff → 仍写 mode 并吞键',
    textTabEnv.layout()?.mode === 'fullscreen' && event.propagationStopped === true)

  // 分栏取数链路退化:注册项缺席 / 状态桶缺席 / 快照抛错 → 只跳过分栏,不影响 mode 与吞键
  const noReviewEntry = makeModeStore()
  noReviewEntry.seed(diffLayout())
  const noReviewEnv = env(noReviewEntry, {
    split: false,
    slots: {
      entries: (key) => (key !== 'rightbar.session' ? [] : [{ store: noReviewEntry.handle }]),
      resolveStore: (handle) => noReviewEntry.instance,
    },
  })
  event = noReviewEnv.press(save)
  check('变更审阅注册项缺席 → 仅写 mode、仍吞键、不崩',
    noReviewEnv.layout()?.mode === 'fullscreen' && event.propagationStopped === true)

  const noBucket = makeModeStore()
  noBucket.seed(diffLayout())
  const noBucketEnv = env(noBucket, { split: false, bucket: 'none' })
  event = noBucketEnv.press(save)
  check('该 diff 标签还没有状态桶(split 不可知)→ 不猜、不写、不崩',
    same(noBucketEnv.review.calls, []) && noBucketEnv.layout()?.mode === 'fullscreen' && event.propagationStopped === true,
    JSON.stringify(noBucketEnv.review.calls))

  const throwingView = makeModeStore()
  throwingView.seed(diffLayout())
  const throwingViewEnv = env(throwingView, {
    split: false,
    slots: {
      entries: (key) => (key === 'rightbar.session'
        ? [{ store: throwingView.handle }]
        : [{ options: { key: '@deepseek-ai/dsh-client-ui-deliverables' }, store: { spec: {} } }]),
      resolveStore: (handle) => (handle === throwingView.handle
        ? throwingView.instance
        : { getSnapshot: () => { throw new Error('store instance disposed') } }),
    },
  })
  event = throwingViewEnv.press(save)
  check('变更审阅 store 快照抛错 → 分栏 no-op,仍写 mode 并吞键',
    throwingViewEnv.layout()?.mode === 'fullscreen' && event.propagationStopped === true)

  // ⑨ 三态均可用:⌘/Ctrl+S 是带修饰键的组合,与卡片裸键 / 文本编辑都不冲突
  const editingStore = makeModeStore()
  editingStore.seed(layoutMode())
  const editingEnv = env(editingStore)
  event = editingEnv.press({ ...save, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+S 仍切全屏', editingEnv.layout()?.mode === 'fullscreen', JSON.stringify(editingEnv.calls()))
  check('editing 态 ⌘/Ctrl+S 被吞', event.propagationStopped === true)
  const cardStore = makeModeStore()
  cardStore.seed(layoutMode())
  const cardEnv = env(cardStore, {
    uiSession: {
      pendingInteractions: { getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:22', sessionId: 'sess-b', questions: [{ id: 'q1', options: [{ label: 'A' }] }] }]]) },
    },
  })
  event = cardEnv.press(save)
  check('card 态 ⌘/Ctrl+S 仍切全屏', cardEnv.layout()?.mode === 'fullscreen', JSON.stringify(cardEnv.calls()))
  check('card 态 ⌘/Ctrl+S 被吞', event.propagationStopped === true)

  // ⑩ 不许误伤:裸 S / 带 alt 的组合不切全屏、也不吞键
  event = wideEnv.press({ key: 's', code: 'KeyS' })
  check('裸 s 不切全屏、不吞键', event.propagationStopped !== true && wideEnv.layout()?.mode === 'push')
  event = wideEnv.press({ key: 's', code: 'KeyS', ctrlKey: true, altKey: true })
  check('⌘/Ctrl+Alt+S 不切全屏、不吞键', event.propagationStopped !== true && wideEnv.layout()?.mode === 'push')

  // ⑪ 键位可经 localStorage 独立覆盖(与其它动作同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.fullscreen': 'mod+f' } }))
  const customStore = makeModeStore()
  customStore.seed(layoutMode())
  const custom = env(customStore)
  event = custom.press(save)
  event = custom.press(save)
  check('覆盖键位后 ⌘/Ctrl+S 不切全屏、不吞键',
    event.propagationStopped !== true && custom.layout()?.mode === 'push',
    `stopped=${String(event.propagationStopped)} mode=${String(custom.layout()?.mode)} calls=${JSON.stringify(custom.calls())}`)
  event = custom.press({ key: 'f', code: 'KeyF', ctrlKey: true })
  check('自定义 ⌘/Ctrl+F → 切全屏并吞键', event.propagationStopped === true && custom.layout()?.mode === 'fullscreen', JSON.stringify(custom.calls()))
  storage.delete('dsh-kbd-hotkeys:v1')

  // ⑫ 速查表里出现该动作与默认键位(ACTIONS × bindings 的展示面)
  const sheetStore = makeModeStore()
  sheetStore.seed(layoutMode())
  const sheetEnv = env(sheetStore)
  sheetEnv.press({ key: '/', code: 'Slash', ctrlKey: true })
  const sheetText = nodeText(globalThis.document.body)
  check('速查表含「右侧栏:切换全屏」行', sheetText.includes('右侧栏:切换全屏'), sheetText.slice(0, 200))
  check('速查表把默认键位显示为 Ctrl+S', /Ctrl\+S/.test(sheetText), sheetText.slice(0, 200))
  sheetEnv.press({ key: 'Escape', code: 'Escape' })

  delete globalThis.window.innerWidth
}

if (isMain(import.meta.url)) report()
