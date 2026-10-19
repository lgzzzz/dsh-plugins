/**
 * 提问桥:`Esc` 关掉正在等答的提问卡片(含 plan-review)。覆盖无焦点关闭、别的文本控件
 * 不抢、准入否决、归属歧义、服务缺失即不装、关闭失败告警与卸载复位。
 */
import { applyPlugin, approvalPending, captureWarnings, check, checkTrue, domBody, domComposer, domPlanReviewButton, domQuestionField, FakeElement, fakeDocument, fakeSessions, fakeShortcuts, fakeSidebar, fakeUiSession, FakeCtx, finish, gesture, harness, keydown, PLAN_REVIEW_KEY, QUESTION_KEY, questionPending, session, shortcutContext, sleep, statusWith } from './focus-helpers.mjs'

/** 装配一个"主视图 s1 正挂着一条待答提问"的场景。 */
function withPending(pending, options = {}) {
  return harness({ ...options, uiSession: fakeUiSession({ status: statusWith('s1', pending) }) })
}

console.log('--- O① 无焦点:Esc 关掉正在等答的提问 ---')
{
  let cancelled = 0
  const pending = questionPending()
  const { shortcuts } = withPending(pending, { conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })

  const press = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  shortcuts.emit(press.input)
  check('Esc → 关闭一次', pending.dismissals, 1)
  check('Esc 被消费', press.consumed.count, 1)
  check('关卡片不是停回合', cancelled, 0)

  // 焦点在卡片自己的答案文本域里同样关得掉。
  const inside = keydown(gesture('Escape'), shortcutContext({ region: 'editable', target: domQuestionField }))
  shortcuts.emit(inside.input)
  check('卡片自己文本域里的 Esc → 仍然关闭', pending.dismissals, 2)
  check('卡片内 Esc 被消费', inside.consumed.count, 1)

  // 焦点落在别处(消息上)也照关。
  const elsewhere = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  shortcuts.emit(elsewhere.input)
  check('焦点在别处也关闭', pending.dismissals, 3)
}

console.log('--- O② 别的文本控件保持自己的 Esc ---')
{
  const pending = questionPending()
  const { shortcuts } = withPending(pending)
  const press = keydown(gesture('Escape'), shortcutContext({ region: 'editable', target: domComposer }))
  shortcuts.emit(press.input)
  check('侧栏搜索框 / 重命名框之类的 Esc 不关卡片', pending.dismissals, 0)
  check('别的文本控件不消费', press.consumed.count, 0)
}

console.log('--- O③ plan-review 卡片与别的待答域 ---')
{
  const review = questionPending({ key: PLAN_REVIEW_KEY, kind: 'plan-review' })
  const { shortcuts } = withPending(review)
  const press = keydown(gesture('Escape'), shortcutContext({ target: domPlanReviewButton }))
  shortcuts.emit(press.input)
  check('plan-review 卡片也由 Esc 关闭', review.dismissals, 1)
  check('plan-review 的 Esc 被消费', press.consumed.count, 1)

  // 审批域的这一按不归提问桥:摘掉审批桥的固定行后没人消费。
  const approval = approvalPending()
  const approvalHarness = withPending(approval, { fixedRows: [] })
  const other = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  approvalHarness.shortcuts.emit(other.input)
  check('审批域不归提问桥(没人消费)', other.consumed.count, 0)
  check('审批没被当成提问关掉', approval.answers, [])
}

console.log('--- O④ 准入否决:终端 / 模态 / repeat / 组字 / 已被消费 / 带修饰键 ---')
{
  const cases = [
    ['终端内', { region: 'terminal' }, {}],
    ['模态层之上', { region: 'page', modal: 'settings' }, {}],
    ['长按重复', {}, { repeat: true }],
    ['组字中', {}, { composing: true }],
    ['已被消费', {}, { defaultPrevented: true }],
    ['Ctrl+Esc', {}, { control: true }],
    ['Alt+Esc', {}, { alt: true }],
    ['Shift+Esc', {}, { shift: true }],
    ['Meta+Esc', {}, { meta: true }],
  ]
  for (const [label, context, overrides] of cases) {
    const pending = questionPending()
    const { shortcuts } = withPending(pending)
    const press = keydown(gesture('Escape', overrides), shortcutContext(context))
    shortcuts.emit(press.input)
    check(`${label}不关闭`, pending.dismissals, 0)
    check(`${label}不消费`, press.consumed.count, 0)
  }
}

console.log('--- O⑤ 归属歧义:主视图不唯一 / 提问属于别的会话 ---')
{
  const ambiguous = questionPending()
  const two = withPending(ambiguous, { summary: { s1: { id: 's1', running: true, retainedBy: { mainView: 1 } }, s2: { id: 's2', running: true, retainedBy: { mainView: 1 } } } })
  const press = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  two.shortcuts.emit(press.input)
  check('切换中(两个主视图)不关闭', ambiguous.dismissals, 0)
  check('切换中不消费', press.consumed.count, 0)

  // 提问属于别的会话:提问桥不关它,这一按落回停止序列(第一下起序列)。
  const background = questionPending()
  let stopped = 0
  const detached = harness({
    summary: { s1: { id: 's1', running: true, retainedBy: { mainView: 1 } }, s2: { id: 's2', running: true, retainedBy: {} } },
    uiSession: fakeUiSession({ status: statusWith('s2', background) }),
    conversation: { cancel: () => { stopped += 1; return Promise.resolve() } },
  })
  const other = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  detached.shortcuts.emit(other.input)
  check('别的会话的提问不关闭', background.dismissals, 0)
  check('主视图没有待答时这一按仍归停止序列', other.consumed.count, 1)
  check('第一下只是起序列', stopped, 0)
  detached.shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  check('第二下照常停止主视图轮次', stopped, 1)
}

console.log('--- O⑥ 失败模式:服务缺失即不装 ---')
{
  // 没有 uiSession 就没有待答事实可读,提问桥与审批桥都不安装。
  const noUi = harness({ withUiSession: false })
  check('缺 uiSession 不装提问桥', noUi.shortcuts.listenerCount(), 7)
  check('缺 uiSession 不告警', noUi.warnings.length, 0)

  // 没有 sessions 同样不装。
  const noSessions = harness({ withSessions: false })
  check('缺 sessions 不装提问桥', noSessions.shortcuts.listenerCount(), 5)

  // 假 shortcuts 缺 observeFixedInput:各桥各告警一次,提问桥也不装。
  const bare = new FakeCtx({
    shortcuts: { ...fakeShortcuts(), observeFixedInput: undefined },
    sidebarRight: fakeSidebar(),
    sessions: fakeSessions({ summary: { s1: session('s1') } }),
    uiSession: fakeUiSession(),
  })
  const warnings = captureWarnings(() => applyPlugin(bare))
  checkTrue('缺 observeFixedInput 时提问桥告警', warnings.some((line) => line.includes('question bridge not installed')))
  check('缺 observeFixedInput 时只装不依赖固定键的部分', bare.effects.map((effect) => effect.label), ['dsh-keyboard-shortcuts: chat paging', 'dsh-keyboard-shortcuts: collapse seal style'])
}

console.log('--- O⑦ dismiss 被拒绝:捕获并告警,按键仍已归属 ---')
{
  const rejecting = questionPending({ onDismiss: () => Promise.reject(new Error('boom')) })
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
  checkTrue('拒绝被捕获并告警', warnings.some((line) => line.includes('was not cancelled')))
}

console.log('--- O⑧ 卸载:固定监听全部释放 ---')
{
  const pending = questionPending()
  const { ctx, shortcuts } = withPending(pending)
  check('注册了十个固定监听', shortcuts.listenerCount(), 10)
  for (const effect of ctx.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  check('释放后监听清空', shortcuts.listenerCount(), 0)
  const press = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  shortcuts.emit(press.input)
  check('释放后不再关闭', pending.dismissals, 0)
  check('释放后不再消费', press.consumed.count, 0)
}

console.log('--- O⑨ 全屏右栏盖住提问卡片:这一按归右栏关栏,卡片不作答 ---')
{
  // 卡片与审批面板一样是 composer 顶替,全屏右栏盖住整块 composer 后它看不见。关栏桥命中时
  // 会在捕获阶段停掉这一按、观察者收不到;这里直接投给观察者,模拟边角情形,卡片同样让位。
  const previousDocument = globalThis.document
  const app = new FakeElement('div', { 'data-app': '' })
  app.append(new FakeElement('div', {
    'data-sidebar-right-session': 's1',
    'data-sidebar-right-panel': 'fullscreen',
    'data-sidebar-right-open': '',
  }))
  globalThis.document = fakeDocument({ root: app })
  const pending = questionPending()
  try {
    const { shortcuts } = withPending(pending)
    const press = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
    shortcuts.emit(press.input)
    check('卡片不作答', pending.dismissals, 0)
    check('不消费', press.consumed.count, 0)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
}

finish()
