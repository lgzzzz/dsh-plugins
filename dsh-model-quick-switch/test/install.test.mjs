/**
 * 装配：把 `src/client.ts` 装进假 Cordis 上下文后 —— 固定行注册、浮层与设置页挂进各自槽位、
 * 候选来自设置文档与 Host 模型目录、`primary+alt+U`（macOS `⌘⌥U`，其余平台 `Ctrl+Alt+U`）
 * 打开并消费这次按键、`Enter` 走
 * `session.selectModel`、失败留在浮层里、终端 `.xterm` 内的捕获、设置页增删写回
 * `models` 字段，以及服务缺席 / 晚到时的降级。
 *
 * 浮层与设置页用真的 React（react-dom/server）渲染成 HTML 再断言。
 *
 * 运行：`node test/install.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  captureWarnings,
  catalogOf,
  check,
  checkTrue,
  fakeConfigForm,
  fakeConfigForms,
  fakeCtx,
  fakeRemote,
  fakeSessions,
  fakeShortcuts,
  fakeSlots,
  finish,
  fixedKeydown,
  fixedMacKeydown,
  installDom,
  renderSlotEntry,
  tick,
} from './helpers.mjs'

const { apply, inject, name, PALETTE_ROOT_ATTR, SETTINGS_ROOT_ATTR, MODEL_VIEW } = await import('../src/client.ts')
const { installPaletteKeys, MODEL_SWITCH_ID } = await import('../src/palette.ts')

/** 默认的两个候选：一个在目录里，一个带推理强度。 */
const DEFAULT_CHOICES = [
  { provider: 'deepseek', model: 'deepseek-chat' },
  { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
]

/** 默认目录：两个提供方、三个模型。 */
const DEFAULT_CATALOG = catalogOf([
  { provider: 'deepseek', model: 'deepseek-chat', name: 'DeepSeek Chat', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  { provider: 'deepseek', model: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
  { provider: 'opencode-go', model: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
])

/**
 * 起一份装着假服务的上下文并装配插件。
 *
 * @param options - 覆盖默认值的服务与开关。
 * @returns 夹具读数。
 */
function setup(options = {}) {
  const dom = options.dom ?? installDom()
  const slots = fakeSlots()
  const shortcuts = fakeShortcuts({ platform: options.platform ?? 'windows' })
  const form = options.form ?? fakeConfigForm({ value: { models: options.choices ?? DEFAULT_CHOICES } })
  const configForms = options.configForms ?? fakeConfigForms(form)
  const sessions = options.sessions ?? fakeSessions({
    current: 's1',
    byId: { s1: { id: 's1', title: '会话 1', updatedAt: 1 } },
    modelSelection: {
      lastUsed: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
      next: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
    },
  })
  const remote = options.remote ?? fakeRemote({ catalog: options.catalog ?? DEFAULT_CATALOG })
  const services = { slots, shortcuts }
  if (options.withConfigForms !== false) services.configForms = configForms
  if (options.withSessions !== false) services.sessions = sessions
  if (options.withRemote !== false) services.remote = remote
  const ctx = fakeCtx(services)
  apply(ctx)

  const overlay = slots.registered.find((entry) => entry.options?.name === 'shell.overlay')
  const section = slots.registered.find((entry) => entry.options?.name === 'settings.section')
  const overlayProps = overlay?.options.inject?.()
  const sectionProps = section?.options.inject?.()

  return {
    dom,
    slots,
    shortcuts,
    form,
    configForms,
    sessions,
    remote,
    ctx,
    overlay,
    section,
    overlayProps,
    sectionProps,
    store: overlayProps?.store,
    data: overlayProps?.data,
    /** 浮层 HTML。 */
    html: () => renderSlotEntry(overlay),
    /** 设置页 HTML。 */
    settingsHtml: () => renderSlotEntry(section),
    /** 打开浮层（派发一次固定通道的 primary+alt+U，按默认的 Windows 平台是 Ctrl+Alt+U）。 */
    async open() {
      shortcuts.fire(fixedKeydown())
      await tick()
    },
  }
}

/** 从浮层 HTML 里读候选行。 */
function rowsOf(html) {
  if (!html.includes(`${PALETTE_ROOT_ATTR}=""`)) return []
  return [...html.matchAll(/<button[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/button>/gs)].map(([, selected, body]) => ({
    selected,
    title: /dsh-model-quick-switch-name">([^<]*)</.exec(body)?.[1],
    current: body.includes('dsh-model-quick-switch-current'),
    badge: /dsh-model-quick-switch-badge[^>]*>([^<]*)</.exec(body)?.[1],
  }))
}

console.log('--- C① 固定行、浮层与设置页都挂上了 ---')
{
  const { ctx, slots, shortcuts, overlay, section, dom } = setup()
  check('声明了依赖', inject, ['slots', 'shortcuts'])
  check('请求的依赖', ctx.requested, ['slots', 'shortcuts'])
  check('没有缺失的依赖', ctx.missing, [])
  check('一条固定行', shortcuts.commands.map((command) => command.id), [MODEL_SWITCH_ID])
  check('固定行分组', shortcuts.commands.map((command) => command.group), ['application'])
  check('Windows 键帽是 Ctrl+Alt+U', shortcuts.commands[0].keys, ['Ctrl', 'Alt', 'U'])
  check('固定行声明 primary+alt+U', shortcuts.commands[0].bindings, [{ code: 'KeyU', modifiers: ['primary', 'alt'] }])
  check('固定输入观察者', shortcuts.observerCount(), 1)
  check('终端捕获监听', dom.windowListenerCount(), 1)
  check('等槽位声明后才注册', slots.injected, ['shell.overlay', 'settings.section'])
  check('浮层注册项', [overlay.options.id, overlay.options.order, typeof overlay.options.inject], [name, 70, 'function'])
  check('设置页注册项', [section.options.id, section.options.order], [name, 70])
  check('设置页导航标题', typeof section.options.label, 'function')
  check('交出去的是组件本体', [typeof overlay.component, typeof section.component], ['function', 'function'])
  check('浮层业务 props', Object.keys(overlay.options.inject()), ['store', 'data', 'view'])
  check('设置页业务 props', Object.keys(section.options.inject()), ['data', 'actions'])
  check('设置页标题渲染', section.options.label(), '模型快速切换')
  check('未打开时浮层不渲染', renderSlotEntry(overlay), '')
}

console.log('--- C② Ctrl+Alt+U 打开:候选来自设置、目录名补上、当前行被选中 ---')
{
  const fixture = setup()
  await fixture.open()
  check('这一次按键被消费', fixture.shortcuts.consumeCalls(), 1)
  const rows = rowsOf(fixture.html())
  check('浮层出来了', fixture.store.getSnapshot().open, true)
  check('两行候选', rows.map((row) => row.title), ['DeepSeek Chat', 'DeepSeek V4.1 Flash'])
  check('当前行被标出来', rows.map((row) => row.current), [true, false])
  check('初始选中当前行', rows.map((row) => row.selected), ['true', 'false'])
  check('计数', fixture.html().includes('2 个模型'), true)
  check('拉过一次目录', fixture.remote.catalogCalls.length, 1)
}

console.log('--- C③ Enter 切换模型:走 session.selectModel,成功后关闭 ---')
{
  const fixture = setup()
  await fixture.open()
  const off = installPaletteKeys(fixture.store, fixture.dom.document)
  fixture.dom.pressKey('ArrowDown')
  fixture.dom.pressKey('Enter')
  await tick()
  check('请求带上会话、提供方、模型与强度', fixture.remote.selectCalls, [{
    sessionId: 's1',
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    reasoningEffort: 'high',
  }])
  check('成功后关闭浮层', fixture.store.getSnapshot().open, false)
  check('当前选择跟着走', fixture.data.getSnapshot().current, {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    reasoningEffort: 'high',
  })
  check('没有残留错误', fixture.data.getSnapshot().error, null)
  off()
}

console.log('--- C④ 切换失败:浮层留在原地并显示 Host 的错误 ---')
{
  const remote = fakeRemote({
    catalog: DEFAULT_CATALOG,
    selectResult: { ok: false, error: { code: 'session/writer-held', message: '另一个 DSH 正在使用这个会话' } },
  })
  const fixture = setup({ remote })
  await fixture.open()
  const off = installPaletteKeys(fixture.store, fixture.dom.document)
  fixture.dom.pressKey('Enter')
  await tick()
  check('浮层保持打开', fixture.store.getSnapshot().open, true)
  check('错误写进数据快照', fixture.data.getSnapshot().error, '切换失败：session/writer-held: 另一个 DSH 正在使用这个会话')
  check('浮层层面上显示错误', fixture.html().includes('session/writer-held'), true)
  check('错误行带 role=alert', fixture.html().includes('role="alert"'), true)
  check('没有关闭', fixture.store.getSnapshot().open, true)
  off()
}

console.log('--- C⑤ 没有打开的会话:浮层照常打开,确认时给出提示 ---')
{
  const sessions = fakeSessions({})
  const fixture = setup({ sessions })
  await fixture.open()
  check('打开时就提示没有会话', fixture.data.getSnapshot().error, '当前没有打开的会话：先在左侧栏打开或新建一个会话，再切换模型。')
  check('候选照常列出', rowsOf(fixture.html()).length, 2)
  const off = installPaletteKeys(fixture.store, fixture.dom.document)
  fixture.dom.pressKey('Enter')
  await tick()
  check('没有发出选择请求', fixture.remote.selectCalls, [])
  check('浮层没有关闭', fixture.store.getSnapshot().open, true)
  off()
}

console.log('--- C⑥ 远程服务缺席:打开不崩,确认给出可读错误 ---')
{
  const fixture = setup({ withRemote: false })
  const warnings = captureWarnings(() => {
    fixture.shortcuts.fire(fixedKeydown())
  })
  check('打开不报警', warnings, [])
  check('浮层打开', fixture.store.getSnapshot().open, true)
  const off = installPaletteKeys(fixture.store, fixture.dom.document)
  fixture.dom.pressKey('Enter')
  await tick()
  off()
  check('浮层还开着', fixture.store.getSnapshot().open, true)
  check('错误提示远程不可用', fixture.data.getSnapshot().error, '模型选择服务不可用（remote.session 尚未就绪）。')
}

console.log('--- C⑦ 设置服务晚到:先空列表,到位后补上 ---')
{
  const form = fakeConfigForm({ value: { models: DEFAULT_CHOICES } })
  const fixture = setup({ form, withConfigForms: false })
  check('还没有设置服务时是空列表', fixture.data.getSnapshot().choices, [])
  check('配置状态为不可用', fixture.data.getSnapshot().configStatus, 'unavailable')
  fixture.ctx.provide('configForms', fakeConfigForms(form))
  await tick()
  check('服务到位后候选补上', fixture.data.getSnapshot().choices, DEFAULT_CHOICES)
  await fixture.open()
  check('浮层候选跟着出现', rowsOf(fixture.html()).length, 2)
}

console.log('--- C⑧ 全局捕获:Ctrl+Alt+U 在终端与页面里都被吞并打开浮层 ---')
{
  const fixture = setup()
  /** 一段最小的终端 DOM：`.xterm` 容器 + 里面的 textarea。 */
  const terminalPath = () => {
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
    return [textarea, screen, pane]
  }
  const inTerminal = fixture.dom.pressWindowKey({ code: 'KeyU', key: 'u', ctrlKey: true, altKey: true, path: terminalPath() })
  check('终端内这一按被吞', [inTerminal.defaultPrevented, inTerminal.stopped], [true, true])
  check('终端内也打开了浮层', fixture.store.getSnapshot().open, true)

  fixture.store.close()
  const onPage = fixture.dom.pressWindowKey({ code: 'KeyU', key: 'u', ctrlKey: true, altKey: true, path: [{ closest: () => null }] })
  check('页面里（composer / 设置页）同样被吞', [onPage.defaultPrevented, onPage.stopped], [true, true])
  check('页面里也打开了浮层', fixture.store.getSnapshot().open, true)

  fixture.store.close()
  const otherKey = fixture.dom.pressWindowKey({ code: 'KeyP', key: 'p', ctrlKey: true, altKey: true, path: [{ closest: () => null }] })
  check('别的组合不拦截', [otherKey.defaultPrevented, otherKey.stopped], [false, false])

  fixture.ctx.dispose()
  check('卸载后撤掉全局捕获监听', fixture.dom.windowListenerCount(), 0)
  check('卸载后撤掉固定输入观察者', fixture.shortcuts.observerCount(), 0)
}

console.log('--- C⑨ 固定行被挤掉:这一按无主,捕获与固定通道都不出手 ---')
{
  const fixture = setup()
  fixture.shortcuts.dropFixed(MODEL_SWITCH_ID)
  fixture.shortcuts.fire(fixedKeydown())
  check('浮层不打开', fixture.store.getSnapshot().open, false)
  check('不消费这次按键', fixture.shortcuts.consumeCalls(), 0)

  const event = fixture.dom.pressWindowKey({ code: 'KeyU', key: 'u', ctrlKey: true, altKey: true, path: [{ closest: () => null }] })
  check('捕获监听也不抢这一按', [event.defaultPrevented, event.stopped], [false, false])
  check('捕获监听也不开浮层', fixture.store.getSnapshot().open, false)
}

console.log('--- C⑩ macOS:键帽是 ⌘⌥U,认 ⌘⌥U、不认 Ctrl+Alt+U ---')
{
  const fixture = setup({ platform: 'macos' })
  check('macOS 键帽是 ⌘⌥U', fixture.shortcuts.commands.map((command) => command.keys), [['⌘', '⌥', 'U']])
  fixture.shortcuts.fire(fixedKeydown())
  check('macOS 上 Ctrl+Alt+U 不打开', fixture.store.getSnapshot().open, false)
  check('不消费 Ctrl+Alt+U', fixture.shortcuts.consumeCalls(), 0)
  fixture.shortcuts.fire(fixedMacKeydown())
  check('macOS 上 ⌘⌥U 打开', fixture.store.getSnapshot().open, true)
  check('只消费命中的那一次', fixture.shortcuts.consumeCalls(), 1)
}

console.log('--- C⑪ 设置页:添加与删除都写回 models 字段 ---')
{
  const fixture = setup()
  const account = fixture.sectionProps
  const actions = account.actions
  const data = account.data

  await actions.add({ provider: 'deepseek', model: 'deepseek-reasoner' })
  check('写入了一次 mutate', fixture.form.calls.length, 1)
  check('按路径整份替换 models', fixture.form.calls[0].ops, [{
    op: 'set',
    path: ['models'],
    value: [
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
      { provider: 'deepseek', model: 'deepseek-reasoner' },
    ],
  }])
  check('数据快照跟着更新', data.getSnapshot().choices.length, 3)

  await actions.remove({ provider: 'deepseek', model: 'deepseek-chat' })
  check('删除也走同一条写入', fixture.form.calls.length, 2)
  check('删除后的列表', fixture.form.calls[1].ops[0].value, [
    { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
    { provider: 'deepseek', model: 'deepseek-reasoner' },
  ])
  check('删除也反映到快照', data.getSnapshot().choices.map((choice) => choice.model), ['deepseek-v4.1-flash', 'deepseek-reasoner'])

  await actions.add({ provider: 'deepseek', model: 'deepseek-chat' })
  await actions.add({ provider: 'deepseek', model: 'deepseek-chat' })
  check('重复添加不会多发一次写入', fixture.form.calls.length, 3)
}

console.log('--- C⑫ 设置写入被拒:显示原因,列表不变 ---')
{
  const form = fakeConfigForm({ value: { models: DEFAULT_CHOICES }, accept: false })
  const fixture = setup({ form })
  const data = fixture.sectionProps.data
  await fixture.sectionProps.actions.add({ provider: 'deepseek', model: 'deepseek-reasoner' })
  check('Host 拒绝后列表不变', data.getSnapshot().choices, DEFAULT_CHOICES)
  check('错误写进写回状态', data.getSnapshot().writeError, 'Host 拒绝了这次写入：设置不可写，或列表没有通过校验。')
  check('设置页显示错误', fixture.settingsHtml().includes('Host 拒绝了这次写入'), true)
  checkTrue('写入完成后不再标记 writing', data.getSnapshot().writing === false)
}

console.log('--- C⑬ 设置页首屏:列表、当前与说明 ---')
{
  const fixture = setup()
  // 真实设置页挂载后会自己拉目录；SSR 不跑 effect，这里先把目录喂进快照。
  fixture.sectionProps.data.set({ groups: DEFAULT_CATALOG.value.groups })
  const html = fixture.settingsHtml()
  checkTrue('设置页根标记', html.includes(`${SETTINGS_ROOT_ATTR}=""`))
  checkTrue('标题', html.includes('模型快速切换'))
  checkTrue('列表里两项', html.includes('DeepSeek Chat') && html.includes('DeepSeek V4.1 Flash'))
  checkTrue('当前会话标出来', html.includes('当前会话：DeepSeek Chat · DeepSeek · High'))
  check('浮层文案单位', MODEL_VIEW.unit, '个模型')
}

console.log('--- C⑭ remote.session 晚到:不崩、设置页有按钮、链路一到就补拉目录 ---')
{
  const fixture = setup({ withRemote: false })
  const data = fixture.sectionProps.data
  await fixture.sectionProps.actions.loadCatalog()
  check('链路未就绪时落到错误态', data.getSnapshot().catalogStatus, 'error')
  checkTrue('错误提示点名 remote.session', data.getSnapshot().catalogError.includes('remote.session'))
  checkTrue('设置页仍渲染「添加模型」按钮', fixture.settingsHtml().includes('添加模型'))

  fixture.ctx.provide('remote', fakeRemote({ catalog: DEFAULT_CATALOG }))
  await tick()
  check('remote 到位后自动补拉目录', data.getSnapshot().catalogStatus, 'ready')
  check('补拉后目录分组', data.getSnapshot().groups.map((group) => group.id), ['deepseek', 'opencode-go'])
  checkTrue('浮层候选也随目录换名', fixture.overlayProps.store.getSnapshot().entries.some((row) => row.title === 'DeepSeek Chat'))
}

finish()
