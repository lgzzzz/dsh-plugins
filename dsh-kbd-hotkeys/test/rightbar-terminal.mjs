/**
 * 诊断脚本(非插件产物):右栏定位终端:⌘/Ctrl+L,terminal 是 multiple 页(每次 openTab 都铸新 contentId),
 * 故认页由插件读 store 布局(`kind === 'terminal'` 或 `sidebar://terminal/` 地址前缀):
 * 已有则 `focus`(不重复开)、缺则 `openTab('terminal')` 新建,折叠时补一步展开;
 * 含多终端聚焦当前激活者、跨面板 / 浮窗归属、focus 抛错不退化成再开一个、取数面不可用
 * 退化为 openTab 的分支,以及元素级聚焦(仅 `[data-dockkit-pane]` 里的 xterm 补一次聚焦)。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/rightbar-terminal.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, check, clone, isMain, loadPlugin, report, same, sessions, setDockPanes, storage, view } from './harness.mjs'

// ---- 阶段 7:⌘/Ctrl+L → 右栏定位终端(已有则聚焦、缺则新建) ----
// terminal 是 multiple 页:上游每次 openTab 都铸带 UUID 的 contentId,planOpenContent 不按 (kind, contentId) 去重,
// 故直接 openTab('terminal') 会每按一次多开一个终端 ⇒ 认页由插件读 store 布局(kind === 'terminal' 或地址前缀)。
console.log('\n--- ⌘/Ctrl+L → 右栏定位终端(已有则聚焦、缺则新建) ---')
{
  /** 假右栏会话级 store:快照 { bySession: { <id>: { layout } } } + 复刻上游口径的写入。 */
  function makeTerminalStore() {
    const handle = { spec: {} }
    let state = { bySession: {} }
    let minted = 0
    /** 复刻上游 focusTab:改当前面板的 activeTabId(已在当前标签上时上游计划为空)。 */
    const focusTab = (tabId, sessionId = 'sess-b') => {
      const layout = state.bySession[sessionId]?.layout
      if (layout === undefined) throw new Error('sidebarRight: no session surface is mounted')
      const target = layout.nodes[layout.activePaneId]
      if (target === undefined || !(target.tabs ?? []).includes(tabId)) return
      target.activeTabId = tabId
    }
    /** 复刻上游 openTab 对 multiple 页的语义:**每次**都是新 contentId + 新 tab。 */
    const open = (kind, sessionId = 'sess-b') => {
      const layout = state.bySession[sessionId]?.layout
      if (layout === undefined) throw new Error('sidebarRight: no session surface is mounted')
      const target = layout.nodes[layout.activePaneId]
      if (target === undefined || target.kind !== 'pane') throw new Error('sidebarRight: no session surface is mounted')
      minted += 1
      const tabId = `${kind}-${minted}`
      layout.tabs[tabId] = { id: tabId, kind, contentId: `sidebar://${kind}/uuid-${minted}`, title: kind }
      target.tabs.push(tabId)
      target.activeTabId = tabId
      layout.expanded = true
      return tabId
    }
    return {
      handle,
      open,
      focusTab,
      instance: { getSnapshot: () => state },
      seed: (layout, sessionId = 'sess-b') => { state = { bySession: { [sessionId]: { layout: clone(layout) } } } },
      layout: (sessionId = 'sess-b') => state.bySession[sessionId]?.layout,
    }
  }

  const guideTab = { id: 't1', kind: 'guide', contentId: 'sidebar://guide' }
  /** 终端页记录:contentId 带 UUID(`multiple: true` 页类型的上游形态)。 */
  const termTab = (id, uuid) => ({ id, kind: 'terminal', contentId: `sidebar://terminal/${uuid}` })
  /** 单面板布局:标签顺序 + 记录 + 当前标签(默认末个)。 */
  const singlePane = (ids, tabs, active = ids[ids.length - 1], over = {}) => ({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: [...ids], activeTabId: active } },
    tabs,
    ...over,
  })
  /** rightbar.session 的假 slots:无 store 的干扰项 + 承载 store handle 的注册项。 */
  function terminalSlots(tabs) {
    return {
      entries: (key) => (key !== 'rightbar.session' ? [] : [{ select: () => ({}) }, { store: tabs.handle }]),
      resolveStore: (handle, binding) => {
        if (handle !== tabs.handle) throw new Error('resolved the wrong store handle')
        if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
        return tabs.instance
      },
    }
  }
  /** 装一个「右栏完整可用」的环境;openTab / focus / toggleExpanded 都落到假 store 上。 */
  function env(tabs, over = {}) {
    const opened = []
    const focused = []
    const toggled = []
    const press = loadPlugin({
      sessions,
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      slots: terminalSlots(tabs),
      sidebarRight: {
        toggleExpanded: () => {
          toggled.push(true)
          const layout = tabs.layout()
          if (layout !== undefined) layout.expanded = !layout.expanded
        },
        focus: (tabId) => { focused.push(tabId); tabs.focusTab(tabId) },
        openTab: (kind) => { opened.push(kind); tabs.open(kind) },
      },
      ...over,
    })
    return { press, opened, focused, toggled }
  }
  const combo = { key: 'l', code: 'KeyL', ctrlKey: true }

  // ① 没有终端页 → openTab('terminal') 新建;再按一次必须只聚焦、不新建(幂等)
  const fresh = makeTerminalStore()
  fresh.seed(singlePane(['t1'], { t1: guideTab }))
  const freshEnv = env(fresh)
  let event = freshEnv.press(combo)
  check('无终端页 → openTab("terminal") 新建', same(freshEnv.opened, ['terminal']), JSON.stringify(freshEnv.opened))
  check('无终端页 → 不调 focus', same(freshEnv.focused, []), JSON.stringify(freshEnv.focused))
  check('新建后 ⌘/Ctrl+L 被吞', event.propagationStopped === true)
  event = freshEnv.press(combo)
  check('再按一次 → 不再 openTab(不堆积终端)', same(freshEnv.opened, ['terminal']), JSON.stringify(freshEnv.opened))
  check('再按一次 → 只聚焦已有终端', same(freshEnv.focused, ['terminal-1']), JSON.stringify(freshEnv.focused))
  check('再按一次仍被吞', event.propagationStopped === true)

  // ② 已有终端(非当前标签)→ 只 focus,不 openTab、不重排、不动展开态
  const held = makeTerminalStore()
  held.seed(singlePane(['t1', 'term-2', 't3'], {
    t1: guideTab,
    'term-2': termTab('term-2', 'u2'),
    t3: { id: 't3', kind: 'text', contentId: 'dsh-resource://file/session/sess-b/a.ts' },
  }, 't1'))
  const heldEnv = env(held)
  event = heldEnv.press(combo)
  check('已有终端 → 不调 openTab(幂等)', same(heldEnv.opened, []), JSON.stringify(heldEnv.opened))
  check('已有终端 → focus("term-2")', same(heldEnv.focused, ['term-2']), JSON.stringify(heldEnv.focused))
  check('已有终端 → 标签顺序不变(不重排)', same(held.layout().nodes['pane-1'].tabs, ['t1', 'term-2', 't3']),
    JSON.stringify(held.layout().nodes['pane-1'].tabs))
  check('已展开 → 不调 toggleExpanded', same(heldEnv.toggled, []), JSON.stringify(heldEnv.toggled))
  check('已有终端被吞', event.propagationStopped === true)

  // ③ 面板内有多个终端且当前标签就是其中一个 → 聚焦当前这个(不把用户挪到别的终端)
  const multi = makeTerminalStore()
  multi.seed(singlePane(['term-a', 'term-b', 't1'], {
    'term-a': termTab('term-a', 'a'),
    'term-b': termTab('term-b', 'b'),
    t1: guideTab,
  }, 'term-b'))
  const multiEnv = env(multi)
  event = multiEnv.press(combo)
  check('多个终端 → 聚焦当前激活的那个', same(multiEnv.focused, ['term-b']), JSON.stringify(multiEnv.focused))
  check('多个终端 → 不调 openTab', same(multiEnv.opened, []), JSON.stringify(multiEnv.opened))

  // ④ 当前面板没有、别的停靠面板有 → 聚焦那个面板里的终端(不新建)
  const otherPane = makeTerminalStore()
  otherPane.seed({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' },
      'pane-2': { kind: 'pane', host: 'dock', id: 'pane-2', tabs: ['term-x'], activeTabId: 'term-x' },
    },
    tabs: { t1: guideTab, 'term-x': termTab('term-x', 'x') },
  })
  const otherEnv = env(otherPane)
  event = otherEnv.press(combo)
  check('别的停靠面板有终端 → focus("term-x")', same(otherEnv.focused, ['term-x']), JSON.stringify(otherEnv.focused))
  check('别的停靠面板有终端 → 不新建', same(otherEnv.opened, []), JSON.stringify(otherEnv.opened))
  check('跨面板定位被吞', event.propagationStopped === true)

  // ⑤ 只有浮窗里有终端 → 浮窗不参与认页 → 新建(浮窗里的 tab 原样保留)
  const floated = makeTerminalStore()
  floated.seed({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    floats: ['pane-f'],
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' },
      'pane-f': { kind: 'pane', host: 'float', id: 'pane-f', tabs: ['term-float'], activeTabId: 'term-float' },
    },
    tabs: { t1: guideTab, 'term-float': termTab('term-float', 'f') },
  })
  const floatEnv = env(floated)
  event = floatEnv.press(combo)
  check('浮窗里的终端不算「已有」→ 新建', same(floatEnv.opened, ['terminal']), JSON.stringify(floatEnv.opened))
  check('浮窗里的终端不被聚焦', same(floatEnv.focused, []), JSON.stringify(floatEnv.focused))
  check('浮窗里的终端原样保留', same(floated.layout().nodes['pane-f'].tabs, ['term-float']),
    JSON.stringify(floated.layout().nodes['pane-f'].tabs))

  // ⑥ 右栏折叠着 + 已有终端 → 聚焦并补一步展开(focus 本身不动展开态)
  const collapsed = makeTerminalStore()
  collapsed.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1', { expanded: false }))
  const collapsedEnv = env(collapsed)
  event = collapsedEnv.press(combo)
  check('折叠 + 已有终端 → 先 focus', same(collapsedEnv.focused, ['term-2']), JSON.stringify(collapsedEnv.focused))
  check('折叠 + 已有终端 → toggleExpanded 展开', same(collapsedEnv.toggled, [true]), JSON.stringify(collapsedEnv.toggled))
  check('折叠 + 已有终端 → 展开态已翻转', collapsed.layout().expanded === true)
  check('折叠 + 已有终端 → 不新建', same(collapsedEnv.opened, []), JSON.stringify(collapsedEnv.opened))
  check('折叠 + 已有终端被吞', event.propagationStopped === true)

  // ⑦ expanded 读不到(既非 true 也非 false)→ 不动展开态(宁可少做,也不把开着的右栏关掉)
  const unknown = makeTerminalStore()
  unknown.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1', { expanded: undefined }))
  const unknownEnv = env(unknown)
  event = unknownEnv.press(combo)
  check('expanded 读不到 → 不 toggle(不猜状态)', same(unknownEnv.toggled, []), JSON.stringify(unknownEnv.toggled))
  check('expanded 读不到 → 仍 focus 并吞键', same(unknownEnv.focused, ['term-2']) && event.propagationStopped === true)

  // ⑧ 认页兼容「只有 contentId 前缀、没有 kind」的记录(防御上游记录形态)
  const byAddress = makeTerminalStore()
  byAddress.seed(singlePane(['t1', 'addr'], {
    t1: guideTab,
    addr: { id: 'addr', contentId: 'sidebar://terminal/uuid-addr' },
  }, 't1'))
  const byAddressEnv = env(byAddress)
  event = byAddressEnv.press(combo)
  check('凭 sidebar://terminal/<uuid> 地址认页 → focus', same(byAddressEnv.focused, ['addr']), JSON.stringify(byAddressEnv.focused))
  check('凭地址认页 → 不新建', same(byAddressEnv.opened, []), JSON.stringify(byAddressEnv.opened))

  // ⑨ 无降级:任一层不可用 / 上游抛错 → no-op 不吞键(已有终端而 focus 抛错时不得退化成再开一个)
  for (const [label, makeOver] of [
    ['sidebarRight 缺席', () => ({ sidebarRight: undefined })],
    ['sidebarRight 无 openTab(且无终端)', () => ({ sidebarRight: { toggleExpanded() {}, focus() {} } })],
    ['无挂载会话面(openTab 抛错)', () => ({ sidebarRight: { toggleExpanded() {}, focus() {}, openTab: () => { throw new Error('sidebarRight: no session surface is mounted') } } })],
    ['terminal 类型未注册(openTab 抛错)', () => ({ sidebarRight: { toggleExpanded() {}, focus() {}, openTab: () => { throw new Error('sidebarRight: no tab type is registered as "terminal"') } } })],
  ]) {
    const caseStore = makeTerminalStore()
    caseStore.seed(singlePane(['t1'], { t1: guideTab }))
    const caseEnv = env(caseStore, makeOver())
    event = caseEnv.press(combo)
    check(`${label} → 不崩、不吞键`, event.propagationStopped !== true)
  }
  // 已有终端但 focus 抛错(无挂载会话面)→ no-op 不吞键,且**不**退化成再开一个终端
  const focusThrowsOpened = []
  const focusThrows = makeTerminalStore()
  focusThrows.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1'))
  const focusThrowsEnv = env(focusThrows, {
    sidebarRight: {
      toggleExpanded() {},
      openTab: (kind) => { focusThrowsOpened.push(kind) },
      focus: () => { throw new Error('sidebarRight: no session surface is mounted') },
    },
  })
  event = focusThrowsEnv.press(combo)
  check('已有终端但 focus 抛错 → 不吞键', event.propagationStopped !== true)
  check('已有终端但 focus 抛错 → 不新建(不重复开终端)', same(focusThrowsOpened, []), JSON.stringify(focusThrowsOpened))
  // 已有终端但 sidebarRight 无 focus 面 → 不得退化成「再开一个终端」
  const noFocus = makeTerminalStore()
  noFocus.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1'))
  const noFocusOpened = []
  const noFocusEnv = env(noFocus, {
    sidebarRight: { toggleExpanded() {}, openTab: (kind) => { noFocusOpened.push(kind) } },
  })
  event = noFocusEnv.press(combo)
  check('已有终端但无 focus → 不吞键', event.propagationStopped !== true)
  check('已有终端但无 focus → 不新建(不重复开终端)', same(noFocusOpened, []), JSON.stringify(noFocusOpened))
  // 取数面不可用(无从判重)→ 退化为 openTab 新建:与上游 openTab 同一行为,且吞键
  const noSlots = makeTerminalStore()
  noSlots.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1'))
  const noSlotsEnv = env(noSlots, { slots: undefined })
  event = noSlotsEnv.press(combo)
  check('slots 缺席 → 无从判重,按 openTab 新建', same(noSlotsEnv.opened, ['terminal']), JSON.stringify(noSlotsEnv.opened))
  check('slots 缺席 → 吞键', event.propagationStopped === true)
  // 会话作用域绑定面缺席(alpha.1 的 resolve(sessionId) 已删除时的退化形态)→ 同样无从判重
  const noBinding = makeTerminalStore()
  noBinding.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1'))
  const noBindingEnv = env(noBinding, {
    uiSession: { pendingInteractions: { getSnapshot: () => new Map() }, bindingSource: undefined },
  })
  event = noBindingEnv.press(combo)
  check('无作用域绑定面 → 取不到布局,按 openTab 新建', same(noBindingEnv.opened, ['terminal']), JSON.stringify(noBindingEnv.opened))
  check('无作用域绑定面 → 吞键', event.propagationStopped === true)
  // 当前会话在 Controller 里没有绑定(未物化)→ 同上
  const noOwner = makeTerminalStore()
  noOwner.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1'))
  const noOwnerEnv = env(noOwner, { sessions: { list: sessions.list, binding: () => undefined } })
  event = noOwnerEnv.press(combo)
  check('sessions.binding 无该会话 → 取不到布局,按 openTab 新建', same(noOwnerEnv.opened, ['terminal']), JSON.stringify(noOwnerEnv.opened))
  check('sessions.binding 无该会话 → 吞键', event.propagationStopped === true)

  // ⑩ 无当前会话 / 该会话尚无面板 → 取不到布局,openTab 在无挂载会话面时抛错 → no-op 不吞键
  const noSession = makeTerminalStore()
  view.current = undefined
  const noSessionEnv = env(noSession)
  event = noSessionEnv.press(combo)
  check('无当前会话 + 无面板 → 不吞键', event.propagationStopped !== true)
  view.current = 'sess-b'

  // ⑪ card / editing 态同样生效(带修饰键的组合不与卡片的裸键、文本编辑冲突)
  const editable = makeTerminalStore()
  editable.seed(singlePane(['t1'], { t1: guideTab }))
  const editableEnv = env(editable)
  event = editableEnv.press({ ...combo, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+L 仍新建终端', same(editableEnv.opened, ['terminal']), JSON.stringify(editableEnv.opened))
  check('editing 态被吞', event.propagationStopped === true)

  const cardSearch = makeTerminalStore()
  cardSearch.seed(singlePane(['t1'], { t1: guideTab }))
  const cardSearchEnv = env(cardSearch, {
    uiSession: {
      pendingInteractions: { getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:22', sessionId: 'sess-b', questions: [{ id: 'q1', question: 'Q?', options: [{ label: 'A' }] }] }]]) },
    },
  })
  event = cardSearchEnv.press(combo)
  check('card 态 ⌘/Ctrl+L 仍新建终端', same(cardSearchEnv.opened, ['terminal']), JSON.stringify(cardSearchEnv.opened))
  check('card 态被吞', event.propagationStopped === true)

  // ⑫ ⌘(metaKey)与 ⌃(ctrlKey)都归一化成同一个 mod 组合(macOS 上两者都能触发)
  const mac = makeTerminalStore()
  mac.seed(singlePane(['t1'], { t1: guideTab }))
  const macEnv = env(mac)
  event = macEnv.press({ key: 'l', code: 'KeyL', metaKey: true })
  check('⌘L 同样触发', same(macEnv.opened, ['terminal']), JSON.stringify(macEnv.opened))
  check('⌘L 被吞', event.propagationStopped === true)

  // ⑬ 裸 l 不触发(mod 才触发,不能抢文本输入)
  const bare = makeTerminalStore()
  bare.seed(singlePane(['t1'], { t1: guideTab }))
  const bareEnv = env(bare)
  event = bareEnv.press({ key: 'l', code: 'KeyL' })
  check('裸 l 不打开终端', same(bareEnv.opened, []), JSON.stringify(bareEnv.opened))
  check('裸 l 不吞键', event.propagationStopped !== true)

  // ⑭ 键位可独立覆盖(与右栏其它动作同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.terminal': 'mod+alt+t' } }))
  const custom = makeTerminalStore()
  custom.seed(singlePane(['t1'], { t1: guideTab }))
  const customEnv = env(custom)
  event = customEnv.press(combo)
  check('覆盖键位后 ⌘/Ctrl+L 不再打开终端', same(customEnv.opened, []), JSON.stringify(customEnv.opened))
  check('覆盖键位后 ⌘/Ctrl+L 不吞键', event.propagationStopped !== true)
  event = customEnv.press({ key: 't', code: 'KeyT', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+T → 新建终端', same(customEnv.opened, ['terminal']), JSON.stringify(customEnv.opened))
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')

  // ⑮ ⌘/Ctrl+L 的元素级聚焦:上游 focus(tabId) 只聚焦标签,终端内容的 DOM 焦点由 TerminalBody 的
  //     [visible, state.writable] effect 完成;终端已是当前标签时该依赖不变、effect 不重跑,故插件按 store 的 paneId
  //     找 [data-dockkit-pane] 里的 textarea.xterm-helper-textarea 补一次聚焦(不遍历标签 / 不合成事件)。
  {
    /** 带属性与子树查询的假元素:模拟 dockkit 面板 + xterm 隐藏输入框。 */
    class FakeAttributedElement extends FakeHTMLElement {
      constructor(tag, attributes = {}, content = {}) {
        super(tag)
        this.attributes = attributes
        this.content = content
      }
      getAttribute(name) { return this.attributes[name] ?? null }
      querySelector(selector) { return this.content[selector] ?? null }
    }
    const makeTerminalDom = (paneId) => {
      const textarea = new FakeAttributedElement('TEXTAREA')
      const pane = new FakeAttributedElement('SECTION', { 'data-dockkit-pane': paneId }, {
        'textarea.xterm-helper-textarea': textarea,
      })
      return { pane, textarea }
    }

    // a) 终端就是当前标签(用户正看着终端、焦点却在别处)→ 聚焦 xterm,且不新建
    const shown = makeTerminalStore()
    shown.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 'term-2'))
    const shownEnv = env(shown)
    const shownDom = makeTerminalDom('pane-1')
    setDockPanes([shownDom.pane])
    event = shownEnv.press(combo)
    check('终端就是当前标签 → 聚焦 xterm', shownDom.textarea.focused === true)
    check('终端就是当前标签 → 只 focus 标签、不新建',
      same(shownEnv.focused, ['term-2']) && same(shownEnv.opened, []), JSON.stringify([shownEnv.focused, shownEnv.opened]))
    check('终端就是当前标签 → 吞键', event.propagationStopped === true)

    // b) 分屏:只碰 store 给出的**那个面板**(两个面板各有 xterm)
    const split = makeTerminalStore()
    split.seed({
      rootId: 'pane-1',
      activePaneId: 'pane-1',
      expanded: true,
      nodes: {
        'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' },
        'pane-2': { kind: 'pane', host: 'dock', id: 'pane-2', tabs: ['term-x'], activeTabId: 'term-x' },
      },
      tabs: { t1: guideTab, 'term-x': termTab('term-x', 'x') },
    })
    const splitEnv = env(split)
    const domOne = makeTerminalDom('pane-1')
    const domTwo = makeTerminalDom('pane-2')
    setDockPanes([domOne.pane, domTwo.pane])
    event = splitEnv.press(combo)
    check('分屏 → 只聚焦终端所在面板的 xterm',
      domTwo.textarea.focused === true && domOne.textarea.focused !== true)
    check('分屏 → 吞键', event.propagationStopped === true)

    // c) 终端**不是**当前标签:visible 会翻转,上游自己会聚焦 → 插件不代劳
    const notCurrent = makeTerminalStore()
    notCurrent.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 't1'))
    const notCurrentEnv = env(notCurrent)
    const notCurrentDom = makeTerminalDom('pane-1')
    setDockPanes([notCurrentDom.pane])
    event = notCurrentEnv.press(combo)
    check('终端不是当前标签 → 插件不抢上游的自动聚焦', notCurrentDom.textarea.focused !== true)
    check('终端不是当前标签 → 仍 focus 标签并吞键',
      same(notCurrentEnv.focused, ['term-2']) && event.propagationStopped === true)

    // d) 面板里还没有 xterm(未挂载 / 正在创建)→ 少这一步,不影响标签聚焦的返回值
    const noScreen = makeTerminalStore()
    noScreen.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 'term-2'))
    const noScreenEnv = env(noScreen)
    setDockPanes([new FakeAttributedElement('SECTION', { 'data-dockkit-pane': 'pane-1' })])
    event = noScreenEnv.press(combo)
    check('面板里没有 xterm → 不崩、仍吞键', event.propagationStopped === true)

    // e) xterm 的 focus() 抛错 → 兜住,不崩、不吞键之路不受影响
    const throwing = makeTerminalStore()
    throwing.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 'term-2'))
    const throwingEnv = env(throwing)
    const throwingDom = makeTerminalDom('pane-1')
    throwingDom.textarea.focus = () => { throw new Error('focus failed') }
    setDockPanes([throwingDom.pane])
    event = throwingEnv.press(combo)
    check('xterm 聚焦抛错 → no-op 不崩、仍吞键', event.propagationStopped === true)

    // f) 右栏折叠着(终端已是当前标签):展开会让 visible 翻转、上游自己聚焦 → 插件不在展开前抢这次聚焦
    const collapsedCurrent = makeTerminalStore()
    collapsedCurrent.seed(singlePane(['t1', 'term-2'], { t1: guideTab, 'term-2': termTab('term-2', 'u2') }, 'term-2', { expanded: false }))
    const collapsedCurrentEnv = env(collapsedCurrent)
    const collapsedDom = makeTerminalDom('pane-1')
    setDockPanes([collapsedDom.pane])
    event = collapsedCurrentEnv.press(combo)
    check('折叠 + 终端是当前标签 → 不抢上游的自动聚焦', collapsedDom.textarea.focused !== true)
    check('折叠 + 终端是当前标签 → 仍展开并吞键',
      same(collapsedCurrentEnv.toggled, [true]) && event.propagationStopped === true)

    // 注入的假面板只服务本组用例;清空后其余断言仍建立在「空 DOM」之上
    setDockPanes([])
  }
}

if (isMain(import.meta.url)) report()
