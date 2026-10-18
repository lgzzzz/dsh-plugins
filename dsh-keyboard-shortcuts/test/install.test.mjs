/**
 * 固定行装配：注册八条官方固定行、固定输入调用官方命令、终端捕获与卸载。
 *
 * 测试的假服务只提供 `registerFixed()` / `observeFixedInput()` 与内部
 * `registry.invoke()`；插件若自己执行业务动作，这里没有任何动作服务可调，测试会失败。
 *
 * 运行：`node test/install.test.mjs`（或 pnpm test 跑全部）。
 */
import { installFixedKeyBridge as apply } from '../src/fixed-keys.ts'
import { TARGETS, fixedIdOf } from '../src/shortcuts.ts'
import {
  OFFICIAL_LABELS,
  captureWarnings,
  check,
  checkFalse,
  checkTrue,
  fakeCtx,
  fakeShortcuts,
  fakeWindow,
  finish,
  fixedKeydown,
  officialRows,
  pageKeydown,
  terminalKeydown,
} from './helpers.mjs'

console.log('--- B① 八条固定行、观察者与终端捕获 ---')
{
  const previousWindow = globalThis.window
  const window = fakeWindow()
  globalThis.window = window
  try {
    const shortcuts = fakeShortcuts()
    const ctx = fakeCtx({ shortcuts })
    apply(ctx)

    check('固定行 id', shortcuts.commands.map((command) => command.id), TARGETS.map(fixedIdOf))
    check(
      '固定行键帽',
      shortcuts.commands.map((command) => command.keys),
      [
        ['Ctrl', 'Alt', 'N'],
        ['Ctrl', 'Alt', 'B'],
        ['Ctrl', 'Alt', 'P'],
        ['Ctrl', 'Alt', 'O'],
        ['Ctrl', 'Alt', '\\'],
        ['Ctrl', 'Alt', 'L'],
        ['Ctrl', 'Alt', 'Enter'],
        ['Ctrl', 'Alt', ','],
      ],
    )
    check(
      '固定行绑定',
      shortcuts.commands.map((command) => command.bindings),
      TARGETS.map((target) => [{ code: target.binding.code, modifiers: ['primary', 'alt'] }]),
    )
    check('固定行名称来自官方目录', shortcuts.commands.map((command) => command.label()), [
      OFFICIAL_LABELS['session.new'],
      OFFICIAL_LABELS['sidebar.left.toggle'],
      OFFICIAL_LABELS['workspace.openLocal'],
      OFFICIAL_LABELS['sidebar.right.toggle'],
      OFFICIAL_LABELS['workspace.files'],
      OFFICIAL_LABELS['terminal.new'],
      OFFICIAL_LABELS['pane.fullscreen.toggle'],
      OFFICIAL_LABELS['page.close'],
    ])
    check('分组都是 application', shortcuts.commands.map((command) => command.group), Array(8).fill('application'))
    checkTrue('固定输入观察者已挂', shortcuts.hasObserver())
    check('终端捕获监听已挂', window.listenerCount(), 1)

    ctx.disposeAll()
    check('卸载后固定行清空', shortcuts.commands.length, 0)
    checkFalse('卸载后观察者清空', shortcuts.hasObserver())
    check('卸载后终端监听清空', window.listenerCount(), 0)
  } finally {
    globalThis.window = previousWindow
  }
}

console.log('--- B② 固定输入只调官方命令 ---')
{
  const previousWindow = globalThis.window
  globalThis.window = fakeWindow()
  try {
    const shortcuts = fakeShortcuts()
    const ctx = fakeCtx({ shortcuts })
    apply(ctx)

    const keys = ['KeyN', 'KeyB', 'KeyP', 'KeyO', 'Backslash', 'KeyL', 'Enter', 'Comma']
    for (const code of keys) {
      const input = fixedKeydown(code, { control: true, alt: true })
      shortcuts.fire(input)
      checkTrue(`${code} 被消费`, input.consumed)
    }
    check(
      '调用顺序是官方命令 id',
      shortcuts.invocations.map((entry) => entry.id),
      [
        'session.new',
        'sidebar.left.toggle',
        'workspace.openLocal',
        'sidebar.right.toggle',
        'workspace.files',
        'terminal.new',
        'pane.fullscreen.toggle',
        'page.close',
      ],
    )
    check('默认上下文', shortcuts.invocations[0].context, {
      source: 'keyboard',
      region: 'page',
      modal: null,
      target: null,
    })

    const modalInput = fixedKeydown('KeyN', {
      control: true,
      alt: true,
      context: { region: 'editable', modal: 'settings', target: null },
    })
    shortcuts.fire(modalInput)
    check('模态上下文原样交给官方命令', shortcuts.invocations.at(-1).context, {
      source: 'keyboard',
      region: 'editable',
      modal: 'settings',
      target: null,
    })

    const before = shortcuts.invocations.length
    shortcuts.fire(fixedKeydown('KeyN', { control: true }))
    shortcuts.fire(fixedKeydown('KeyN', { control: true, alt: true, shift: true }))
    shortcuts.fire(fixedKeydown('KeyN', { control: true, alt: true, repeat: true }))
    shortcuts.fire(fixedKeydown('KeyN', { control: true, alt: true, composing: true }))
    shortcuts.fire(fixedKeydown('KeyN', { control: true, alt: true, defaultPrevented: true }))
    check('不匹配 / 长按 / 组字 / 已消费不调命令', shortcuts.invocations.length, before)
  } finally {
    globalThis.window = previousWindow
  }
}

console.log('--- B③ macOS 平台键 ---')
{
  const previousWindow = globalThis.window
  globalThis.window = fakeWindow()
  try {
    const shortcuts = fakeShortcuts({ platform: 'macos' })
    const ctx = fakeCtx({ shortcuts })
    apply(ctx)
    check('macOS 键帽', shortcuts.commands[0].keys, ['⌘', '⌥', 'N'])

    shortcuts.fire(fixedKeydown('KeyN', { meta: true, alt: true }))
    shortcuts.fire(fixedKeydown('KeyN', { control: true, alt: true }))
    check('只认 ⌘⌥N', shortcuts.invocations.map((entry) => entry.id), ['session.new'])
  } finally {
    globalThis.window = previousWindow
  }
}

console.log('--- B④ 终端捕获：吞键后调同一个官方命令 ---')
{
  const previousWindow = globalThis.window
  const window = fakeWindow()
  globalThis.window = window
  try {
    const shortcuts = fakeShortcuts()
    const ctx = fakeCtx({ shortcuts })
    apply(ctx)

    const event = terminalKeydown('KeyN', { ctrlKey: true, altKey: true })
    window.dispatch('keydown', event)
    check('终端内 Ctrl+Alt+N 调官方命令', shortcuts.invocations.map((entry) => entry.id), ['session.new'])
    check('终端上下文', shortcuts.invocations[0].context, {
      source: 'keyboard',
      region: 'terminal',
      modal: null,
      target: event.composedPath()[0],
    })
    checkTrue('终端内按键被 preventDefault', event.defaultPrevented)
    checkTrue('终端内按键被 stopPropagation', event.stopped)

    const before = shortcuts.invocations.length
    const page = pageKeydown('KeyN', { ctrlKey: true, altKey: true })
    window.dispatch('keydown', page)
    check('非终端落点不抢', shortcuts.invocations.length, before)

    const repeat = terminalKeydown('KeyN', { ctrlKey: true, altKey: true, repeat: true })
    window.dispatch('keydown', repeat)
    check('终端内长按不调命令', shortcuts.invocations.length, before)
    checkFalse('长按也没被吞掉', repeat.defaultPrevented)
  } finally {
    globalThis.window = previousWindow
  }
}

console.log('--- B⑤ 官方命令注册表缺席时不装固定行 ---')
{
  const previousWindow = globalThis.window
  globalThis.window = fakeWindow()
  try {
    const shortcuts = fakeShortcuts({ withRegistry: false })
    const ctx = fakeCtx({ shortcuts })
    const warnings = captureWarnings(() => apply(ctx))
    check('没有固定行', shortcuts.commands.length, 0)
    checkFalse('没有观察者', shortcuts.hasObserver())
    checkTrue('有告警', warnings.some((line) => line.includes('注册表')))
  } finally {
    globalThis.window = previousWindow
  }
}

console.log('--- B⑥ 固定行名称跟随官方目录 ---')
{
  const previousWindow = globalThis.window
  globalThis.window = fakeWindow()
  try {
    const shortcuts = fakeShortcuts({ rows: [] })
    const ctx = fakeCtx({ shortcuts })
    apply(ctx)
    check('目录还没有命令时退回 id', shortcuts.commands[0].label(), 'session.new')

    shortcuts.setRows(officialRows())
    check('命令注册后显示官方名称', shortcuts.commands[0].label(), OFFICIAL_LABELS['session.new'])
  } finally {
    globalThis.window = previousWindow
  }
}

console.log('--- B⑦ 单条固定行注册失败不影响其余 ---')
{
  const previousWindow = globalThis.window
  globalThis.window = fakeWindow()
  try {
    const shortcuts = fakeShortcuts()
    const original = shortcuts.registerFixed
    shortcuts.registerFixed = (command) => {
      if (command.id === fixedIdOf(TARGETS[2])) throw new Error('duplicate')
      return original(command)
    }
    const ctx = fakeCtx({ shortcuts })
    const warnings = captureWarnings(() => apply(ctx))
    check('注册了七条', shortcuts.commands.length, 7)
    checkFalse('失败的一条不在目录里', shortcuts.commands.some((command) => command.id === fixedIdOf(TARGETS[2])))
    checkTrue('有注册失败告警', warnings.some((line) => line.includes('固定行注册失败')))
  } finally {
    globalThis.window = previousWindow
  }
}

console.log('--- B⑧ 卸载后不再调官方命令 ---')
{
  const previousWindow = globalThis.window
  const window = fakeWindow()
  globalThis.window = window
  try {
    const shortcuts = fakeShortcuts()
    const ctx = fakeCtx({ shortcuts })
    apply(ctx)
    ctx.disposeAll()
    shortcuts.fire(fixedKeydown('KeyN', { control: true, alt: true }))
    window.dispatch('keydown', terminalKeydown('KeyN', { ctrlKey: true, altKey: true }))
    check('卸载后固定输入不调命令', shortcuts.invocations.length, 0)
    check('卸载后终端监听清空', window.listenerCount(), 0)
  } finally {
    globalThis.window = previousWindow
  }
}

finish()
