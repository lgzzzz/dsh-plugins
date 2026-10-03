/**
 * F 桥接:停止序列 —— 走线 `src/stop-sequence.ts` 的 Esc Esc 停止桥。覆盖焦点不在
 * 输入框时的两按停止、内置序列掌权时让位、reset、各类否决(不在运行 /
 * 有待答交互 / 会话歧义 / 带修饰键 / 超窗)、失败模式与卸载复位。
 *
 * 运行:`node test/bridge-stop-sequence.test.mjs`(或 pnpm test 跑全部)。
 */
import { applyPlugin, captureWarnings, check, checkTrue, domBody, domComposer, fakeSessions, fakeShortcuts, FakeCtx, finish, gesture, harness, keydown, session, shortcutContext, sleep } from './helpers.mjs'

console.log('--- F① 焦点不在输入框:Esc Esc 仍能停止 ---')
{
  let cancelled = 0
  const { shortcuts } = harness({ conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })
  const first = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  shortcuts.emit(first.input)
  check('第一按不停止', cancelled, 0)
  check('第一按仍消费', first.consumed.count, 1)
  const second = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  shortcuts.emit(second.input)
  check('第二按停止一次', cancelled, 1)
  check('第二按消费', second.consumed.count, 1)
  const third = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
  shortcuts.emit(third.input)
  check('第三按只是新的第一按', cancelled, 1)
}
console.log('--- F② 焦点在会话区内:内置序列掌权,本插件不插手 ---')
{
  let cancelled = 0
  const { shortcuts } = harness({ conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })
  const first = keydown(gesture('Escape'), shortcutContext({ region: 'editable', target: domComposer }))
  shortcuts.emit(first.input)
  const second = keydown(gesture('Escape'), shortcutContext({ region: 'editable', target: domComposer }))
  shortcuts.emit(second.input)
  check('不重复停止', cancelled, 0)
  check('不消费(交给内置)', first.consumed.count + second.consumed.count, 0)
}
console.log('--- F③ reset 输入清空待完成的第一按 ---')
{
  let cancelled = 0
  const { shortcuts } = harness({ conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  shortcuts.emit({ type: 'reset' })
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  check('reset 后两按被拆开', cancelled, 0)
}
console.log('--- F④ 不在运行 / 有待答交互 / 会话歧义 / 有修饰键 / 超窗 ---')
{
  const stop = (options) => {
    let cancelled = 0
    const { shortcuts } = harness({ ...options, conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })
    for (let index = 0; index < 2; index += 1) {
      shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
    }
    return cancelled
  }
  check('列表 saying not running', stop({ summary: { s1: session('s1', { running: false }) } }), 0)
  check('对象层 not running', stop({ bindingSnapshot: { running: false } }), 0)
  check('已移除会话', stop({ bindingSnapshot: { removed: true } }), 0)
  check('不可续子代理', stop({ bindingSnapshot: { subagent: { address: { mode: 'one-shot' } } } }), 0)
  check('两个主视图(切换中)', stop({ summary: { s1: session('s1'), s2: session('s2') } }), 0)
  check('没有主视图', stop({ summary: { s1: session('s1', { mainView: 0 }) } }), 0)
  check(
    '有待答交互',
    stop({
      uiSession: {
        sessionStatus: { getSnapshot: () => new Map([['s1', { running: true, pendingInteraction: { key: 'k' }, completionUnread: false }]]) },
      },
    }),
    0,
  )
  check('正常场景作对照', stop({}), 1)
}
{
  let cancelled = 0
  const { shortcuts } = harness({ conversation: { cancel: () => { cancelled += 1; return Promise.resolve() } } })
  shortcuts.emit(keydown(gesture('Escape', { shift: true }), shortcutContext({ target: domBody })).input)
  shortcuts.emit(keydown(gesture('Escape', { shift: true }), shortcutContext({ target: domBody })).input)
  check('带修饰键不停止', cancelled, 0)

  const timedShortcuts = fakeShortcuts({ stopSequenceMs: 20, rows: [] })
  const timedCtx = new FakeCtx({
    shortcuts: timedShortcuts,
    sessions: fakeSessions({ summary: { s1: session('s1') }, scope: () => ({ get: () => ({ cancel: () => { cancelled += 1; return Promise.resolve() } }) }) }),
  })
  applyPlugin(timedCtx)
  timedShortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  await sleep(35)
  timedShortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  check('超窗不停止', cancelled, 0)
}
console.log('--- F⑤ 失败模式:conversation 缺席 / cancel 拒绝 ---')
{
  const { shortcuts } = harness({ conversation: null })
  const warnings = captureWarnings(() => {
    shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
    const second = keydown(gesture('Escape'), shortcutContext({ target: domBody }))
    shortcuts.emit(second.input)
    check('缺席时仍消费该序列', second.consumed.count, 1)
  })
  checkTrue('缺席 conversation 记一条 warn', warnings.some((line) => line.includes('conversation service unavailable')))

  const rejecting = harness({ conversation: { cancel: () => Promise.reject(new Error('boom')) } })
  const warnings2 = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings2.push(args.map(String).join(' '))
  try {
    rejecting.shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
    rejecting.shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
    await sleep(1)
  } finally {
    console.warn = originalWarn
  }
  checkTrue('cancel 拒绝被捕获并告警', warnings2.some((line) => line.includes('stop failed')))
}

console.log('--- F⑥ 卸载:效果被释放,固定监听移除 ---')
{
  const { shortcuts, ctx } = harness()
  check('注册了固定监听(面板 + 停止 + 审批 + 提问 + 聚焦 + 页面循环)', shortcuts.listenerCount(), 6)
  for (const effect of ctx.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  check('释放后监听清空', shortcuts.listenerCount(), 0)
}

finish()
