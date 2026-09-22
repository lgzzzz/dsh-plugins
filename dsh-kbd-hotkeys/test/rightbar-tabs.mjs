/**
 * 诊断脚本(非插件产物):右栏标签切换:⌘/Ctrl+Alt+← / →,顺序读 `rightbar.session` store 的 `bySession[id].layout`
 * (三步取数),切换走 `sidebarRight.focus(tabId)`;含首末循环、`activeTabId` 失配落首个、
 * 单标签 / 无标签 / 非 pane 节点 / 该会话尚无面板的 no-op、card 态不冲突与 `bindings` 覆盖。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/rightbar-tabs.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, check, clone, isMain, loadPlugin, report, same, sessions, storage, view } from './harness.mjs'

// ---- 阶段 5:⌘/Ctrl+Alt+← / → → 右栏标签切换 ----
// 顺序 = rightbar.session store(三步取数)→ bySession[id].layout;切换 = sidebarRight.focus(tabId)
console.log('\n--- ⌘/Ctrl+Alt+← / → → 右侧栏标签切换 ---')
{
  /** 假右栏会话级 store:快照形状 = { bySession: { <id>: { layout } } }。 */
  function makeTabsStore() {
    const handle = { spec: {} }
    let state = { bySession: {} }
    /** 复刻上游 focusTab:改当前面板的 activeTabId。 */
    const focusTab = (tabId, sessionId = 'sess-b') => {
      const layout = state.bySession[sessionId]?.layout
      if (layout === undefined) throw new Error('sidebarRight: no session surface is mounted')
      const pane = layout.nodes[layout.activePaneId]
      if (pane === undefined || !pane.tabs.includes(tabId)) return
      pane.activeTabId = tabId
    }
    return {
      handle,
      instance: { getSnapshot: () => state },
      read: () => state,
      focusTab,
      seed: (layout, sessionId = 'sess-b') => {
        state = { bySession: { [sessionId]: { layout: clone(layout) } } }
      },
    }
  }
  /** 三个标签、当前在中间:guide → file → diff。 */
  const layoutTabs = (over = {}) => ({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2', 't3'], activeTabId: 't2' } },
    tabs: {
      t1: { id: 't1', kind: 'guide' },
      t2: { id: 't2', kind: 'text' },
      t3: { id: 't3', kind: 'document-preview' },
    },
    ...over,
  })
  /** rightbar.session 假 slots:干扰项 + 承载 store handle 的注册项。 */
  function tabsSlots(tabs) {
    return {
      entries: (key) => (key !== 'rightbar.session' ? [] : [{ select: () => ({}) }, { store: tabs.handle }]),
      resolveStore: (handle, binding) => {
        if (handle !== tabs.handle) throw new Error('resolved the wrong store handle')
        if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
        return tabs.instance
      },
    }
  }
  /** 装一个「右栏完整可用」的环境,返回按键函数与 focus 调用记录。 */
  function env(tabs, over = {}) {
    const focused = []
    const pressKey = loadPlugin({
      sessions,
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      slots: tabsSlots(tabs),
      sidebarRight: {
        toggleExpanded() {},
        // 与上游同一语义:focus 落到 store 上(下一次按键据新状态重新计算)。
        focus: (tabId) => { focused.push(tabId); tabs.focusTab(tabId) },
      },
      ...over,
    })
    return { press: pressKey, focused }
  }

  const tabs = makeTabsStore()
  tabs.seed(layoutTabs())
  const { press, focused } = env(tabs)

  // → 中间 → 末个标签
  let event = press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('⌘/Ctrl+Alt+→ → focus(下一个标签 t3)', same(focused, ['t3']), JSON.stringify(focused))
  check('⌘/Ctrl+Alt+→ 被吞', event.propagationStopped === true)

  // 末个标签按 → 循环回第一个
  event = press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('末个标签按 → 循环回 t1', same(focused, ['t3', 't1']), JSON.stringify(focused))
  check('循环切换被吞', event.propagationStopped === true)

  // 第一个标签按 ← 循环回最后一个
  event = press({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true })
  check('首个标签按 ← 循环到 t3', same(focused, ['t3', 't1', 't3']), JSON.stringify(focused))
  check('⌘/Ctrl+Alt+← 被吞', event.propagationStopped === true)

  // 输入态(焦点在输入框)同样可用:带修饰键的组合不干扰文本编辑
  event = press({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+Alt+← 仍切标签', same(focused, ['t3', 't1', 't3', 't2']), JSON.stringify(focused))
  check('editing 态 ⌘/Ctrl+Alt+← 被吞', event.propagationStopped === true)

  // 无修饰键的 ← / → 不得触发右栏切标签(browse 态放行给页面)
  event = press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('裸 → 不切右栏标签', same(focused, ['t3', 't1', 't3', 't2']), JSON.stringify(focused))
  check('裸 → 不吞键', event.propagationStopped !== true)

  // 当前标签不在面板里(activeTabId 失配)→ 落到第一个,而不是乱跳
  const unknown = makeTabsStore()
  unknown.seed(layoutTabs({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1', 't2'], activeTabId: 'nope' } } }))
  const unknownEnv = env(unknown)
  unknownEnv.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('activeTabId 失配时落在首个标签', same(unknownEnv.focused, ['t1']), JSON.stringify(unknownEnv.focused))

  // 只有一个标签:no-op 且不吞键(不循环回自身)
  const single = makeTabsStore()
  single.seed(layoutTabs({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' } }, tabs: { t1: { id: 't1' } } }))
  const singleEnv = env(single)
  event = singleEnv.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('单标签 → 不调 focus(no-op)', same(singleEnv.focused, []), JSON.stringify(singleEnv.focused))
  check('单标签 → 不吞键', event.propagationStopped !== true)
  event = singleEnv.press({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true })
  check('单标签 ← 不吞键', event.propagationStopped !== true)

  // 面板无标签 / 非 pane 节点 / 该会话尚无面板:全部 no-op
  const noTabs = makeTabsStore()
  noTabs.seed(layoutTabs({ nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: [], activeTabId: undefined } } }))
  event = env(noTabs).press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('面板无标签 → 不吞键', event.propagationStopped !== true)

  const notPane = makeTabsStore()
  notPane.seed(layoutTabs({ nodes: { 'pane-1': { kind: 'split' } } }))
  event = env(notPane).press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('activePaneId 指向非 pane 节点 → 不吞键', event.propagationStopped !== true)

  const otherSession = makeTabsStore()
  otherSession.seed(layoutTabs(), 'sess-other')
  event = env(otherSession).press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('该会话尚无面板 → 不吞键', event.propagationStopped !== true)

  // 无降级:服务 / 注册项 / store 任一环不可用 → no-op 且不吞键
  const noopCases = [
    ['sidebarRight 缺席', { sidebarRight: undefined }],
    ['sidebarRight 无 focus', { sidebarRight: { toggleExpanded() {} } }],
    ['slots 缺席', { slots: undefined }],
    ['slots 无 resolveStore', { slots: { entries: () => [{ store: tabs.handle }] } }],
    ['注册项都没有 store', { slots: { entries: () => [{ select: () => ({}) }], resolveStore: () => tabs.instance } }],
    ['uiSession 无 bindingSource', { uiSession: { pendingInteractions: { getSnapshot: () => new Map() }, bindingSource: undefined } }],
    ['resolveStore 抛错(handle 未注册)', {
      slots: { entries: () => [{ store: tabs.handle }], resolveStore: () => { throw new Error('store handle is not registered') } },
    }],
    ['活实例缺 getSnapshot', {
      slots: { entries: () => [{ store: tabs.handle }], resolveStore: () => ({}) },
    }],
    ['快照缺 bySession', {
      slots: { entries: () => [{ store: tabs.handle }], resolveStore: () => ({ getSnapshot: () => ({}) }) },
    }],
    ['focus 抛错(无挂载会话面)', { sidebarRight: { toggleExpanded() {}, focus: () => { throw new Error('sidebarRight: no session surface is mounted') } } }],
  ]
  for (const [label, extra] of noopCases) {
    const envCase = env(tabs, extra)
    const right = envCase.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
    const left = envCase.press({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true })
    check(`${label} → → 不吞键(no-op)`, right.propagationStopped !== true)
    check(`${label} → ← 不吞键(no-op)`, left.propagationStopped !== true)
  }

  // 无当前会话 / current 为空串:视图层源为空,不得切标签
  for (const [label, current] of [['无当前会话', undefined], ['current 为空串', '']]) {
    view.current = current
    const envCase = env(tabs, { sessions })
    event = envCase.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
    check(`${label} → 切标签不吞键`, event.propagationStopped !== true)
  }
  view.current = 'sess-b'

  // card 态(有待处理问答卡片)同样接管:卡片占用的是**裸** ← / →,带 mod+alt 的组合键不冲突
  const cardTabs = makeTabsStore()
  cardTabs.seed(layoutTabs())
  const cardEnv = env(cardTabs, {
    uiSession: {
      pendingInteractions: { getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:20', sessionId: 'sess-b', questions: [{ id: 'q1', question: 'Q?', options: [{ label: 'A' }] }] }]]) },
    },
  })
  event = cardEnv.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('card 态 ⌘/Ctrl+Alt+→ 仍切标签(与裸方向键不冲突)', same(cardEnv.focused, ['t3']), JSON.stringify(cardEnv.focused))
  check('card 态 ⌘/Ctrl+Alt+→ 被吞', event.propagationStopped === true)
  // 裸 ← / → 在 card 态仍归问答卡片(不切右栏标签)
  event = cardEnv.press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('card 态裸 ← 不切右栏标签', same(cardEnv.focused, ['t3']), JSON.stringify(cardEnv.focused))
  // (card 态用的 pendingInteractions 是本用例内联的,随 cardEnv 一起丢弃,无需清理)

  // 键位可经 localStorage 独立覆盖(与左右栏 / 聚焦输入框同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.tabNext': 'mod+alt+.' } }))
  const custom = env(tabs)
  event = custom.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true })
  check('覆盖键位后 ⌘/Ctrl+Alt+→ 不再切标签', same(custom.focused, []), JSON.stringify(custom.focused))
  check('覆盖键位后 ⌘/Ctrl+Alt+→ 不吞键', event.propagationStopped !== true)
  event = custom.press({ key: '.', code: 'Period', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+. → 切标签', same(custom.focused, ['t3']), JSON.stringify(custom.focused))
  check('自定义键位被吞', event.propagationStopped === true)
  event = custom.press({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true })
  check('未覆盖的 ← 仍按默认键位切标签', same(custom.focused, ['t3', 't2']), JSON.stringify(custom.focused))
  storage.delete('dsh-kbd-hotkeys:v1')
}

if (isMain(import.meta.url)) report()
