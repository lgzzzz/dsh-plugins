/**
 * 诊断脚本(非插件产物):右栏全屏开关:⌘/Ctrl+S 写会话级 store 的 `actions.setMode(sessionId, mode)`(dockkit
 * `planSetMode` 的唯一入口);判定复刻面板 chrome 按钮(生效全屏 → push,否则 → fullscreen),
 * 窄窗(< 768px)退出全屏时先 `setExpanded(false)`;含 767/768 断点、面板收起时仍写 mode、
 * `getSnapshot` / `setMode` 抛错与缺 `setExpanded` 的分支、速查表展示行与 `bindings` 覆盖。
 *
 * 本动作**只切全屏**:一概不碰 diff 分栏(`sidebarRight.diffSplit` 键位与页头「左右对比」按钮
 * 走同一份 store,但各自动手;持续跟随全屏由 `dsh-rightbar-diff-split` 负责)。
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
  /** rightbar.session 假 slots:无 store 的干扰项 + 承载 handle 的注册项。 */
  function modeSlots(store) {
    return {
      entries: (key) => (key === 'rightbar.session' ? [{ select: () => ({}) }, { store: store.handle }] : []),
      resolveStore: (handle, binding) => {
        if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
        if (handle === store.handle) return store.instance
        throw new Error('store handle is not registered')
      },
    }
  }
  /**
   * 装一个「右栏完整可用」的环境;视口宽度可调(默认宽窗)。
   * @param over - `width` 调视口;其余字段覆盖服务桩(显式传 `slots` 即整条替换,用于退化用例)。
   */
  function env(store, over = {}) {
    const { width = 1280, ...rest } = over
    globalThis.window.innerWidth = width
    const pressKey = loadPlugin({
      sessions,
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      slots: modeSlots(store),
      sidebarRight: { toggleExpanded() {} },
      ...rest,
    })
    return { press: pressKey, layout: () => store.read(), calls: () => store.calls }
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

  // setMode 抛错 → 「没做成」:不吞键、不崩分发器
  const throwingMode = makeModeStore()
  throwingMode.seed(layoutMode())
  const throwingModeInstance = throwingMode.instance
  throwingModeInstance.actions.setMode = () => { throw new Error('sidebarRight: no session surface is mounted') }
  event = env(throwingMode).press(save)
  check('setMode 抛错 → 不吞键(no-op)', event.propagationStopped !== true)

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

  // ⑧‴ 只切全屏:即便当前标签是变更审阅 diff、分栏 store 就在链路上,⌘/Ctrl+S 一概不碰分栏
  // (分栏只归页头「左右对比」按钮与改绑后的 sidebarRight.diffSplit 键位;持续跟随全屏见 dsh-rightbar-diff-split)
  const reviewCalls = []
  const reviewStore = {
    handle: { spec: {} },
    instance: {
      getSnapshot: () => ({ byTab: { 't-diff': { split: false } } }),
      actions: { toggledSplit(tabId) { reviewCalls.push(['toggledSplit', tabId]) } },
    },
  }
  const diffMode = makeModeStore()
  diffMode.seed(layoutMode({
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t-diff'], activeTabId: 't-diff' } },
    tabs: { 't-diff': { id: 't-diff', kind: 'changes-review' } },
  }))
  const diffModeEnv = env(diffMode, {
    slots: {
      entries: (key) => (key === 'rightbar.session'
        ? [{ store: diffMode.handle }]
        : [{ options: { key: '@deepseek-ai/dsh-client-ui-deliverables' }, store: reviewStore.handle }]),
      resolveStore: (handle) => (handle === diffMode.handle ? diffMode.instance : reviewStore.instance),
    },
  })
  event = diffModeEnv.press(save)
  check('⌘/Ctrl+S 只切全屏:当前标签是 diff 也不碰分栏(不调 toggledSplit)',
    reviewCalls.length === 0 && diffModeEnv.layout()?.mode === 'fullscreen' && event.propagationStopped === true,
    JSON.stringify(reviewCalls))
  event = diffModeEnv.press(save)
  check('再按一次(退出全屏)同样不碰分栏',
    reviewCalls.length === 0 && diffModeEnv.layout()?.mode === 'push', JSON.stringify(reviewCalls))

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
