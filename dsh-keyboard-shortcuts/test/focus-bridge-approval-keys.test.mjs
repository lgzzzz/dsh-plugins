/**
 * 审批键桥:`Enter` 允许一次 / `Esc` 拒绝;覆盖准入否决、归属歧义、固定行与服务缺失、
 * 卸载复位,以及 window 捕获阶段路径(焦点在过程卡片上时先于卡片自己的 keydown 拦下)。
 */
import { applyPlugin, approvalPending, captureWarnings, check, checkTrue, domApproval, domBody, domComposer, FakeElement, fakeDocument, fakeKeyEvent, fakeShortcuts, fakeSidebar, fakeSessions, fakeUiSession, fakeWindow, FakeCtx, finish, gesture, harness, keydown, session, shortcutContext, sleep, statusWith } from './focus-helpers.mjs'
import { markFullscreenDismissed } from '../src/fullscreen-dismiss.ts'

/** 装配一个"主视图 s1 正挂着一条待答审批"的场景。 */
function withPending(pending, options = {}) {
  return harness({ ...options, uiSession: fakeUiSession({ status: statusWith('s1', pending) }) })
}

/** 一张过程卡片:工具卡 / 轨迹行的共同形状(可聚焦,并自己消费 Enter)。 */
function staleCard(app) {
  return app.append(new FakeElement('div', { role: 'button', tabindex: '0' }))
}

/**
 * 置入假 document / 假 window(审批捕获钩子装在 window 上),用完即还原。
 * `emit` 只调用与 `phase` 相符的那批监听(默认捕获阶段)。
 */
function withApprovalDom({ app, activeElement = null, window = fakeWindow() } = {}) {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  globalThis.document = fakeDocument({ root: app, activeElement })
  globalThis.window = window
  return {
    window,
    restore() {
      if (previousDocument === undefined) delete globalThis.document
      else globalThis.document = previousDocument
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    },
  }
}

console.log('--- I① 无焦点:Enter 允许一次、Esc 拒绝 ---')
{
  let cancelled = 0
  const pending = approvalPending()
  const { shortcuts } = withPending(pending, { conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })

  const allow = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
  shortcuts.emit(allow.input)
  check('Enter → 允许一次', pending.answers, ['allowed-once'])
  check('Enter 被消费', allow.consumed.count, 1)

  const reject = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  shortcuts.emit(reject.input)
  check('Esc → 拒绝(单按即可)', pending.answers, ['allowed-once', 'rejected'])
  check('Esc 被消费', reject.consumed.count, 1)
  check('审批未竟时不误停回合', cancelled, 0)

  // 焦点落在聊天区消息上同样作答。
  const elsewhere = keydown(gesture('Enter'), shortcutContext({ region: 'page', target: domComposer }))
  shortcuts.emit(elsewhere.input)
  check('焦点在别处也作答', pending.answers, ['allowed-once', 'rejected', 'allowed-once'])
  check('焦点在别处也消费', elsewhere.consumed.count, 1)
}

console.log('--- I② 面板自己掌权 / 无待答 / 已作答 ---')
{
  const pending = approvalPending()
  const owned = withPending(pending)
  const inside = keydown(gesture('Enter'), shortcutContext({ target: domApproval }))
  owned.shortcuts.emit(inside.input)
  check('落在面板内不代答', pending.answers, [])
  check('落在面板内不消费', inside.consumed.count, 0)

  let idleCancelled = 0
  const idle = harness({ conversation: { cancel: () => { idleCancelled += 1; return Promise.resolve() } } })
  const enter = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
  idle.shortcuts.emit(enter.input)
  check('没有待答审批时不接 Enter', enter.consumed.count, 0)
  // 无待答审批时 Esc 仍归停止序列:第一下起序列,第二下停回合。
  const escape = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  idle.shortcuts.emit(escape.input)
  check('第一下 Esc 起停止序列', idleCancelled, 0)
  idle.shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  check('第二下 Esc 照常停止', idleCancelled, 1)

  const settled = approvalPending({ answerable: false })
  const done = withPending(settled)
  const press = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
  done.shortcuts.emit(press.input)
  check('已作答的审批不再接', settled.answers, [])
  check('已作答时不消费', press.consumed.count, 0)

  let asked = 0
  const question = withPending({ kind: 'question', key: 'q1', answerable: true, answer: () => { asked += 1; return Promise.resolve() } })
  const other = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
  question.shortcuts.emit(other.input)
  check('别的待答域不接', asked, 0)
  check('别的待答域不消费', other.consumed.count, 0)
}

console.log('--- I③ 准入否决:文本控件 / 终端 / 模态 / repeat / 组字 / 已被消费 ---')
{
  const cases = [
    ['文本控件内', { region: 'editable', target: domComposer }, {}],
    ['终端内', { region: 'terminal' }, {}],
    ['模态层之上', { region: 'page', modal: 'settings' }, {}],
    ['长按重复', {}, { repeat: true }],
    ['组字中', {}, { composing: true }],
    ['已被消费', {}, { defaultPrevented: true }],
  ]
  for (const [label, context, overrides] of cases) {
    const pending = approvalPending()
    const { shortcuts } = withPending(pending)
    const press = keydown(gesture('Enter', overrides), shortcutContext(context))
    shortcuts.emit(press.input)
    check(`${label}不代答`, pending.answers, [])
    check(`${label}不消费`, press.consumed.count, 0)
  }
}

console.log('--- I④ 归属歧义:主视图不唯一 / 审批属于别的会话 ---')
{
  const ambiguous = approvalPending()
  const two = withPending(ambiguous, { summary: { s1: { id: 's1', running: true, retainedBy: { mainView: 1 } }, s2: { id: 's2', running: true, retainedBy: { mainView: 1 } } } })
  const press = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
  two.shortcuts.emit(press.input)
  check('切换中(两个主视图)不代答', ambiguous.answers, [])
  check('切换中不消费', press.consumed.count, 0)

  const background = approvalPending()
  const detached = harness({
    summary: { s1: { id: 's1', running: true, retainedBy: { mainView: 1 } }, s2: { id: 's2', running: true, retainedBy: {} } },
    uiSession: fakeUiSession({ status: statusWith('s2', background) }),
  })
  const other = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
  detached.shortcuts.emit(other.input)
  check('别的会话的审批不代答', background.answers, [])
  check('别的会话的审批不消费', other.consumed.count, 0)
}

console.log('--- I⑤ 失败模式:固定行缺失 / 服务缺失即不装 ---')
{
  const unmounted = approvalPending()
  const { shortcuts } = withPending(unmounted, { fixedRows: [] })
  const press = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
  shortcuts.emit(press.input)
  check('审批插件未装载(无固定行)时不代答', unmounted.answers, [])
  check('审批插件未装载时不消费', press.consumed.count, 0)

  // 没有 uiSession 就没有待答事实可读:审批桥、提问桥与停止桥(停止桥也读待答交互)都不安装。
  const noUi = harness({ withUiSession: false })
  check('缺 uiSession 时只装不依赖它的桥', noUi.shortcuts.listenerCount(), 5)
  check('缺 uiSession 不告警', noUi.warnings.length, 0)
  const orphan = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
  noUi.shortcuts.emit(orphan.input)
  check('缺 uiSession 时不消费', orphan.consumed.count, 0)

  // 没有 sessions 时停止桥、审批桥、提问桥与聚焦输入框桥都不装。
  const noSessions = harness({ withSessions: false })
  check('缺 sessions 时只装不依赖它的桥', noSessions.shortcuts.listenerCount(), 4)

  // 假 shortcuts 缺 observeFixedInput:各桥各告警一次,审批桥也不装。
  const bare = new FakeCtx({
    shortcuts: { ...fakeShortcuts(), observeFixedInput: undefined },
    sidebarRight: fakeSidebar(),
    sessions: fakeSessions({ summary: { s1: session('s1') } }),
    uiSession: fakeUiSession(),
  })
  const warnings = captureWarnings(() => applyPlugin(bare))
  checkTrue('缺 observeFixedInput 时审批桥告警', warnings.some((line) => line.includes('approval bridge not installed')))
  check('缺 observeFixedInput 时只装不依赖固定键的部分', bare.effects.map((effect) => effect.label), ['dsh-keyboard-shortcuts: chat paging', 'dsh-keyboard-shortcuts: left sidebar shortcut removed'])
}

console.log('--- I⑥ answer 被拒绝:捕获并告警,按键仍已归属 ---')
{
  const rejecting = approvalPending({ onAnswer: () => Promise.reject(new Error('boom')) })
  const { shortcuts } = withPending(rejecting)
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  try {
    const press = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
    shortcuts.emit(press.input)
    await sleep(1)
    check('按键已归属', press.consumed.count, 1)
  } finally {
    console.warn = originalWarn
  }
  checkTrue('拒绝被捕获并告警', warnings.some((line) => line.includes('was not sent')))
}

console.log('--- I⑦ 卸载:固定监听全部释放 ---')
{
  const { ctx, shortcuts } = harness()
  check('注册了九个固定监听', shortcuts.listenerCount(), 9)
  for (const effect of ctx.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  check('释放后监听清空', shortcuts.listenerCount(), 0)
  const press = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
  shortcuts.emit(press.input)
  check('释放后不再消费', press.consumed.count, 0)
}

console.log('--- I⑧ 捕获阶段抢先:焦点停在过程卡片上,Enter / Esc 直接答审批 ---')
{
  const app = new FakeElement('div', { 'data-app': '' })
  const card = staleCard(app)
  const dom = withApprovalDom({ app, activeElement: card })
  const pending = approvalPending()
  try {
    withPending(pending)
    const enter = fakeKeyEvent({ path: [card, app], code: 'Enter' })
    dom.window.emit(enter)
    check('卡片焦点上的 Enter → 允许一次', pending.answers, ['allowed-once'])
    check('这一按在捕获阶段就被吞掉(卡片与固定通道都收不到)', [enter.prevented, enter.stopped], [1, 1])

    const escape = fakeKeyEvent({ path: [card, app], code: 'Escape' })
    dom.window.emit(escape)
    check('卡片焦点上的 Esc → 拒绝', pending.answers, ['allowed-once', 'rejected'])
    check('Esc 同样被吞', [escape.prevented, escape.stopped], [1, 1])
  } finally {
    dom.restore()
  }
}

console.log('--- I⑨ 捕获路径让位:面板内 / 文本控件 / 终端 / 模态 / 长按 / 组字 / 别的键 ---')
{
  const cases = [
    {
      label: '目标落在面板内',
      make: (app) => {
        const panel = app.append(new FakeElement('div', { 'data-approval-key': 'approval:1' }))
        return panel.append(new FakeElement('button'))
      },
    },
    { label: '文本控件内', make: (app) => app.append(new FakeElement('textarea')) },
    { label: '终端内', make: (app) => app.append(new FakeElement('div', { class: 'xterm' })) },
    {
      label: '模态层之上',
      make: (app) => {
        app.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }))
        return staleCard(app)
      },
    },
    { label: '长按重复', make: (app) => staleCard(app), overrides: { repeat: true } },
    { label: '组字中', make: (app) => staleCard(app), overrides: { isComposing: true } },
    { label: '别的键', make: (app) => staleCard(app), overrides: { code: 'KeyK' } },
    { label: '带修饰键', make: (app) => staleCard(app), overrides: { shiftKey: true } },
    {
      label: '路径上没有元素时回退到焦点(焦点在面板内)',
      make: (app) => {
        const panel = app.append(new FakeElement('div', { 'data-approval-key': 'approval:1' }))
        return panel.append(new FakeElement('button'))
      },
      path: () => [],
    },
  ]
  for (const { label, make, overrides = {}, path } of cases) {
    const app = new FakeElement('div', { 'data-app': '' })
    const target = make(app)
    const dom = withApprovalDom({ app, activeElement: target })
    const pending = approvalPending()
    try {
      withPending(pending)
      const event = fakeKeyEvent({ path: path === undefined ? [target, app] : path(app), code: 'Enter', ...overrides })
      dom.window.emit(event)
      check(`${label}:不代答`, pending.answers, [])
      check(`${label}:不吞事件`, [event.prevented, event.stopped], [0, 0])
    } finally {
      dom.restore()
    }
  }
}

console.log('--- I⑩ 捕获路径让位:无待答 / 行缺席 / 已作答 / 主视图歧义 / 别的会话 ---')
{
  const scenarios = [
    { label: '没有待答审批', pending: null, build: () => harness() },
    { label: '审批插件未装载(无固定行)', pending: approvalPending(), build: (pending) => withPending(pending, { fixedRows: [] }) },
    { label: '审批已作答', pending: approvalPending({ answerable: false }), build: (pending) => withPending(pending) },
    {
      label: '主视图歧义(两个主视图)',
      pending: approvalPending(),
      build: (pending) => withPending(pending, { summary: { s1: session('s1'), s2: session('s2') } }),
    },
    {
      label: '审批属于别的会话',
      pending: approvalPending(),
      build: (pending) => harness({
        summary: { s1: session('s1'), s2: { id: 's2', running: true, retainedBy: {} } },
        uiSession: fakeUiSession({ status: statusWith('s2', pending) }),
      }),
    },
  ]
  for (const { label, pending, build } of scenarios) {
    const app = new FakeElement('div', { 'data-app': '' })
    const card = staleCard(app)
    const dom = withApprovalDom({ app, activeElement: card })
    try {
      build(pending)
      const event = fakeKeyEvent({ path: [card, app], code: 'Enter' })
      dom.window.emit(event)
      if (pending !== null) check(`${label}:不代答`, pending.answers, [])
      check(`${label}:不吞事件`, [event.prevented, event.stopped], [0, 0])
    } finally {
      dom.restore()
    }
  }
}

console.log('--- I⑪ 卸载:捕获监听随桥一起释放 ---')
{
  const app = new FakeElement('div', { 'data-app': '' })
  const card = staleCard(app)
  const dom = withApprovalDom({ app, activeElement: card })
  const pending = approvalPending()
  try {
    const { ctx } = withPending(pending)
    const before = fakeKeyEvent({ path: [card, app], code: 'Enter' })
    dom.window.emit(before)
    check('卸载前:捕获作答', pending.answers, ['allowed-once'])
    check('卸载前:吞事件', [before.prevented, before.stopped], [1, 1])

    for (const effect of ctx.effects) {
      if (typeof effect.dispose === 'function') effect.dispose()
    }
    check('释放后 window 上不留捕获监听(页面循环桥的一并释放)', dom.window.listeners.size, 0)

    const after = fakeKeyEvent({ path: [card, app], code: 'Enter' })
    dom.window.emit(after)
    check('卸载后:不再作答', pending.answers, ['allowed-once'])
    check('卸载后:不吞事件', [after.prevented, after.stopped], [0, 0])
  } finally {
    dom.restore()
  }
}

console.log('--- I⑫ 作答后的焦点环:被按下过的控件不再画边框 ---')
{
  const MARKER = 'data-dsh-automatic-focus'
  const navKey = (key, overrides = {}) => ({ key, isComposing: false, ctrlKey: false, altKey: false, metaKey: false, ...overrides })

  // ① 捕获路径:焦点停在工具行上 → 作答、打上"无环聚焦"标记,且不移焦点。
  {
    const app = new FakeElement('div', { 'data-app': '' })
    const card = staleCard(app)
    const dom = withApprovalDom({ app, activeElement: card })
    const pending = approvalPending()
    try {
      withPending(pending)
      dom.window.emit(fakeKeyEvent({ path: [card, app], code: 'Enter' }))
      check('捕获路径作答', pending.answers, ['allowed-once'])
      checkTrue('工具行被打上无环标记', card.hasAttribute(MARKER))
      check('焦点没有被移动', card.focusCount, 0)
      card.dispatch('keydown', navKey('Control', { ctrlKey: true }))
      checkTrue('带修饰键的按键不解除标记', card.hasAttribute(MARKER))
      card.dispatch('keydown', navKey('Tab'))
      check('Tab 导航后恢复常规焦点样式', card.hasAttribute(MARKER), false)
      check('释放后不留下监听', card.listenerCount('keydown'), 0)
    } finally {
      dom.restore()
    }
  }

  // ② blur 同样释放标记。
  {
    const app = new FakeElement('div', { 'data-app': '' })
    const card = staleCard(app)
    const dom = withApprovalDom({ app, activeElement: card })
    try {
      withPending(approvalPending())
      dom.window.emit(fakeKeyEvent({ path: [card, app], code: 'Enter' }))
      checkTrue('先打上标记', card.hasAttribute(MARKER))
      card.dispatch('blur', {})
      check('失焦后移除标记', card.hasAttribute(MARKER), false)
      check('解除后不留下监听', card.listenerCount('blur'), 0)
    } finally {
      dom.restore()
    }
  }

  // ③ 观察者路径(固定通道自己消费了这一按)同样处理。
  {
    const app = new FakeElement('div', { 'data-app': '' })
    const control = app.append(new FakeElement('button'))
    const dom = withApprovalDom({ app, activeElement: control })
    const pending = approvalPending()
    try {
      const { shortcuts } = withPending(pending)
      const press = keydown(gesture('Enter'), shortcutContext({ target: control }))
      shortcuts.emit(press.input)
      check('观察者路径作答', pending.answers, ['allowed-once'])
      checkTrue('观察者路径也打标记', control.hasAttribute(MARKER))
    } finally {
      dom.restore()
    }
  }

  // ④ 目标不是当前焦点(焦点不在任何控件上)→ 不打标记。
  {
    const app = new FakeElement('div', { 'data-app': '' })
    const card = staleCard(app)
    const dom = withApprovalDom({ app, activeElement: null })
    try {
      withPending(approvalPending())
      dom.window.emit(fakeKeyEvent({ path: [card, app], code: 'Enter' }))
      check('目标不是焦点时不打标记', card.hasAttribute(MARKER), false)
    } finally {
      dom.restore()
    }
  }
}

console.log('--- I⑬ 全屏右栏盖住审批:这一按归右栏关栏,审批不作答 ---')
{
  // 右栏全屏呈现时浮层盖住整块 composer,审批卡片在下面看不见;两条 Esc 路(捕获与固定通道)
  // 都要让位,否则同一次按键会一边关栏、一边拒掉一个看不见的审批。
  const withFullscreenPanel = (app) => {
    const panel = app.append(new FakeElement('div', {
      'data-sidebar-right-session': 's1',
      'data-sidebar-right-panel': 'fullscreen',
      'data-sidebar-right-open': '',
    }))
    return staleCard(panel)
  }

  const app = new FakeElement('div', { 'data-app': '' })
  const panelCard = withFullscreenPanel(app)
  const dom = withApprovalDom({ app, activeElement: panelCard })
  const pending = approvalPending()
  try {
    const { shortcuts, sidebar } = withPending(pending)
    const escape = fakeKeyEvent({ path: [panelCard, app], code: 'Escape' })
    dom.window.emit(escape)
    check('捕获路:不作答', pending.answers, [])
    check('捕获路:这一按归全屏关栏桥', sidebar.calls, [['toggleExpanded']])

    // 固定通道那一半:全屏关栏桥命中时会在捕获阶段停掉事件,观察者收不到;这里直接投给观察者,
    // 模拟两路模态读数不一致等边角情形,审批同样让位。
    const fixed = keydown(gesture('Escape'), shortcutContext({ target: panelCard }))
    shortcuts.emit(fixed.input)
    check('观察者路:不作答', pending.answers, [])
    check('观察者路:不消费', fixed.consumed.count, 0)
  } finally {
    dom.restore()
  }
}

console.log('--- I⑭ 隐藏会话遗留的全屏面板不挡审批:Enter / Esc 仍可作答 ---')
{
  // 非当前会话的整棵视图带 hidden / aria-hidden="true",里面那份全屏右栏的标记仍在 DOM 里。
  // 旧实现把第一个匹配当成当前浮层,审批的两条路径都会静默让位,按键成了无主按键。
  for (const [label, attributes] of [['hidden', { hidden: '' }], ['aria-hidden', { 'aria-hidden': 'true' }]]) {
    const app = new FakeElement('div', { 'data-app': '' })
    const hiddenSession = app.append(new FakeElement('div', { 'data-sidebar-right-session': 's2', ...attributes }))
    hiddenSession.append(new FakeElement('div', {
      'data-sidebar-right-session': 's2',
      'data-sidebar-right-panel': 'fullscreen',
      'data-sidebar-right-open': '',
    }))
    const card = staleCard(app)
    const dom = withApprovalDom({ app, activeElement: card })
    const pending = approvalPending()
    try {
      const { shortcuts, sidebar } = withPending(pending)

      // 捕获路径:焦点停在过程卡片上,Enter 应照常允许一次,而不是被隐藏面板挡掉。
      const enter = fakeKeyEvent({ path: [card, app], code: 'Enter' })
      dom.window.emit(enter)
      check(`${label}:捕获路 Enter 仍作答`, pending.answers, ['allowed-once'])
      check(`${label}:捕获路 Enter 被吞`, [enter.prevented, enter.stopped], [1, 1])
      check(`${label}:不关看不见的侧栏`, sidebar.calls, [])

      // 固定通道路径同样让位给审批,而不是让位给隐藏面板。
      const fixed = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
      shortcuts.emit(fixed.input)
      check(`${label}:观察者路 Enter 仍作答`, pending.answers, ['allowed-once', 'allowed-once'])
      check(`${label}:观察者路消费按键`, fixed.consumed.count, 1)

      // Esc 也应照常拒绝,并且不落到隐藏会话的关栏动作上。
      const escape = fakeKeyEvent({ path: [card, app], code: 'Escape' })
      dom.window.emit(escape)
      check(`${label}:捕获路 Esc 仍作答`, pending.answers, ['allowed-once', 'allowed-once', 'rejected'])
      check(`${label}:捕获路 Esc 被吞`, [escape.prevented, escape.stopped], [1, 1])
      check(`${label}:Esc 不关栏`, sidebar.calls, [])
    } finally {
      dom.restore()
    }
  }
}

console.log('--- I⑮ 关栏宽限:刚用 Esc 关掉全屏右栏,这一按不拒绝审批 ---')
{
  // 关栏桥会先把面板折叠、再记下时刻;用户常在折叠动画期间再按一下(或浏览器重复投递),
  // 这一下不能落到刚露出来的审批上。宽限内只让位给那次关栏,Enter(允许一次)另行。
  const app = new FakeElement('div', { 'data-app': '' })
  const card = staleCard(app)
  const dom = withApprovalDom({ app, activeElement: card })
  const pending = approvalPending()
  const { shortcuts } = withPending(pending)
  try {
    markFullscreenDismissed(performance.now())

    // 捕获路径:先于卡片处理器;宽限内这一按归关栏桥继续吞掉,审批不作答。
    const capture = fakeKeyEvent({ path: [card, app], code: 'Escape' })
    dom.window.emit(capture)
    check('捕获路宽限内:不拒绝', pending.answers, [])
    check('捕获路宽限内:被关栏桥吞掉', [capture.prevented, capture.stopped], [1, 1])

    // 固定通道那条路读同一条宽限。
    const fixed = keydown(gesture('Escape'), shortcutContext({ target: card }))
    shortcuts.emit(fixed.input)
    check('固定通道宽限内:不拒绝', pending.answers, [])
    check('固定通道宽限内:不消费', fixed.consumed.count, 0)

    // Enter 不受宽限影响:允许一次照常作答。
    const allow = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
    shortcuts.emit(allow.input)
    check('宽限内 Enter:照常允许一次', pending.answers, ['allowed-once'])
    check('宽限内 Enter:被消费', allow.consumed.count, 1)

    // 宽限过期后,同一按重新归审批固定行。
    markFullscreenDismissed(performance.now() - 1000)
    const later = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
    shortcuts.emit(later.input)
    check('宽限过后 Esc:照常拒绝', pending.answers, ['allowed-once', 'rejected'])
    check('宽限过后 Esc:被消费', later.consumed.count, 1)
  } finally {
    dom.restore()
  }
}

finish()
