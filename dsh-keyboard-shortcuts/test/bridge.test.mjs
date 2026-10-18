/**
 * 目标表与固定键匹配：官方命令 id、固定行 id、键帽、各平台修饰键。
 *
 * 运行：`node test/bridge.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  TARGETS,
  bindingOf,
  fixedIdOf,
  keycaps,
  targetIds,
  targetForGesture,
} from '../src/shortcuts.ts'
import { check, checkUndefined, finish, gesture } from './helpers.mjs'

console.log('--- A① 八条目标全部落在官方命令 id 上 ---')
{
  check('目标 id', targetIds(), [
    'session.new',
    'sidebar.left.toggle',
    'workspace.openLocal',
    'sidebar.right.toggle',
    'workspace.files',
    'terminal.new',
    'pane.fullscreen.toggle',
    'page.close',
  ])
  check(
    '目标组合',
    TARGETS.map((target) => [target.id, target.binding.code, target.binding.modifiers]),
    [
      ['session.new', 'KeyN', ['primary', 'alt']],
      ['sidebar.left.toggle', 'KeyB', ['primary', 'alt']],
      ['workspace.openLocal', 'KeyP', ['primary', 'alt']],
      ['sidebar.right.toggle', 'KeyO', ['primary', 'alt']],
      ['workspace.files', 'Backslash', ['primary', 'alt']],
      ['terminal.new', 'KeyL', ['primary', 'alt']],
      ['pane.fullscreen.toggle', 'Enter', ['primary', 'alt']],
      ['page.close', 'Comma', ['primary', 'alt']],
    ],
  )
  const keys = TARGETS.map((target) => `${target.binding.code}:${target.binding.modifiers.join('+')}`)
  check('没有重复组合', new Set(keys).size, keys.length)
}

console.log('--- A② 固定行 id 与键帽 ---')
{
  check(
    '固定行 id',
    TARGETS.map(fixedIdOf),
    [
      'dsh-keyboard-shortcuts.session.new',
      'dsh-keyboard-shortcuts.sidebar.left.toggle',
      'dsh-keyboard-shortcuts.workspace.openLocal',
      'dsh-keyboard-shortcuts.sidebar.right.toggle',
      'dsh-keyboard-shortcuts.workspace.files',
      'dsh-keyboard-shortcuts.terminal.new',
      'dsh-keyboard-shortcuts.pane.fullscreen.toggle',
      'dsh-keyboard-shortcuts.page.close',
    ],
  )
  check('逻辑绑定', bindingOf(TARGETS[0]), { code: 'KeyN', modifiers: ['primary', 'alt'] })
  check('Linux 键帽', keycaps(TARGETS[0], 'linux'), ['Ctrl', 'Alt', 'N'])
  check('Windows 键帽', keycaps(TARGETS[4], 'windows'), ['Ctrl', 'Alt', '\\'])
  check('macOS 键帽', keycaps(TARGETS[7], 'macos'), ['⌘', '⌥', ','])
  check('Enter 键帽', keycaps(TARGETS[6], 'linux'), ['Ctrl', 'Alt', 'Enter'])
}

console.log('--- A③ Linux/Windows 认 Ctrl+Alt，macOS 认 ⌘⌥ ---')
{
  check(
    'Linux Ctrl+Alt+N',
    targetForGesture('linux', gesture('KeyN', { control: true, alt: true }))?.id,
    'session.new',
  )
  check(
    'Windows Ctrl+Alt+\\',
    targetForGesture('windows', gesture('Backslash', { control: true, alt: true }))?.id,
    'workspace.files',
  )
  check(
    'macOS ⌘⌥N',
    targetForGesture('macos', gesture('KeyN', { meta: true, alt: true }))?.id,
    'session.new',
  )
  checkUndefined('macOS 不认 Ctrl+Alt+N', targetForGesture('macos', gesture('KeyN', { control: true, alt: true })))
  checkUndefined('Linux 不认 ⌘⌥N', targetForGesture('linux', gesture('KeyN', { meta: true, alt: true })))
}

console.log('--- A④ 修饰键必须恰好匹配 ---')
{
  checkUndefined('多按 Shift', targetForGesture('linux', gesture('KeyN', { control: true, alt: true, shift: true })))
  checkUndefined('少按 Alt', targetForGesture('linux', gesture('KeyN', { control: true })))
  checkUndefined('只按 Alt', targetForGesture('linux', gesture('KeyN', { alt: true })))
  checkUndefined('只是字母 N', targetForGesture('linux', gesture('KeyN')))
  checkUndefined(
    '双键和弦',
    targetForGesture('linux', gesture('KeyN', { control: true, alt: true, secondCode: 'KeyS' })),
  )
  checkUndefined('按键不匹配', targetForGesture('linux', gesture('KeyZ', { control: true, alt: true })))
}

finish()
