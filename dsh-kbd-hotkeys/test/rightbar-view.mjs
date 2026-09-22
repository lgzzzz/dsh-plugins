/**
 * 诊断脚本(非插件产物):右栏视图开关 —— ⌘/Ctrl+D 自动换行;diff 分栏默认**不绑键位**
 * (只在 ⌘/Ctrl+S 切换全屏时由插件同步,见 test/rightbar-fullscreen.mjs),手动切换靠 localStorage 改绑。
 *
 * 目标 = **当前面板的当前标签**(布局取自 rightbar.session store 的 `bySession[id].layout`;
 * `activePaneId` 在上游由 dockkit `focusPane` 写入,**浮窗被聚焦时就是那个浮窗**);
 * 按标签 kind 认承载其视图状态的注册项(`sidebar.right.pane.tab` 的 keyed cell),
 * 再经会话作用域绑定 resolveStore 取活实例,调上游 store 动作(与页头工具条按钮同一入口)。
 *
 * 覆盖:两种页各自生效、动作以方法形式调用、非目标页 / 非当前面板的 no-op、**⌘/Ctrl+D 恒吞键**、
 * **⌘/Ctrl+W 无绑定(不触发也不吞)**、浮窗被聚焦时作用于浮窗里的标签、状态桶懒建、
 * card / editing 态、裸键、`bindings` 覆盖(diff 分栏改绑后生效、原键位交回浏览器)、
 * 速查表展示行(换行 = Ctrl+D、diff 分栏 = 未绑定),以及取数链路逐环缺失的 no-op
 * (每条都断言真的走到了目标分支)。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/rightbar-view.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, check, classHas, clone, collectNodes, isMain, loadPlugin, nodeText, report, same, sessions, storage, view } from './harness.mjs'

// ---- ⌘/Ctrl+D → 右栏自动换行(diff / 文件预览);diff 分栏默认未绑定 ----
console.log('\n--- ⌘/Ctrl+D 右栏自动换行、diff 分栏默认未绑定 ---')
{
  /** 上游两个实现包在 slot 上声明的 cell key(注册项自己声明的实现身份)。 */
  const REVIEW_KEY = '@deepseek-ai/dsh-client-ui-deliverables'
  const PREVIEW_KEY = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview'
  const FILES_KEY = '@deepseek-ai/dsh-client-ui-sidebar-files'
  const PANE_TAB_SLOT = 'sidebar.right.pane.tab'

  /** 被吞 = preventDefault 与 stopPropagation 都做了(浏览器默认行为被拦下)。 */
  const swallowed = (event) => event.propagationStopped === true && event.defaultPrevented === true
  /** 没被吞 = 两个都没做(键位留给浏览器)。 */
  const notSwallowed = (event) => event.propagationStopped !== true && event.defaultPrevented !== true

  /** 假右栏布局 store(与 ⌘/Ctrl+Alt+←/→、⌘/Ctrl+, 同源):快照 { bySession: { <id>: { layout } } }。 */
  function makeLayoutStore() {
    const handle = { spec: {} }
    let state = { bySession: {} }
    return {
      handle,
      instance: { getSnapshot: () => state },
      seed: (layout, sessionId = 'sess-b') => { state = { bySession: { [sessionId]: { layout: clone(layout) } } } },
      layout: (sessionId = 'sess-b') => state.bySession[sessionId]?.layout,
    }
  }

  /**
   * 假视图 store:快照 { byTab: { <tabId>: { split, wrap } } } + 动作 toggledSplit / toggledWrap。
   * `lazy: true` 复刻文档预览 store 的「首次写才建桶」(`bucket ??= fresh()`);默认复刻变更审阅 store 的「无桶即抛」。
   * `wrapOnly: true` 只有换行动作(文档预览没有分栏)。动作写成读 `this` 的类方法形态,
   * 摘下来调用即丢 this —— 与上游服务面同款,回归才测得出。
   */
  function makeViewStore(seed = {}, options = {}) {
    const handle = { spec: {} }
    const calls = []
    let receiverLost = false
    let state = { byTab: clone(seed) }
    const flip = (name, receiver, tabId) => {
      if (receiver !== instance.actions) receiverLost = true
      calls.push([name, tabId])
      let bucket = state.byTab[tabId]
      if (bucket === undefined) {
        if (options.lazy !== true) throw new Error(`ui-deliverables: no review state for tab "${tabId}"`)
        bucket = { split: true, wrap: true }
        state.byTab[tabId] = bucket
      }
      if (name === 'toggledSplit') bucket.split = !bucket.split
      else bucket.wrap = !bucket.wrap
    }
    const actions = options.wrapOnly === true
      ? { toggledWrap(tabId) { flip('toggledWrap', this, tabId) } }
      : {
          toggledSplit(tabId) { flip('toggledSplit', this, tabId) },
          toggledWrap(tabId) { flip('toggledWrap', this, tabId) },
        }
    const instance = { getSnapshot: () => state, actions, subscribe: () => () => {} }
    return {
      handle,
      calls,
      instance,
      read: () => state,
      bucket: (tabId) => state.byTab[tabId],
      receiverKept: () => receiverLost === false,
    }
  }

  /**
   * 假 slots:`rightbar.session` 恒可用(否则插件在布局那一层就退出,测不到目标分支),
   * `sidebar.right.pane.tab` 一侧由 `degrade` 替换;`queried` 记录被查询过的 slot key,
   * 供退化用例断言「真的走到了目标分支」。
   */
  function viewSlots(layoutStore, review, preview, degrade = {}) {
    const queried = []
    const paneEntries = degrade.entries ?? [
      { options: { key: FILES_KEY }, store: { spec: {} } }, // 别的页:不得被认领
      { options: { key: REVIEW_KEY } }, // 目标 key 但无 store,必须跳过
      { store: preview.handle }, // 无 options.key:不得被认领
      { options: { key: REVIEW_KEY }, store: review.handle },
      { options: { key: PREVIEW_KEY }, store: preview.handle },
    ]
    const resolvePane = degrade.resolveStore ?? ((handle) => {
      if (handle === review.handle) return review.instance
      if (handle === preview.handle) return preview.instance
      throw new Error('store handle is not registered')
    })
    return {
      queried,
      entries: (key) => {
        queried.push(key)
        if (key === 'rightbar.session') return [{ select: () => ({}) }, { store: layoutStore.handle }]
        if (key === PANE_TAB_SLOT) return paneEntries
        return []
      },
      resolveStore: (handle, binding) => {
        if (binding?.key !== 'sess-b') throw new Error(`bad scope binding: ${JSON.stringify(binding)}`)
        if (handle === layoutStore.handle) return layoutStore.instance
        return resolvePane(handle)
      },
    }
  }

  /** 标签记录夹具(按标签 id 索引,`singlePane` 直接取用)。 */
  const tabRecords = {
    't-guide': { id: 't-guide', kind: 'guide', contentId: 'sidebar://guide' },
    't-diff': { id: 't-diff', kind: 'changes-review', contentId: 'dsh-resource://changes-review/session/sess-b/3' },
    't-file': { id: 't-file', kind: 'text', contentId: 'dsh-resource://file/session/sess-b/a.ts' },
    't-files': { id: 't-files', kind: 'files', contentId: 'sidebar://files' },
  }
  /** 单停靠面板布局:标签顺序 + 当前标签。 */
  const singlePane = (ids, activeId = ids[ids.length - 1]) => ({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: { 'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: [...ids], activeTabId: activeId } },
    tabs: Object.fromEntries(ids.map((id) => [id, tabRecords[id]])),
  })

  /**
   * 装一个「右栏可用」的环境。
   * @param degrade - 只替换 `sidebar.right.pane.tab` 一侧的 { entries?, resolveStore? }。
   * @param over - 覆盖其余服务桩(如 uiSession)。
   * @param seeds - 覆盖两个视图 store 的初始桶。
   */
  function env(degrade = {}, over = {}, seeds = {}) {
    const layoutStore = makeLayoutStore()
    const review = makeViewStore(seeds.review ?? { 't-diff': { split: true, wrap: false } })
    const preview = makeViewStore(seeds.preview ?? { 't-file': { wrap: true } }, { wrapOnly: true, lazy: true })
    const slots = viewSlots(layoutStore, review, preview, degrade)
    const press = loadPlugin({
      sessions,
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      slots,
      sidebarRight: { toggleExpanded() {} },
      ...over,
    })
    return { press, layoutStore, review, preview, slots }
  }

  const comboD = { key: 'd', code: 'KeyD', ctrlKey: true }
  const comboW = { key: 'w', code: 'KeyW', ctrlKey: true }
  const comboAltD = { key: 'd', code: 'KeyD', ctrlKey: true, altKey: true }

  // ① 当前标签是 diff → ⌘/Ctrl+D 切换行(变更审阅 store 自己的 wrap),恒吞键
  const diffEnv = env()
  diffEnv.layoutStore.seed(singlePane(['t-guide', 't-diff'], 't-diff'))
  let event = diffEnv.press(comboD)
  check('diff 当前标签 → 调 toggledWrap(t-diff)', same(diffEnv.review.calls, [['toggledWrap', 't-diff']]),
    JSON.stringify(diffEnv.review.calls))
  check('diff 换行 false → true', diffEnv.review.bucket('t-diff').wrap === true, JSON.stringify(diffEnv.review.bucket('t-diff')))
  check('动作以方法形式调用(保留 this)', diffEnv.review.receiverKept())
  check('⌘/Ctrl+D 被吞(preventDefault + stopPropagation)', swallowed(event),
    `stopped=${String(event.propagationStopped)} prevented=${String(event.defaultPrevented)}`)
  check('切 diff 换行不碰分栏状态', diffEnv.review.bucket('t-diff').split === true)
  check('文档预览 store 未被误调', same(diffEnv.preview.calls, []), JSON.stringify(diffEnv.preview.calls))

  // ② 再按一次 → 切回不换行(往返)
  event = diffEnv.press(comboD)
  check('再按 ⌘/Ctrl+D → 换行 true → false', diffEnv.review.bucket('t-diff').wrap === false && diffEnv.review.calls.length === 2,
    JSON.stringify(diffEnv.review.calls))

  // ③ 当前标签是文件预览 → ⌘/Ctrl+D 切文档预览 store 的换行
  const onPreview = env()
  onPreview.layoutStore.seed(singlePane(['t-diff', 't-file'], 't-file'))
  event = onPreview.press(comboD)
  check('文件预览当前标签 → 调 toggledWrap(t-file)', same(onPreview.preview.calls, [['toggledWrap', 't-file']]),
    JSON.stringify(onPreview.preview.calls))
  check('预览换行 true → false', onPreview.preview.bucket('t-file').wrap === false, JSON.stringify(onPreview.preview.bucket('t-file')))
  check('动作以方法形式调用(预览)', onPreview.preview.receiverKept())
  check('文件预览 ⌘/Ctrl+D 被吞', swallowed(event))
  check('diff store 未被误调', same(onPreview.review.calls, []), JSON.stringify(onPreview.review.calls))

  // ③b 预览页还没有状态桶 → 上游 toggledWrap 懒建桶(`bucket ??= fresh()`,默认 wrap = true)后取反
  const lazyBucket = env({}, {}, { preview: {} })
  lazyBucket.layoutStore.seed(singlePane(['t-file'], 't-file'))
  event = lazyBucket.press(comboD)
  check('预览无状态桶 → 调 toggledWrap 后懒建桶并切换(wrap true → false)',
    lazyBucket.preview.bucket('t-file')?.wrap === false && same(lazyBucket.preview.calls, [['toggledWrap', 't-file']]),
    JSON.stringify(lazyBucket.preview.bucket('t-file')))
  check('预览无状态桶 → 仍算生效并吞键', swallowed(event))

  // ④ 当前标签是文件浏览器 / 引导页:没有换行可切,no-op **但恒吞键**(不让浏览器弹「添加书签」)
  for (const [label, activeId] of [['文件浏览器', 't-files'], ['引导页', 't-guide']]) {
    const other = env()
    other.layoutStore.seed(singlePane([activeId, 't-diff'], activeId))
    event = other.press(comboD)
    check(`${label}当前标签 → ⌘/Ctrl+D 恒吞键(no-op 也吞)`, swallowed(event),
      `stopped=${String(event.propagationStopped)} prevented=${String(event.defaultPrevented)}`)
    check(`${label}当前标签 → 两 store 都不调动作`,
      same(other.review.calls, []) && same(other.preview.calls, []),
      JSON.stringify([other.review.calls, other.preview.calls]))
  }

  // ⑤ 只作用于**当前面板**的当前标签:另一个停靠面板里的 diff 不被误伤
  const splitEnv = env()
  splitEnv.layoutStore.seed({
    rootId: 'pane-1',
    activePaneId: 'pane-1',
    expanded: true,
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t-files'], activeTabId: 't-files' },
      'pane-2': { kind: 'pane', host: 'dock', id: 'pane-2', tabs: ['t-diff'], activeTabId: 't-diff' },
    },
    tabs: { 't-files': tabRecords['t-files'], 't-diff': tabRecords['t-diff'] },
  })
  event = splitEnv.press(comboD)
  check('当前面板是文件浏览器 → 别面板的 diff 不被切换', same(splitEnv.review.calls, []), JSON.stringify(splitEnv.review.calls))
  check('非当前面板 → ⌘/Ctrl+D 仍恒吞键', swallowed(event))

  // ⑤b 浮窗被聚焦时上游 `activePaneId` 就指向该浮窗(dockkit focusPane)→ 作用于浮窗里的当前标签
  const floatEnv = env()
  floatEnv.layoutStore.seed({
    rootId: 'pane-1',
    activePaneId: 'pane-f',
    expanded: true,
    floats: ['pane-f'],
    nodes: {
      'pane-1': { kind: 'pane', host: 'dock', id: 'pane-1', tabs: ['t-files'], activeTabId: 't-files' },
      'pane-f': { kind: 'pane', host: 'float', id: 'pane-f', tabs: ['t-diff'], activeTabId: 't-diff' },
    },
    tabs: { 't-files': tabRecords['t-files'], 't-diff': tabRecords['t-diff'] },
  })
  event = floatEnv.press(comboD)
  check('浮窗被聚焦 → 作用于浮窗里的 diff 标签(与上游 activePaneId 同口径)',
    same(floatEnv.review.calls, [['toggledWrap', 't-diff']]) && swallowed(event),
    JSON.stringify(floatEnv.review.calls))

  // ⑥ card / editing 态照常生效(带修饰键的组合不与卡片裸键、文本编辑冲突)
  const editable = env()
  editable.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
  event = editable.press({ ...comboD, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+D 仍切换行并吞键', swallowed(event) && editable.review.calls.length === 1,
    JSON.stringify(editable.review.calls))
  const realCard = env({
    uiSession: {
      pendingInteractions: {
        getSnapshot: () => new Map([['sess-b', {
          kind: 'question', key: 'question:21', sessionId: 'sess-b',
          questions: [{ id: 'q1', question: 'Q?', options: [{ label: 'A' }] }],
        }]]),
      },
    },
  })
  realCard.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
  event = realCard.press(comboD)
  check('card 态 ⌘/Ctrl+D 仍切换行并吞键', swallowed(event) && realCard.review.calls.length === 1,
    JSON.stringify(realCard.review.calls))

  // ⑦ 裸 d 不触发(mod 才触发),也不吞键
  const bareEnv = env()
  bareEnv.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
  event = bareEnv.press({ key: 'd', code: 'KeyD' })
  check('裸 d 不触发且不吞键', notSwallowed(event) && same(bareEnv.review.calls, []), JSON.stringify(bareEnv.review.calls))

  // ⑦b ⌘/Ctrl+W 不绑定任何动作:不调动作、不吞键(键位留在浏览器)
  event = bareEnv.press(comboW)
  check('⌘/Ctrl+W 无绑定 → 不调动作', same(bareEnv.review.calls, []) && same(bareEnv.preview.calls, []),
    JSON.stringify([bareEnv.review.calls, bareEnv.preview.calls]))
  check('⌘/Ctrl+W 无绑定 → 不吞键(交回浏览器)', notSwallowed(event),
    `stopped=${String(event.propagationStopped)} prevented=${String(event.defaultPrevented)}`)

  // ⑧ 无当前会话 / 该会话无面板:不调动作,键位仍归插件(⌘/Ctrl+D 恒吞)
  const noSession = env()
  noSession.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
  view.current = undefined
  event = noSession.press(comboD)
  const noSessionD = swallowed(event) && noSession.review.calls.length === 0
  view.current = 'sess-b'
  const noSurface = env()
  noSurface.layoutStore.seed(singlePane(['t-diff'], 't-diff'), 'sess-other')
  event = noSurface.press(comboD)
  check('无当前会话 / 该会话无面板 → 不调动作(⌘/Ctrl+D 恒吞)',
    noSessionD && swallowed(event) && noSurface.review.calls.length === 0,
    `noSessionD=${String(noSessionD)} stopped=${String(event.propagationStopped)}`)

  // ⑨ 无降级 A:取数面整体缺席(layout 层即失败,到不了目标分支)
  for (const [label, over] of [
    ['slots 缺席', { slots: undefined }],
    ['slots 无 entries', { slots: { resolveStore: () => { throw new Error('unused') } } }],
    ['slots 无 resolveStore', { slots: { entries: () => [] } }],
  ]) {
    const caseEnv = env({}, over)
    caseEnv.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
    event = caseEnv.press(comboD)
    check(`${label} → 不崩、动作未调、⌘/Ctrl+D 仍恒吞键`,
      swallowed(event) && caseEnv.review.calls.length === 0,
      `stopped=${String(event.propagationStopped)}`)
  }

  // ⑩ 无降级 B:目标分支逐环缺失 —— 每条都必须**真的走到** `sidebar.right.pane.tab` 查询
  // (否则就是「在布局那一层提前返回」的假通过),且各环都不崩。
  // 换行(D,恒吞)与 diff 分栏(改绑 Alt+D,不吞)各跑一遍同一批退化面。
  const targetBranchCases = [
    ['注册项里没有目标 key', {
      entries: [{ options: { key: 'other' }, store: { spec: {} } }],
      resolveStore: () => { throw new Error('unused') },
    }],
    ['目标注册项无 store', {
      entries: [{ options: { key: REVIEW_KEY } }],
      resolveStore: () => { throw new Error('unused') },
    }],
    ['注册项无 options.key', {
      entries: [{ store: { spec: {} } }],
      resolveStore: () => ({ getSnapshot: () => ({ byTab: {} }), actions: { toggledSplit() {}, toggledWrap() {} } }),
    }],
    ['resolveStore 抛错(handle 未注册)', {
      entries: [{ options: { key: REVIEW_KEY }, store: { spec: {} } }],
      resolveStore: () => { throw new Error('store handle is not registered (entry unloaded)') },
    }],
    ['活实例缺 getSnapshot', {
      entries: [{ options: { key: REVIEW_KEY }, store: { spec: {} } }],
      resolveStore: () => ({ actions: { toggledSplit() {}, toggledWrap() {} } }),
    }],
    ['快照缺 byTab', {
      entries: [{ options: { key: REVIEW_KEY }, store: { spec: {} } }],
      resolveStore: () => ({ getSnapshot: () => ({}), actions: { toggledSplit() {}, toggledWrap() {} } }),
    }],
    ['实例无 actions', {
      entries: [{ options: { key: REVIEW_KEY }, store: { spec: {} } }],
      resolveStore: () => ({ getSnapshot: () => ({ byTab: {} }) }),
    }],
    ['该页没有这个动作(文件预览注册项上的分栏)', {
      entries: [{ options: { key: PREVIEW_KEY }, store: { spec: {} } }],
      resolveStore: () => ({ getSnapshot: () => ({ byTab: { 't-diff': {} } }), actions: { toggledWrap() {} } }),
    }],
  ]
  // diff 分栏默认未绑定 → 这一组用 localStorage 把它改绑到 ⌘/Ctrl+Alt+D 才测得到目标分支
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.diffSplit': 'mod+alt+d' } }))
  for (const [label, degrade] of targetBranchCases) {
    for (const [keyLabel, combo, expectSwallow] of [['D(换行)', comboD, true], ['Alt+D(分栏)', comboAltD, false]]) {
      const caseEnv = env(degrade)
      caseEnv.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
      event = caseEnv.press(combo)
      const reached = caseEnv.slots.queried.includes(PANE_TAB_SLOT)
      const ok = reached && caseEnv.review.calls.length === 0 && (expectSwallow ? swallowed(event) : notSwallowed(event))
      check(`${label} → ⌘/Ctrl+${keyLabel} 走到目标分支、不崩、吞键=${String(expectSwallow)}`, ok,
        `reached=${String(reached)} stopped=${String(event.propagationStopped)} prevented=${String(event.defaultPrevented)}`)
    }
  }
  storage.delete('dsh-kbd-hotkeys:v1')

  // ⑩b 上游「无状态桶即抛」(变更审阅 store 的 bucket())→ 内层 catch 静默 no-op,不落到通用告警路径
  const bucketThrows = {
    entries: [{ options: { key: REVIEW_KEY }, store: { spec: {} } }],
    resolveStore: () => ({
      getSnapshot: () => ({ byTab: {} }),
      actions: {
        toggledSplit() { throw new Error('ui-deliverables: no review state for tab "t-diff"') },
        toggledWrap() { throw new Error('ui-deliverables: no review state for tab "t-diff"') },
      },
    }),
  }
  const warns = []
  const realWarn = console.warn
  console.warn = (...args) => { warns.push(args.map(String).join(' ')) }
  try {
    const bucketEnv = env(bucketThrows)
    bucketEnv.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
    event = bucketEnv.press(comboD)
    check('无状态桶(上游抛错)→ ⌘/Ctrl+D 恒吞键、不崩',
      bucketEnv.slots.queried.includes(PANE_TAB_SLOT) && swallowed(event), `stopped=${String(event.propagationStopped)}`)
    storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.diffSplit': 'mod+alt+d' } }))
    const bucketEnvAlt = env(bucketThrows)
    bucketEnvAlt.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
    event = bucketEnvAlt.press(comboAltD)
    storage.delete('dsh-kbd-hotkeys:v1')
    check('无状态桶(上游抛错)→ 改绑后的 diff 分栏不吞键、不崩',
      bucketEnvAlt.slots.queried.includes(PANE_TAB_SLOT) && notSwallowed(event), `stopped=${String(event.propagationStopped)}`)
    check('无状态桶 → 由插件内层 catch 静默消化,不走 runAction 的通用告警', warns.length === 0, JSON.stringify(warns))
  } finally {
    console.warn = realWarn
  }

  // ⑪ 键位可独立覆盖(与其余动作同一套 bindings 机制)
  //   ① diff 分栏默认未绑定 → 改绑后生效且吞键(动作生效才吞);
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.diffSplit': 'mod+alt+d' } }))
  const customSplit = env()
  customSplit.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
  event = customSplit.press(comboAltD)
  check('改绑 diff 分栏到 ⌘/Ctrl+Alt+D → 调 toggledSplit 并吞键',
    same(customSplit.review.calls, [['toggledSplit', 't-diff']]) && swallowed(event),
    JSON.stringify(customSplit.review.calls))
  check('分栏 true → false', customSplit.review.bucket('t-diff').split === false)
  event = customSplit.press(comboD)
  check('⌘/Ctrl+D 仍是换行(与分栏改绑互不影响)',
    same(customSplit.review.calls, [['toggledSplit', 't-diff'], ['toggledWrap', 't-diff']]),
    JSON.stringify(customSplit.review.calls))

  //   ② 换行改绑到 ⌘/Ctrl+Alt+W → 原 ⌘/Ctrl+D 交回浏览器(不吞、不调)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.wrap': 'mod+alt+w' } }))
  const customWrap = env()
  customWrap.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
  event = customWrap.press(comboD)
  const wrapOffD = notSwallowed(event) && customWrap.review.calls.length === 0
  event = customWrap.press({ key: 'w', code: 'KeyW', ctrlKey: true, altKey: true })
  check('换行改绑后 ⌘/Ctrl+D 交回浏览器(不吞、不调)', wrapOffD,
    `stopped=${String(event.propagationStopped)} calls=${JSON.stringify(customWrap.review.calls)}`)
  check('改绑后 ⌘/Ctrl+Alt+W → 切换行并吞键',
    swallowed(event) && same(customWrap.review.calls, [['toggledWrap', 't-diff']]), JSON.stringify(customWrap.review.calls))
  storage.delete('dsh-kbd-hotkeys:v1')

  // ⑫ 速查表:换行显示 Ctrl+D、diff 分栏显示「未绑定」,且不再出现 Ctrl+W
  const sheetEnv = env()
  sheetEnv.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
  sheetEnv.press({ key: '/', code: 'Slash', ctrlKey: true })
  const sheetText = nodeText(globalThis.document.body)
  /** 速查表里某一行(labels 命中)的 <kbd> 文案;行结构 = [label, kbd]。 */
  const helpKeyOf = (labels) => {
    const row = collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-helpRow'))
      .find((el) => labels.every((text) => nodeText(el).includes(text)))
    return row?.children.find((child) => child.tagName === 'KBD')?.textContent
  }
  check('速查表含换行行', sheetText.includes('右侧栏:diff / 文件预览切换自动换行'), sheetText.slice(0, 200))
  check('速查表把换行默认键位显示为 Ctrl+D', helpKeyOf(['自动换行']) === 'Ctrl+D', String(helpKeyOf(['自动换行'])))
  check('速查表含 diff 分栏行', sheetText.includes('右侧栏:diff 标签页切换左右 / 单栏对比'), sheetText.slice(0, 200))
  check('速查表把 diff 分栏显示为「未绑定」(默认无键位)', helpKeyOf(['单栏对比']) === '未绑定', String(helpKeyOf(['单栏对比'])))
  check('速查表不再出现 Ctrl+W(键位已交回浏览器)', !/Ctrl\+W/.test(sheetText), sheetText.slice(0, 400))
  sheetEnv.press({ key: 'Escape', code: 'Escape' })

  //   ③ 空串 = 取消绑定(与 DEFAULT_BINDINGS 里的 '' 同义):⌘/Ctrl+D 交回浏览器、速查表显示「未绑定」
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebarRight.wrap': '' } }))
  const unbound = env()
  unbound.layoutStore.seed(singlePane(['t-diff'], 't-diff'))
  event = unbound.press(comboD)
  check('bindings 置空串 → ⌘/Ctrl+D 取消绑定(不调、不吞)',
    notSwallowed(event) && same(unbound.review.calls, []),
    `stopped=${String(event.propagationStopped)} calls=${JSON.stringify(unbound.review.calls)}`)
  unbound.press({ key: '/', code: 'Slash', ctrlKey: true })
  check('取消绑定后速查表把换行显示为「未绑定」', helpKeyOf(['自动换行']) === '未绑定', String(helpKeyOf(['自动换行'])))
  unbound.press({ key: 'Escape', code: 'Escape' })
  storage.delete('dsh-kbd-hotkeys:v1')
}

if (isMain(import.meta.url)) report()
