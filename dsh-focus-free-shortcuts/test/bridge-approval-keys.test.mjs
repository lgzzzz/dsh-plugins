/**
 * I 桥接:审批键 —— 走线 `src/approval-keys.ts` 的审批桥(Enter 允许一次 / Esc 拒绝)。
 * 覆盖无焦点作答、面板让位、无待答与已作答、别的待答域、准入否决(文本控件 / 终端 /
 * 模态 / repeat / 组字 / 已被消费)、主视图歧义、别的会话的审批、固定行缺失、
 * 服务缺失即不装、答案拒绝告警,以及卸载复位。
 *
 * 运行:`node test/bridge-approval-keys.test.mjs`(或 pnpm test 跑全部)。
 */
import { applyPlugin, captureWarnings, check, checkTrue, domApproval, domBody, domComposer, fakeShortcuts, fakeSidebar, fakeSessions, fakeUiSession, FakeCtx, finish, gesture, harness, keydown, session, shortcutContext, sleep, statusWith, approvalPending } from './helpers.mjs'

/** 装配一个"主视图 s1 正挂着一条待答审批"的场景。 */
function withPending(pending, options = {}) {
  return harness({ ...options, uiSession: fakeUiSession({ status: statusWith('s1', pending) }) })
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

  // 目标在聊天区(有人把焦点落在消息上)同样无焦点作答。
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
  // 没有待答审批时 Esc 仍完整归停止序列:第一下起序列,第二下停止回合。
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

  // 没有 uiSession 就没有待答事实可读:审批桥不安装(只剩面板桥、停止桥与聚焦桥)。
  const noUi = harness({ withUiSession: false })
  check('缺 uiSession 只装面板桥、停止桥与聚焦桥', noUi.shortcuts.listenerCount(), 3)
  check('缺 uiSession 不告警', noUi.warnings.length, 0)
  const orphan = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
  noUi.shortcuts.emit(orphan.input)
  check('缺 uiSession 时不消费', orphan.consumed.count, 0)

  // 没有 sessions 就连停止桥与审批桥都不装。
  const noSessions = harness({ withSessions: false })
  check('缺 sessions 只装面板桥', noSessions.shortcuts.listenerCount(), 1)

  // 假 shortcuts 缺 observeFixedInput:各桥各告警一次,审批桥也不装。
  const bare = new FakeCtx({
    shortcuts: { ...fakeShortcuts(), observeFixedInput: undefined },
    sidebarRight: fakeSidebar(),
    sessions: fakeSessions({ summary: { s1: session('s1') } }),
    uiSession: fakeUiSession(),
  })
  const warnings = captureWarnings(() => applyPlugin(bare))
  checkTrue('缺 observeFixedInput 时审批桥告警', warnings.some((line) => line.includes('approval bridge not installed')))
  check('缺 observeFixedInput 时未装监听', bare.effects.length, 0)
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
  check('注册了四个固定监听', shortcuts.listenerCount(), 4)
  for (const effect of ctx.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  check('释放后监听清空', shortcuts.listenerCount(), 0)
  const press = keydown(gesture('Enter'), shortcutContext({ target: domBody }))
  shortcuts.emit(press.input)
  check('释放后不再消费', press.consumed.count, 0)
}

finish()
