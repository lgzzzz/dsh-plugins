/**
 * 诊断脚本(非插件产物):关闭右栏当前标签:⌘/Ctrl+, → `sidebarRight.close(tabId)`,只关**当前面板**的当前标签,
 * 关后回读布局确认标签消失才吞键(独占停靠的 guide 上游拒关 → 只 no-op 仍吞键);
 * 含无降级分支(键位恒吞,不留给浏览器)与 `bindings` 覆盖。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/rightbar-close-tab.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, check, clone, isMain, loadPlugin, report, same, sessions, storage } from './harness.mjs'

// ---- 阶段 5b:⌘/Ctrl+, → 关闭右栏当前标签(现场与标签切换同源) ----
// 关闭 = sidebarRight.close(tabId);关完回读布局确认标签消失才吞键,否则 no-op(不复制上游判定)
console.log('\n--- ⌘/Ctrl+, → 右侧栏关闭当前标签 ---')
{
  /** 假右栏会话级 store:快照 { bySession: { <id>: { layout } } } + 复刻上游 closeTab 的可见结果。 */
  function makeCloseStore() {
    const handle = { spec: {} }
    let state = { bySession: {} }
    return {
      handle,
      instance: { getSnapshot: () => state },
      read: () => state,
      seed: (layout, sessionId = 'sess-b') => { state = { bySession: { [sessionId]: { layout: clone(layout) } } } },
      /** 复刻上游 closeTab:独占停靠的 guide 不关;其余从面板与 tabs 表里删掉。 */
      closeTab(tabId, sessionId = 'sess-b') {
        const layout = state.bySession[sessionId]?.layout
        if (layout === undefined) return
        const record = layout.tabs?.[tabId]
        if (record === undefined) return
        const panes = Object.values(layout.nodes).filter((node) => node.kind === 'pane')
        const pane = panes.find((node) => (node.tabs ?? []).includes(tabId))
        if (record.kind === 'guide' && pane?.host === 'dock' && pane.tabs.length === 1 && panes.length === 1) return
        delete layout.tabs[tabId]
        if (pane !== undefined) {
          pane.tabs = pane.tabs.filter((id) => id !== tabId)
          if (pane.activeTabId === tabId) pane.activeTabId = pane.tabs[0]
        }
        state = { bySession: { ...state.bySession, [sessionId]: { layout } } }
      },
    }
  }
  /** 默认布局:单停靠面板,当前标签 t2。 */
  const layoutClose = (over = {}) => ({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2'], activeTabId: 't2' } },
    tabs: { t1: { id: 't1', kind: 'guide' }, t2: { id: 't2', kind: 'text' } },
    ...over,
  })
  /** rightbar.session 的假 slots:承载 store handle 的注册项(带无 store 的干扰项)。 */
  function closeSlots(store) {
    return {
      entries: (key) => (key !== 'rightbar.session' ? [] : [{ select: () => ({}) }, { store: store.handle }]),
      resolveStore: (handle, binding) => {
        if (handle !== store.handle) throw new Error('resolved the wrong store handle')
        if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
        return store.instance
      },
    }
  }
  /** 装一个「右栏完整可用」的环境,返回按键函数、close 调用记录与回读的标签列表。 */
  function env(store, over = {}) {
    const closed = []
    const pressKey = loadPlugin({
      sessions,
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      slots: closeSlots(store),
      sidebarRight: {
        toggleExpanded() {},
        // 与上游同一语义:close 落到 store 上(标签真的被删掉)。
        close: (tabId) => { closed.push(tabId); store.closeTab(tabId) },
      },
      ...over,
    })
    return { press: pressKey, closed, tabs: () => Object.keys(store.read().bySession['sess-b']?.layout?.tabs ?? {}) }
  }

  // 当前面板当前标签 → 关闭它并吞键
  const store = makeCloseStore()
  store.seed(layoutClose())
  const base = env(store)
  let event = base.press({ key: ',', code: 'Comma', ctrlKey: true })
  check('⌘/Ctrl+, → close(当前标签 t2)', same(base.closed, ['t2']), JSON.stringify(base.closed))
  check('⌘/Ctrl+, 被吞', event.propagationStopped === true)
  check('标签真的从布局里消失', same(base.tabs(), ['t1']), JSON.stringify(base.tabs()))

  // 关的必须是**当前面板**的当前标签,不是第一个面板
  const twoPanes = makeCloseStore()
  twoPanes.seed(layoutClose({
    activePaneId: 'pane-2',
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2'], activeTabId: 't2' },
      'pane-2': { kind: 'pane', host: 'dock', id: 'pane-2', tabs: ['t3'], activeTabId: 't3' },
    },
    tabs: { t1: { id: 't1', kind: 'guide' }, t2: { id: 't2' }, t3: { id: 't3', kind: 'terminal' } },
  }))
  const twoEnv = env(twoPanes)
  event = twoEnv.press({ key: ',', code: 'Comma', ctrlKey: true })
  check('多面板时关当前面板的当前标签 t3', same(twoEnv.closed, ['t3']), JSON.stringify(twoEnv.closed))
  check('另一个面板的标签不受影响', same(twoEnv.tabs(), ['t1', 't2']), JSON.stringify(twoEnv.tabs()))

  // 未被激活的标签不关(当前标签缺失 → no-op,但键位恒吞:不留给浏览器)
  const noActive = makeCloseStore()
  noActive.seed(layoutClose({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2'], activeTabId: 'nope' } } }))
  const noActiveEnv = env(noActive)
  event = noActiveEnv.press({ key: ',', code: 'Comma', ctrlKey: true })
  check('activeTabId 失配 → 不调 close', same(noActiveEnv.closed, []), JSON.stringify(noActiveEnv.closed))
  check('activeTabId 失配 → 仍吞键', event.propagationStopped === true)

  // 独占停靠的 guide:上游拒关 → 只 no-op,仍吞键
  const soleGuide = makeCloseStore()
  soleGuide.seed(layoutClose({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' } }, tabs: { t1: { id: 't1', kind: 'guide' } } }))
  const soleGuideEnv = env(soleGuide)
  event = soleGuideEnv.press({ key: ',', code: 'Comma', ctrlKey: true })
  check('独占停靠的 guide → 标签未消失', same(soleGuideEnv.closed, ['t1']) && same(soleGuideEnv.tabs(), ['t1']), JSON.stringify(soleGuideEnv.tabs()))
  check('独占停靠的 guide → 仍吞键', event.propagationStopped === true)

  // guide 不是独占(面板里还有别的标签)→ 可以关
  const guideWithPeer = makeCloseStore()
  guideWithPeer.seed(layoutClose({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2'], activeTabId: 't1' } } }))
  const peerEnv = env(guideWithPeer)
  event = peerEnv.press({ key: ',', code: 'Comma', ctrlKey: true })
  check('guide 与其它标签共存时可关', same(peerEnv.closed, ['t1']) && same(peerEnv.tabs(), ['t2']), JSON.stringify(peerEnv.tabs()))
  check('guide 与其它标签共存时吞键', event.propagationStopped === true)

  // 面板无标签 / 非 pane 节点 / 该会话尚无布局:全部 no-op,但都吞键
  const noTabs = makeCloseStore()
  noTabs.seed(layoutClose({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: [], activeTabId: undefined } } }))
  event = env(noTabs).press({ key: ',', code: 'Comma', ctrlKey: true })
  check('面板无标签 → 仍吞键', event.propagationStopped === true)
  const notPane = makeCloseStore()
  notPane.seed(layoutClose({ nodes: { 'pane-1': { kind: 'split' } } }))
  event = env(notPane).press({ key: ',', code: 'Comma', ctrlKey: true })
  check('activePaneId 指向非 pane 节点 → 仍吞键', event.propagationStopped === true)
  const otherSession = makeCloseStore()
  otherSession.seed(layoutClose(), 'sess-other')
  event = env(otherSession).press({ key: ',', code: 'Comma', ctrlKey: true })
  check('该会话尚无布局 → 仍吞键', event.propagationStopped === true)

  // 无降级:服务 / 注册项 / store / close 面任一环不可用 → no-op,但键位恒吞(不留给浏览器)
  const noopCases = [
    ['sidebarRight 缺席', { sidebarRight: undefined }],
    ['sidebarRight 无 close', { sidebarRight: { toggleExpanded() {}, focus() {} } }],
    ['slots 缺席', { slots: undefined }],
    ['slots 无 resolveStore', { slots: { entries: () => [{ store: store.handle }] } }],
    ['注册项都没有 store', { slots: { entries: () => [{ select: () => ({}) }], resolveStore: () => store.instance } }],
    ['uiSession 无 bindingSource', { uiSession: { pendingInteractions: { getSnapshot: () => new Map() }, bindingSource: undefined } }],
    ['resolveStore 抛错(handle 未注册)', {
      slots: { entries: () => [{ store: store.handle }], resolveStore: () => { throw new Error('store handle is not registered') } },
    }],
    ['活实例缺 getSnapshot', {
      slots: { entries: () => [{ store: store.handle }], resolveStore: () => ({}) },
    }],
    ['快照缺 bySession', {
      slots: { entries: () => [{ store: store.handle }], resolveStore: () => ({ getSnapshot: () => ({}) }) },
    }],
    ['close 抛错(无挂载会话面)', { sidebarRight: { toggleExpanded() {}, close: () => { throw new Error('sidebarRight: no session surface is mounted') } } }],
  ]
  for (const [label, extra] of noopCases) {
    const envCase = env(makeCloseStore(), extra)
    const pressed = envCase.press({ key: ',', code: 'Comma', ctrlKey: true })
    check(`${label} → 仍吞键(no-op)`, pressed.propagationStopped === true)
  }

  // editing / card 态同样可用:mod+, 与卡片裸键、文本编辑都不冲突
  const editingStore = makeCloseStore()
  editingStore.seed(layoutClose())
  const editingEnv = env(editingStore)
  event = editingEnv.press({ key: ',', code: 'Comma', ctrlKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+, 仍关标签', same(editingEnv.closed, ['t2']), JSON.stringify(editingEnv.closed))
  check('editing 态 ⌘/Ctrl+, 被吞', event.propagationStopped === true)
  const cardStore = makeCloseStore()
  cardStore.seed(layoutClose())
  const cardEnv = env(cardStore, {
    uiSession: {
      pendingInteractions: { getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:21', sessionId: 'sess-b', questions: [{ id: 'q1', options: [{ label: 'A' }] }] }]]) },
    },
  })
  event = cardEnv.press({ key: ',', code: 'Comma', ctrlKey: true })
  check('card 态 ⌘/Ctrl+, 仍关标签', same(cardEnv.closed, ['t2']), JSON.stringify(cardEnv.closed))
  check('card 态 ⌘/Ctrl+, 被吞', event.propagationStopped === true)

  // 裸 , / 别的组合键不触发(不误伤页面)
  event = base.press({ key: ',', code: 'Comma' })
  check('裸 , 不关标签、不吞键', event.propagationStopped !== true)
  event = base.press({ key: ',', code: 'Comma', ctrlKey: true, altKey: true })
  check('⌘/Ctrl+Alt+, 不关标签、不吞键', event.propagationStopped !== true)

  // 键位可经 localStorage 独立覆盖
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.closeTab': 'mod+alt+8' } }))
  const customStore = makeCloseStore()
  customStore.seed(layoutClose())
  const custom = env(customStore)
  event = custom.press({ key: ',', code: 'Comma', ctrlKey: true })
  check('覆盖键位后 ⌘/Ctrl+, 不再关标签', same(custom.closed, []), JSON.stringify(custom.closed))
  check('覆盖键位后 ⌘/Ctrl+, 不吞键', event.propagationStopped !== true)
  event = custom.press({ key: '8', code: 'Digit8', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+8 → 关标签', same(custom.closed, ['t2']), JSON.stringify(custom.closed))
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')
}

if (isMain(import.meta.url)) report()
