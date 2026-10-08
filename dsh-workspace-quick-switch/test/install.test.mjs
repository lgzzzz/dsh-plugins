/**
 * 装配:把 `src/client.ts` 装进假 Cordis 上下文后 —— 固定行注册、浮层挂进 `shell.overlay`、
 * 候选随快照更新、`Ctrl+Alt+M` 打开、命中时把这次按键消费掉(`consume`,否则平台会再把同一
 * 组合键当一次自己的快捷键)、`Esc` / `Enter` / `↑` / `↓` 的动作,以及上游服务缺席时的降级。
 * 浮层用真的 React(react-dom/server)渲染成 HTML 再断言。
 *
 * 运行:`node test/install.test.mjs`(或 pnpm test 跑全部)。
 */
import {
  captureWarnings,
  check,
  checkTrue,
  checkUndefined,
  fakeCtx,
  fakeSessions,
  fakeShortcuts,
  fakeSlots,
  fakeWorkspaces,
  finish,
  fixedKeydown,
  fixedMacKeydown,
  installDom,
  renderSlotEntry,
  workspace,
} from './helpers.mjs'

const dom = installDom()
const { apply, inject, installPaletteKeys, name, PALETTE_ROOT_ATTR } = await import('../src/client.ts')

/**
 * 起一份装着假服务的上下文并装配插件;返回浮层的读数与动作。
 *
 * 夹具用同一个字符串做工作区 id、它账下会话 id 与「主视图会话」id,所以 `current: 'ws-2'`
 * 就是「当前会话在 Beta 里」,浮层应当把 Beta 标成当前并默认选中它。
 */
function setup({
  workspaces = [
    workspace('ws-1', 'Alpha', { sessionIds: ['ws-1'] }),
    workspace('ws-2', 'Beta', { sessionIds: ['ws-2'] }),
  ],
  current,
  platform = 'windows',
} = {}) {
  const slots = fakeSlots()
  const shortcuts = fakeShortcuts({ platform })
  const startCalls = []
  const list = fakeWorkspaces(workspaces)
  const sessions = fakeSessions({ current })
  const ctx = fakeCtx({
    slots,
    shortcuts,
    workspaces: { list },
    sessions,
    uiWorkspace: { startSession: (workspaceId) => startCalls.push(workspaceId) },
  })
  apply(ctx)
  const overlay = slots.registered.find((entry) => entry.options?.name === 'shell.overlay')
  return {
    ctx,
    slots,
    shortcuts,
    list,
    sessions,
    startCalls,
    overlay,
    store: overlay?.options.inject?.().store,
    /** 当前浮层的 HTML(服务端渲染;effect 由 `installPaletteKeys` 单独验证)。 */
    html: () => renderSlotEntry(overlay),
    /** 当前浮层:根节点在不在 + 候选行。 */
    peek: () => parse(renderSlotEntry(overlay)),
  }
}

/** 解析浮层 HTML:根节点在不在、候选行(标题 + 是否选中)。 */
function parse(html) {
  const rows = [...html.matchAll(/<button[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/button>/gs)].map(
    ([, selected, body]) => ({
      selected,
      title: /dsh-workspace-quick-switch-name">([^<]*)</.exec(body)?.[1],
    }),
  )
  return { open: html.includes(PALETTE_ROOT_ATTR), rows }
}

/** 打开浮层(派发一次固定通道的 Ctrl+Alt+M)。 */
function openViaShortcut(shortcuts) {
  shortcuts.fire(fixedKeydown())
}

console.log('--- C① 固定行与浮层都挂上了 ---')
{
  const { ctx, slots, shortcuts, list, overlay, html } = setup({ current: 'ws-2' })
  check('声明了依赖', inject, ['slots', 'shortcuts'])
  check('请求的依赖', ctx.requested, ['slots', 'shortcuts'])
  check('没有缺失的依赖', ctx.missing, [])
  check('固定行 id', shortcuts.commands.map((command) => command.id), ['dsh-workspace-quick-switch.quick-switch'])
  check('固定行分组', shortcuts.commands[0].group, 'application')
  check('固定行键帽', shortcuts.commands[0].keys, ['Ctrl', 'Alt', 'M'])
  check('固定行声明逻辑组合 primary+alt+M', shortcuts.commands[0].bindings, [{ code: 'KeyM', modifiers: ['primary', 'alt'] }])
  check('注册表把 primary 落成 Ctrl:占用 Ctrl+Alt+M', shortcuts.fixedCatalog.getSnapshot()[0].bindings, [{ code: 'KeyM', modifiers: ['control', 'alt'] }])
  check('挂了固定输入观察者', shortcuts.observerCount(), 1)
  check('等 shell.overlay 声明后才注册', slots.injected, ['shell.overlay'])
  check(
    '注册进 shell.overlay 的条目',
    slots.registered.map((entry) => ({ ...entry.options, inject: typeof entry.options.inject })),
    [{ name: 'shell.overlay', id: name, order: 60, inject: 'function' }],
  )
  check('交出去的是组件本体(不是元素)', typeof overlay.component, 'function')
  check('业务 props 由 inject 提供', Object.keys(overlay.options.inject()), ['store'])
  check('订阅了工作区快照', list.listenerCount(), 1)
  check('未打开时不渲染浮层', html(), '')
}

console.log('--- C② Ctrl+Alt+M 打开:候选顺序照抄、当前工作区被选中 ---')
{
  const { shortcuts, list, html, peek } = setup({ current: 'ws-2' })
  openViaShortcut(shortcuts)
  const opened = peek()
  check('浮层出来了', opened.open, true)
  check('候选顺序', opened.rows.map((row) => row.title), ['Alpha', 'Beta'])
  check('当前工作区被选中', opened.rows.map((row) => row.selected), ['false', 'true'])
  checkTrue('列表容器带上 aria-activedescendant', html().includes('aria-activedescendant="dsh-workspace-quick-switch-option-1"'))

  // 浮层开着时工作区快照变了:列表跟着变,选中行停在同一个工作区上。
  list.set([
    workspace('ws-1', 'Alpha', { sessionIds: ['ws-1'] }),
    workspace('ws-2', 'Beta', { sessionIds: ['ws-2'] }),
    workspace('ws-3', 'Gamma', { sessionIds: ['ws-3'] }),
  ])
  const grown = peek()
  check('候选跟随快照', grown.rows.map((row) => row.title), ['Alpha', 'Beta', 'Gamma'])
  check('选中行仍是 Beta', grown.rows.map((row) => row.selected), ['false', 'true', 'false'])
}

console.log('--- C③ 只认完全匹配的 Ctrl+Alt+M ---')
{
  const { shortcuts, peek } = setup({ current: undefined })
  shortcuts.fire(fixedKeydown({ alt: false }))
  check('缺 Alt 不打开', peek().open, false)
  shortcuts.fire(fixedKeydown({ control: false }))
  check('缺 Ctrl 不打开', peek().open, false)
  shortcuts.fire(fixedKeydown({ shift: true }))
  check('多了 Shift 不打开', peek().open, false)
  shortcuts.fire(fixedKeydown({ repeat: true }))
  check('长按重复不打开', peek().open, false)
  shortcuts.fire({ type: 'keydown', gesture: { code: 'KeyJ', control: true, alt: true } })
  check('别的键不打开', peek().open, false)
  shortcuts.fire({ type: 'reset' })
  check('reset 输入不打开', peek().open, false)
  shortcuts.fire({ type: 'keydown' })
  check('没有 gesture 的输入不打开', peek().open, false)
  shortcuts.fire(fixedKeydown())
  const opened = peek()
  checkTrue('完全匹配时打开', opened.open && opened.rows.length === 2)

  // 固定行被别的注册者挤掉(不再出现在目录里)时,这一按不再算本插件的。
  shortcuts.commands.length = 0
  shortcuts.fire(fixedKeydown())
  check('固定行不在目录里时按键无主', shortcuts.commands.length, 0)
}

console.log('--- C④ 没有当前会话时默认选第一行 ---')
{
  const { shortcuts, peek } = setup({ current: undefined })
  openViaShortcut(shortcuts)
  check('第一行被选中', peek().rows.map((row) => row.selected), ['true', 'false'])
}

console.log('--- C⑤ 工作区超过 10 个时只列前 10 个 ---')
{
  const many = Array.from({ length: 12 }, (_, index) => workspace(`ws-${index + 1}`, `W${index + 1}`))
  const { shortcuts, peek } = setup({ workspaces: many, current: undefined })
  openViaShortcut(shortcuts)
  const rows = peek().rows
  check('只列 10 个', rows.length, 10)
  check('顺序照抄', rows.map((row) => row.title), ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10'])
}

console.log('--- C⑥ 按键与动作端到端(捕获监听 + 固定行 + uiWorkspace)---')
{
  const { shortcuts, startCalls, peek, store } = setup({ current: 'ws-2' })
  // 组件真实挂载时会把 installPaletteKeys 挂到 document 上;这里直接调用同一个安装函数。
  const uninstall = installPaletteKeys(store, dom.document)
  check('捕获监听挂上了', dom.document.listenerCount(), 1)

  openViaShortcut(shortcuts)
  check('打开后当前工作区被选中', peek().rows.map((row) => row.selected), ['false', 'true'])
  dom.pressKey('ArrowUp')
  check('↑ 移到第一行', peek().rows.map((row) => row.selected), ['true', 'false'])
  dom.pressKey('Enter')
  check('Enter 在导航后的工作区新建会话', startCalls, ['ws-1'])
  check('浮层关闭', peek().open, false)

  // Esc:关闭且不动作。
  openViaShortcut(shortcuts)
  dom.pressKey('Escape')
  check('Esc 不触发动作', startCalls, ['ws-1'])
  check('Esc 关闭浮层', peek().open, false)

  uninstall()
  check('卸载后撤掉监听', dom.document.listenerCount(), 0)
}

console.log('--- C⑦ 上游服务缺席时的降级 ---')
{
  // 没有 workspaces:固定行照旧,浮层按空候选打开,而且**不告警** —— 真实启动里它只是还没
  // 经远程链路到位(见 C⑧),不是故障。
  const slots = fakeSlots()
  const shortcuts = fakeShortcuts()
  const startCalls = []
  const ctx = fakeCtx({ slots, shortcuts, uiWorkspace: { startSession: (id) => startCalls.push(id) } })
  const warnings = captureWarnings(() => apply(ctx))
  check('没有 workspaces 时不告警', warnings, [])
  check('固定行仍然注册', shortcuts.commands.map((command) => command.id), ['dsh-workspace-quick-switch.quick-switch'])
  openViaShortcut(shortcuts)
  const withoutList = parse(renderSlotEntry(slots.registered[0]))
  checkTrue('浮层打开但没有候选', withoutList.open && withoutList.rows.length === 0)

  // 没有 uiWorkspace:固定行照旧,按键不做动作(只有一行告警)。
  const slots2 = fakeSlots()
  const shortcuts2 = fakeShortcuts()
  const ctx2 = fakeCtx({ slots: slots2, shortcuts: shortcuts2, workspaces: fakeWorkspaces([workspace('ws-1', 'A')]) })
  apply(ctx2)
  const warnings2 = captureWarnings(() => openViaShortcut(shortcuts2))
  check('没有 uiWorkspace 时按键告警', warnings2.filter((line) => line.includes('uiWorkspace')).length, 1)
  check('浮层没有被打开', parse(renderSlotEntry(slots2.registered[0])).open, false)

  // 没有 shortcuts:短依赖时 inject 的回调不跑,一个字都不做(也不告警)。
  const slots3 = fakeSlots()
  const ctx3 = fakeCtx({ slots: slots3 })
  const warnings3 = captureWarnings(() => apply(ctx3))
  check('缺 shortcuts 时注入回调不跑,也不告警', warnings3, [])
  check('没有注册任何槽位', slots3.registered, [])
  check('ctx.inject 报告缺失的服务', ctx3.missing, ['shortcuts'])

  // 依赖在 context 上缺席:inject 的回调不跑。
  const ctx4 = fakeCtx({})
  apply(ctx4)
  check('依赖缺失时不进入 setup', ctx4.missing, ['slots', 'shortcuts'])
}

console.log('--- C⑧ 工作区/会话服务晚到:等待子 fiber 补上读数 ---')
{
  // 真实 Web 启动顺序:`workspaces` 由工作区控制器经 gateway + WebSocket 提供,`sessions`
  // 同路,都比只等 slots + shortcuts 的本插件晚。这里先按这个顺序装,再让服务到位。
  const slots = fakeSlots()
  const shortcuts = fakeShortcuts()
  const list = fakeWorkspaces([
    workspace('ws-1', 'Alpha', { sessionIds: ['ws-1'] }),
    workspace('ws-2', 'Beta', { sessionIds: ['ws-2'] }),
  ])
  const sessions = fakeSessions({ current: 'ws-2' })
  const ctx = fakeCtx({ slots, shortcuts, uiWorkspace: { startSession() {} } })
  const warnings = captureWarnings(() => apply(ctx))
  const overlay = slots.registered[0]
  const store = overlay.options.inject().store
  const titles = () => store.getSnapshot().entries.map((row) => row.title)
  const currentTitle = () => store.getSnapshot().entries.find((row) => row.current)?.title

  check('激活时没有告警', warnings, [])
  check('固定行已经挂上', shortcuts.commands.map((command) => command.id), ['dsh-workspace-quick-switch.quick-switch'])
  check('浮层已经挂进槽位', slots.registered.length, 1)
  check('两个等待子 fiber 排着队', ctx.children.map((child) => child.names), [['workspaces'], ['sessions']])
  check('还没有候选', titles(), [])
  check('还没有订阅工作区', list.listenerCount(), 0)

  openViaShortcut(shortcuts)
  const beforeArrival = parse(renderSlotEntry(overlay))
  checkTrue('此刻浮层照常打开(空候选)', beforeArrival.open && beforeArrival.rows.length === 0)

  // 远程链路就绪:工作区控制器到位,子 fiber 立刻接上订阅并投影一次。
  ctx.provide('workspaces', { list })
  check('接上了工作区订阅', list.listenerCount(), 1)
  check('候选补上了', titles(), ['Alpha', 'Beta'])
  check('候选出现在已经开着的浮层里', parse(renderSlotEntry(overlay)).rows.map((row) => row.title), ['Alpha', 'Beta'])
  checkUndefined('会话服务还没来时没有「当前」标记', currentTitle())

  // 会话目录也到位:标记补上,并跟着主视图会话切换。
  ctx.provide('sessions', sessions)
  check('接上了会话订阅', sessions.list.listenerCount(), 1)
  check('「当前」标记补上', currentTitle(), 'Beta')
  sessions.list.setCurrent('ws-1')
  check('切换主视图会话后标记跟着走', currentTitle(), 'Alpha')

  // 重新打开:初始选中行落在当前工作区上。
  openViaShortcut(shortcuts)
  check('重新打开时选中当前工作区', parse(renderSlotEntry(overlay)).rows.map((row) => row.selected), ['true', 'false'])

  ctx.dispose()
  check('卸载后工作区订阅撤掉', list.listenerCount(), 0)
  check('卸载后会话订阅撤掉', sessions.list.listenerCount(), 0)
}

console.log('--- C⑩ macOS:固定行占 ⌘⌥M,键帽与按键归属都按平台走 ---')
{
  const { shortcuts, peek } = setup({ current: undefined, platform: 'macos' })
  check('macOS 键帽', shortcuts.commands[0].keys, ['⌘', '⌥', 'M'])
  check('macOS 仍是同一份逻辑声明', shortcuts.commands[0].bindings, [{ code: 'KeyM', modifiers: ['primary', 'alt'] }])
  check('注册表把 primary 落成 meta:占用 ⌘⌥M', shortcuts.fixedCatalog.getSnapshot()[0].bindings, [{ code: 'KeyM', modifiers: ['alt', 'meta'] }])

  shortcuts.fire(fixedKeydown())
  check('macOS 上 Ctrl+Alt+M 不打开', peek().open, false)
  shortcuts.fire(fixedMacKeydown())
  check('macOS 上 ⌘⌥M 打开', peek().open, true)

  const withShift = setup({ current: undefined, platform: 'macos' })
  withShift.shortcuts.fire(fixedMacKeydown({ shift: true }))
  check('macOS 上多按 Shift 不打开', withShift.peek().open, false)

  const win = setup({ current: undefined })
  win.shortcuts.fire(fixedMacKeydown())
  check('Windows 上 ⌘⌥M 不打开', win.peek().open, false)
  win.shortcuts.fire(fixedKeydown())
  check('Windows 上 Ctrl+Alt+M 打开', win.peek().open, true)
}

console.log('--- C⑨ 卸载时清干净 ---')
{
  const { ctx, slots, shortcuts, list, sessions } = setup({ current: 'ws-1' })
  check('五个 scope effect 都登记了', ctx.effects.length, 5)
  check('effect 各自交了清理函数', ctx.effects.filter((effect) => typeof effect.cleanup === 'function').length, 5)
  check('两个等待子 fiber 都挂上了', ctx.children.map((child) => child.running), [true, true])
  ctx.dispose()
  check('固定行撤掉', shortcuts.commands, [])
  check('观察者撤掉', shortcuts.observerCount(), 0)
  check('工作区订阅撤掉', list.listenerCount(), 0)
  check('会话订阅撤掉', sessions.list.listenerCount(), 0)
  check('浮层注册项撤掉', slots.registered, [])
}

console.log('--- C⑪ 命中本插件组合键时消费掉这次按键(否则平台会再执行一遍)---')
{
  // 命中就消费:消费即适配器的 preventDefault,平台因此不会再拿 ⌘⌥M 去最小化窗口。
  const mac = setup({ current: 'ws-2', platform: 'macos' })
  check('命中 ⌘⌥M 时被消费', mac.shortcuts.fire(fixedMacKeydown()), true)
  check('只消费了一次', mac.shortcuts.consumeCalls(), 1)
  check('消费不影响浮层打开', mac.peek().open, true)

  // 不是本插件那条组合键的输入一个都不消费:平台自己的快捷键必须照旧生效。
  const other = setup({ current: undefined })
  for (const input of [
    fixedKeydown({ alt: false }),
    fixedKeydown({ control: false }),
    fixedKeydown({ shift: true }),
    fixedKeydown({ repeat: true }),
    { type: 'keydown', gesture: { code: 'KeyJ', control: true, alt: true } },
    { type: 'keydown' },
    { type: 'reset' },
  ]) {
    other.shortcuts.fire(input)
  }
  check('非本插件的输入不被消费', other.shortcuts.consumeCalls(), 0)

  // 已经在别处被消费的输入:浮层不开,也不会再消费一次。
  const taken = setup({ current: undefined })
  taken.shortcuts.fire(fixedKeydown({ defaultPrevented: true }))
  check('已消费输入不开浮层也不重复消费', [taken.peek().open, taken.shortcuts.consumeCalls()], [false, 0])

  // 固定行被别的注册者挤掉(目录里没有本插件这一行):这一按不再算本插件的,也不消费。
  const orphan = setup({ current: undefined })
  orphan.shortcuts.dropFixed('dsh-workspace-quick-switch.quick-switch')
  check('固定行不在目录里时不消费', [orphan.shortcuts.fire(fixedKeydown()), orphan.shortcuts.consumeCalls()], [false, 0])

  // uiWorkspace 缺席:浮层开不了,但组合键仍然归本插件 —— 否则平台照样会拿它去做自己的事。
  const slots = fakeSlots()
  const shortcuts = fakeShortcuts({ platform: 'macos' })
  const ctx = fakeCtx({ slots, shortcuts, workspaces: { list: fakeWorkspaces([workspace('ws-1', 'Alpha')]) } })
  const warnings = captureWarnings(() => {
    apply(ctx)
    shortcuts.fire(fixedMacKeydown())
  })
  check('uiWorkspace 缺席时只告警一次', warnings.filter((line) => line.includes('uiWorkspace')).length, 1)
  check('uiWorkspace 缺席也照样消费这次按键', shortcuts.consumeCalls(), 1)
}

console.log('--- C⑫ 终端内按 ⌘⌥M / Ctrl+Alt+M:捕获阶段拦下并开同一张浮层 ---')
{
  /**
   * 一段最小的终端 DOM:`.xterm` 容器 + 它里面的 helper textarea。
   *
   * `composedPath` 的第一个元素是 textarea,而 `terminalTarget` 要的正是"最近的
   * `.xterm` 祖先",所以这里按真实 `closest` 上溯建模,而不是只看第一个元素。
   */
  function terminalPath() {
    const pane = { parent: null, xterm: false }
    const screen = { parent: pane, xterm: true }
    const textarea = { parent: screen, xterm: false }
    const closestOn = (node) => (selector) => {
      if (selector !== '.xterm') return null
      for (let current = node; current !== null; current = current.parent) {
        if (current.xterm) return current
      }
      return null
    }
    textarea.closest = closestOn(textarea)
    screen.closest = closestOn(screen)
    pane.closest = closestOn(pane)
    return { textarea, screen, pane, path: [textarea, screen, pane] }
  }

  // 每次都用新的 installDom():捕获监听是挂在 window 上的,同一个 window 上叠多个
  // setup 时先注册的那条会先看到按键。
  const terminalDom = installDom()
  const { shortcuts, peek } = setup({ current: 'ws-2' })
  const { path } = terminalPath()
  const event = terminalDom.pressWindowKey({ code: 'KeyM', key: 'm', ctrlKey: true, altKey: true, path })
  check('终端内打开浮层', peek().open, true)
  check('事件在捕获阶段被吞', [event.defaultPrevented, event.stopped], [true, true])
  check('浮层候选照常列出', peek().rows.map((row) => row.title), ['Alpha', 'Beta'])
  check('捕获监听与固定输入观察者各一条', [terminalDom.windowListenerCount(), shortcuts.observerCount()], [1, 1])
  terminalDom.uninstall()

  // macOS:同一个窗口里只认 ⌘⌥M。
  const macDom = installDom()
  const mac = setup({ current: undefined, platform: 'macos' })
  const macPath = terminalPath().path
  const ctrl = macDom.pressWindowKey({ code: 'KeyM', key: 'm', ctrlKey: true, altKey: true, path: macPath })
  check('macOS 上 Ctrl+Alt+M 不打开', mac.peek().open, false)
  check('macOS 上 Ctrl+Alt+M 不吞事件', [ctrl.defaultPrevented, ctrl.stopped], [false, false])
  const meta = macDom.pressWindowKey({ code: 'KeyM', key: 'm', metaKey: true, altKey: true, path: macPath })
  check('macOS 上 ⌘⌥M 打开', mac.peek().open, true)
  check('macOS 上 ⌘⌥M 被吞', [meta.defaultPrevented, meta.stopped], [true, true])
  macDom.uninstall()

  // 让位:非 `.xterm` 目标、别的键、多按修饰键、长按 / 组字、固定行被挤掉。
  const passthroughDom = installDom()
  const pass = setup({ current: undefined })
  const editorPath = [{ closest: () => null }]
  const cases = [
    ['文本控件里', { path: editorPath }],
    ['别的键', { code: 'KeyN', key: 'n', path }],
    ['缺 Alt', { altKey: false, path }],
    ['多了 Shift', { shiftKey: true, path }],
    ['长按重复', { repeat: true, path }],
    ['组字中', { isComposing: true, path }],
  ]
  for (const [label, overrides] of cases) {
    const wrong = passthroughDom.pressWindowKey({ code: 'KeyM', key: 'm', ctrlKey: true, altKey: true, path: terminalPath().path, ...overrides })
    check(`${label}不打开`, pass.peek().open, false)
    check(`${label}不吞事件`, [wrong.defaultPrevented, wrong.stopped], [false, false])
  }
  pass.shortcuts.dropFixed('dsh-workspace-quick-switch.quick-switch')
  const orphan = passthroughDom.pressWindowKey({ code: 'KeyM', key: 'm', ctrlKey: true, altKey: true, path: terminalPath().path })
  check('固定行不在目录里时不打开', pass.peek().open, false)
  check('固定行不在目录里时不吞事件', [orphan.defaultPrevented, orphan.stopped], [false, false])
  passthroughDom.uninstall()

  // 没有 window(无 DOM 的装配):不抛,固定通道照常工作。
  const noWindowDom = installDom()
  delete globalThis.window
  try {
    const bare = setup({ current: undefined })
    check('没有 window 时照常注册固定行', bare.shortcuts.commands.length, 1)
    openViaShortcut(bare.shortcuts)
    check('没有 window 时固定通道照常打开', bare.peek().open, true)
    check('没有 window 时也登记了那个 effect', bare.ctx.effects.length, 5)
  } finally {
    globalThis.window = noWindowDom.window
  }
  noWindowDom.uninstall()

  // 卸载:window 上的捕获监听一起撤掉。
  const unmountDom = installDom()
  const unmount = setup({ current: undefined })
  check('卸载前捕获监听在册', unmountDom.windowListenerCount(), 1)
  unmount.ctx.dispose()
  check('卸载后捕获监听撤掉', unmountDom.windowListenerCount(), 0)
  const after = unmountDom.pressWindowKey({ code: 'KeyM', key: 'm', ctrlKey: true, altKey: true, path: terminalPath().path })
  check('卸载后不再打开也不吞事件', [unmount.peek().open, after.defaultPrevented, after.stopped], [false, false, false])
  unmountDom.uninstall()
}

finish()
dom.uninstall()
