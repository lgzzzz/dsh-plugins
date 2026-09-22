/**
 * 诊断脚本(非插件产物):右栏文件浏览器:⌘/Ctrl+\ → `sidebarRight.openTab('files')` 后再按 store 布局把刚打开的
 * files 页 `placeTab(…, 0)` 置顶(与标签拖拽同一入口);已在首位则零提交;
 * 跨面板 / 浮窗归属、无当前会话不置顶、打开失败与取数面不可用的 no-op、`bindings` 覆盖。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/rightbar-files.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, check, clone, isMain, loadPlugin, report, same, sessions, storage, view } from './harness.mjs'

// ---- 阶段 6:⌘/Ctrl+\ → 右栏文件浏览器定位并置顶 ----
// 打开 = sidebarRight.openTab('files');置顶 = store 的 actions.placeTab(…, 0)(与标签拖拽同一入口)
console.log('\n--- ⌘/Ctrl+\\ → 右栏打开文件浏览器并置于首位 ---')
{
  const FILES_KIND = 'files'

  /** 假右栏会话级 store:快照 { bySession: { <id>: { layout } } } + 实例动作面 placeTab。 */
  function makeFilesStore() {
    const handle = { spec: {} }
    let state = { bySession: {} }
    const calls = []
    let minted = 0
    /** 复刻上游 placeTab 的落位语义(同面板重排 / 跨面板搬移;越界 clamp)。 */
    const placeTab = (sessionId, tabId, toPaneId, index) => {
      calls.push([sessionId, tabId, toPaneId, index])
      const layout = state.bySession[sessionId]?.layout
      if (layout === undefined) throw new Error('sidebarRight: no session surface is mounted')
      const target = layout.nodes[toPaneId]
      if (target === undefined || target.kind !== 'pane' || target.host !== 'dock') return
      for (const node of Object.values(layout.nodes)) {
        if (node?.kind !== 'pane') continue
        node.tabs = (node.tabs ?? []).filter((id) => id !== tabId)
      }
      const at = Math.max(0, Math.min(index, target.tabs.length))
      target.tabs.splice(at, 0, tabId)
      layout.activePaneId = target.id
    }
    /** 复刻上游 openContent 的页语义:目标面板已有该页 → 只聚焦;否则在面板末尾新建。 */
    const open = (kind, sessionId = 'sess-b') => {
      const layout = state.bySession[sessionId]?.layout
      if (layout === undefined) throw new Error('sidebarRight: no session surface is mounted')
      const pane = layout.nodes[layout.activePaneId]
      if (pane === undefined || pane.kind !== 'pane') throw new Error('sidebarRight: no session surface is mounted')
      const held = (pane.tabs ?? []).find((id) => layout.tabs[id]?.kind === kind)
      if (held !== undefined) {
        pane.activeTabId = held
        return held
      }
      minted += 1
      const tabId = `${kind}-${minted}`
      layout.tabs[tabId] = { id: tabId, kind, contentId: `sidebar://${kind}`, title: kind }
      pane.tabs.push(tabId)
      pane.activeTabId = tabId
      return tabId
    }
    return {
      handle,
      calls,
      open,
      instance: { getSnapshot: () => state, actions: { placeTab }, subscribe: () => () => {} },
      seed: (layout, sessionId = 'sess-b') => { state = { bySession: { [sessionId]: { layout: clone(layout) } } } },
      layout: (sessionId = 'sess-b') => state.bySession[sessionId]?.layout,
    }
  }

  const pageTabs = (id, kind) => ({ [id]: { id, kind, contentId: `sidebar://${kind}` } })
  /** 单面板布局:标签顺序 + 每条记录(供 kind 判定)。 */
  const singlePane = (ids, extraTabs = {}, over = {}) => ({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: [...ids], activeTabId: ids[ids.length - 1] } },
    tabs: { ...pageTabs('t1', 'guide'), ...extraTabs },
    ...over,
  })
  /** rightbar.session 的假 slots:无 store 的干扰项 + 承载 store handle 的注册项。 */
  function filesSlots(tabs) {
    return {
      entries: (key) => (key !== 'rightbar.session' ? [] : [{ select: () => ({}) }, { store: tabs.handle }]),
      resolveStore: (handle, binding) => {
        if (handle !== tabs.handle) throw new Error('resolved the wrong store handle')
        if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
        return tabs.instance
      },
    }
  }
  /** 装一个「右栏完整可用」的环境;`openTab` 落到假 store 上(下一次读快照即新状态)。 */
  function env(tabs, over = {}) {
    const opened = []
    const press = loadPlugin({
      sessions,
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      slots: filesSlots(tabs),
      sidebarRight: {
        toggleExpanded() {},
        openTab: (kind) => { opened.push(kind); tabs.open(kind) },
      },
      ...over,
    })
    return { press, opened }
  }
  const combo = { key: '\\', code: 'Backslash', ctrlKey: true }

  // ① 已有文件浏览器 tab 但不在首位 → 打开(聚焦) + placeTab(…, 0)
  const tabs = makeFilesStore()
  tabs.seed(singlePane(['t1', 't2', 't3'], {
    t2: { id: 't2', kind: 'text', contentId: 'dsh-resource://file/session/sess-b/a.ts' },
    t3: { id: 't3', kind: 'files', contentId: 'sidebar://files' },
  }))
  const first = env(tabs)
  let event = first.press(combo)
  check('⌘/Ctrl+\\ → 调 openTab("files")', same(first.opened, ['files']), JSON.stringify(first.opened))
  check('置顶 → placeTab(sess-b, t3, pane-1, 0)',
    same(tabs.calls, [['sess-b', 't3', 'pane-1', 0]]), JSON.stringify(tabs.calls))
  check('置顶后标签顺序 = [t3, t1, t2]',
    same(tabs.layout().nodes['pane-1'].tabs, ['t3', 't1', 't2']), JSON.stringify(tabs.layout().nodes['pane-1'].tabs))
  check('⌘/Ctrl+\\ 被吞', event.propagationStopped === true)

  // ② 面板里没有文件浏览器 tab → openTab 新建(末尾)→ 再置顶到首位
  const fresh = makeFilesStore()
  fresh.seed(singlePane(['t1']))
  const freshEnv = env(fresh)
  event = freshEnv.press(combo)
  check('无 files tab → 仍然 openTab("files")', same(freshEnv.opened, ['files']), JSON.stringify(freshEnv.opened))
  check('新建的 files tab 被置顶',
    same(fresh.layout().nodes['pane-1'].tabs, ['files-1', 't1']), JSON.stringify(fresh.layout().nodes['pane-1'].tabs))
  check('新建的 files tab 被聚焦', fresh.layout().nodes['pane-1'].activeTabId === 'files-1')
  check('新建后仍被吞', event.propagationStopped === true)

  // ③ 已经在首位 → 零提交、零历史(不调 placeTab),但打开照旧吞键
  const already = makeFilesStore()
  already.seed(singlePane(['files-9', 't1', 't2'], {}, {
    tabs: {
      ...pageTabs('t1', 'guide'),
      t2: { id: 't2', kind: 'text', contentId: 'dsh-resource://file/session/sess-b/a.ts' },
      'files-9': { id: 'files-9', kind: 'files', contentId: 'sidebar://files' },
    },
  }))
  const alreadyEnv = env(already)
  event = alreadyEnv.press(combo)
  check('已在首位 → 不调 placeTab(零提交)', same(already.calls, []), JSON.stringify(already.calls))
  check('已在首位 → 顺序不变', same(already.layout().nodes['pane-1'].tabs, ['files-9', 't1', 't2']),
    JSON.stringify(already.layout().nodes['pane-1'].tabs))
  check('已在首位 → 仍吞键(打开确实做了事)', event.propagationStopped === true)

  // ④ 跨面板:优先当前面板(本次 openTab 的落点),不去搬别的面板里已有的 files tab
  const split = makeFilesStore()
  split.seed({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' },
      'pane-2': { kind: 'pane', host: 'dock', id: 'pane-2', tabs: ['t-other'], activeTabId: 't-other' },
    },
    tabs: {
      ...pageTabs('t1', 'guide'),
      't-other': { id: 't-other', kind: 'files', contentId: 'sidebar://files' },
    },
  })
  const splitEnv = env(split)
  event = splitEnv.press(combo)
  check('跨面板 → 置顶的是当前面板里刚打开的那个', same(split.calls, [['sess-b', 'files-1', 'pane-1', 0]]), JSON.stringify(split.calls))
  check('另一个面板里的 files tab 不被搬动(不被 arriving 关掉)',
    same(split.layout().nodes['pane-2'].tabs, ['t-other']), JSON.stringify(split.layout().nodes['pane-2'].tabs))
  check('跨面板置顶被吞', event.propagationStopped === true)

  // ⑤ 浮窗里的 files tab 不参与置顶(浮窗不碰)
  const floated = makeFilesStore()
  floated.seed({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    floats: ['pane-f'],
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t1'], activeTabId: 't1' },
      'pane-f': { kind: 'pane', host: 'float', id: 'pane-f', tabs: ['t-float'], activeTabId: 't-float' },
    },
    tabs: {
      ...pageTabs('t1', 'guide'),
      't-float': { id: 't-float', kind: 'files', contentId: 'sidebar://files' },
    },
  })
  const floatEnv = env(floated)
  event = floatEnv.press(combo)
  check('浮窗 → 落点是停靠面板', same(floated.calls, [['sess-b', 'files-1', 'pane-1', 0]]), JSON.stringify(floated.calls))
  check('浮窗里的 files tab 原样保留',
    same(floated.layout().nodes['pane-f'].tabs, ['t-float']), JSON.stringify(floated.layout().nodes['pane-f'].tabs))

  // ⑥ 无降级:打开失败(无挂载会话面 / files 类型未注册)→ no-op 且不吞键
  for (const [label, message] of [
    ['无挂载会话面', 'sidebarRight: no session surface is mounted'],
    ['files 类型未注册', 'sidebarRight: no tab type is registered as "files"'],
  ]) {
    const failing = makeFilesStore()
    failing.seed(singlePane(['t1']))
    const caseEnv = env(failing, {
      sidebarRight: { toggleExpanded() {}, openTab: () => { throw new Error(message) } },
    })
    event = caseEnv.press(combo)
    check(`${label} → 不吞键(no-op)`, event.propagationStopped !== true)
    check(`${label} → 不调 placeTab`, same(failing.calls, []), JSON.stringify(failing.calls))
  }

  // ⑦ 服务/注册项不可用:打开成功仍吞键,置顶静默跳过(不回退 DOM、不抛)
  const storeCases = [
    ['sidebarRight 无 openTab', () => ({ sidebarRight: { toggleExpanded() {} } }), false],
    ['slots 缺席', () => ({ slots: undefined }), true],
    ['slots 无 resolveStore', (t) => ({ slots: { entries: () => [{ store: t.handle }] } }), true],
    ['resolveStore 抛错(handle 未注册)', (t) => ({
      slots: { entries: () => [{ store: t.handle }], resolveStore: () => { throw new Error('store handle is not registered') } },
    }), true],
    ['活实例缺 getSnapshot', (t) => ({
      slots: { entries: () => [{ store: t.handle }], resolveStore: () => ({ actions: { placeTab() {} } }) },
    }), true],
    ['快照缺 bySession', (t) => ({
      slots: { entries: () => [{ store: t.handle }], resolveStore: () => ({ getSnapshot: () => ({}), actions: { placeTab() {} } }) },
    }), true],
    ['实例无 actions(只读面)', (t) => ({
      slots: { entries: () => [{ store: t.handle }], resolveStore: () => ({ getSnapshot: () => t.instance.getSnapshot() }) },
    }), true],
  ]
  for (const [label, makeOver, shouldSwallow] of storeCases) {
    const caseTabs = makeFilesStore()
    caseTabs.seed(singlePane(['t1']))
    const caseEnv = env(caseTabs, makeOver(caseTabs))
    event = caseEnv.press(combo)
    check(`${label} → 不崩、吞键=${String(shouldSwallow)}`, (event.propagationStopped === true) === shouldSwallow,
      `stopped=${String(event.propagationStopped)} calls=${JSON.stringify(caseTabs.calls)}`)
  }

  // ⑧ 无当前会话 → 打开照旧,但不得置顶(取不到 sessionId)
  const noSession = makeFilesStore()
  noSession.seed(singlePane(['t1']))
  view.current = undefined
  const noSessionEnv = env(noSession)
  event = noSessionEnv.press(combo)
  check('无当前会话 → 不调 placeTab', same(noSession.calls, []), JSON.stringify(noSession.calls))
  view.current = 'sess-b'

  // ⑨ editing / card 态同样生效(带修饰键的组合不与文本编辑、卡片的裸键冲突)
  const editable = makeFilesStore()
  editable.seed(singlePane(['t1']))
  const editableEnv = env(editable)
  event = editableEnv.press({ ...combo, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+\\ 仍打开并置顶', same(editable.calls, [['sess-b', 'files-1', 'pane-1', 0]]), JSON.stringify(editable.calls))
  check('editing 态被吞', event.propagationStopped === true)

  const cardFiles = makeFilesStore()
  cardFiles.seed(singlePane(['t1']))
  const cardFilesEnv = env(cardFiles, {
    uiSession: {
      pendingInteractions: { getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:21', sessionId: 'sess-b', questions: [{ id: 'q1', question: 'Q?', options: [{ label: 'A' }] }] }]]) },
    },
  })
  event = cardFilesEnv.press(combo)
  check('card 态 ⌘/Ctrl+\\ 仍打开并置顶', cardFiles.calls.length === 1, JSON.stringify(cardFiles.calls))
  check('card 态被吞', event.propagationStopped === true)

  // ⑩ 裸 \ 不触发(mod 才触发)
  const bare = makeFilesStore()
  bare.seed(singlePane(['t1']))
  const bareEnv = env(bare)
  event = bareEnv.press({ key: '\\', code: 'Backslash' })
  check('裸 \\ 不打开文件浏览器', same(bareEnv.opened, []), JSON.stringify(bareEnv.opened))
  check('裸 \\ 不吞键', event.propagationStopped !== true)

  // ⑪ 键位可独立覆盖(与左右栏 / 标签切换 / 聚焦输入框同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.files': 'mod+7' } }))
  const custom = makeFilesStore()
  custom.seed(singlePane(['t1']))
  const customEnv = env(custom)
  event = customEnv.press(combo)
  check('覆盖键位后 ⌘/Ctrl+\\ 不再打开', same(customEnv.opened, []), JSON.stringify(customEnv.opened))
  check('覆盖键位后 ⌘/Ctrl+\\ 不吞键', event.propagationStopped !== true)
  event = customEnv.press({ key: '7', code: 'Digit7', ctrlKey: true })
  check('自定义 ⌘/Ctrl+7 → 打开并置顶', same(custom.calls, [['sess-b', 'files-1', 'pane-1', 0]]), JSON.stringify(custom.calls))
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')
}

if (isMain(import.meta.url)) report()
