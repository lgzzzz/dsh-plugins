/**
 * 按键解码:浮层只认没有修饰键的 Escape / Enter / ArrowUp / ArrowDown,组合中、已被消费、
 * 长按重复的确认键都放行。纯函数,不碰 DOM。
 *
 * 运行:`node test/keys.test.mjs`(或 pnpm test 跑全部)。
 */
import { QUICK_SWITCH_BINDING, QUICK_SWITCH_ID, quickSwitchKeys, quickSwitchPress } from '../src/palette.ts'
import { paletteAction } from '../src/client.ts'
import { check, checkTrue, checkUndefined, finish } from './helpers.mjs'

const key = (name, overrides = {}) => ({ key: name, ...overrides })

console.log('--- B① 归浮层管的四个键 ---')
{
  check('Escape 关闭', paletteAction(key('Escape')), 'close')
  check('Enter 确认', paletteAction(key('Enter')), 'confirm')
  check('ArrowDown 下一行', paletteAction(key('ArrowDown')), 'next')
  check('ArrowUp 上一行', paletteAction(key('ArrowUp')), 'previous')
}

console.log('--- B② 带修饰键一律放行(不抢 Ctrl+↑ / Shift+↑ 这类有主的键)---')
{
  checkUndefined('Ctrl+ArrowUp', paletteAction(key('ArrowUp', { ctrlKey: true })))
  checkUndefined('Alt+ArrowDown', paletteAction(key('ArrowDown', { altKey: true })))
  checkUndefined('Shift+Enter', paletteAction(key('Enter', { shiftKey: true })))
  checkUndefined('Meta+Escape', paletteAction(key('Escape', { metaKey: true })))
}

console.log('--- B③ 组合输入、已消费、长按重复 ---')
{
  checkUndefined('输入法组合中', paletteAction(key('Enter', { isComposing: true })))
  checkUndefined('已被前面的处理器消费', paletteAction(key('Escape', { defaultPrevented: true })))
  checkUndefined('长按 Enter(避免一次长按连开好几个会话)', paletteAction(key('Enter', { repeat: true })))
  checkUndefined('长按 Escape', paletteAction(key('Escape', { repeat: true })))
  check('按住不放的 ↓ 仍然可以连翻', paletteAction(key('ArrowDown', { repeat: true })), 'next')
}

console.log('--- B④ 其它键不归它 ---')
{
  checkUndefined('普通字符键', paletteAction(key('m')))
  checkUndefined('Ctrl+Alt+M 本身(打开键由固定行处理)', paletteAction(key('m', { ctrlKey: true, altKey: true })))
  checkUndefined('⌘⌥M 本身(macOS 上同一个打开键)', paletteAction(key('m', { metaKey: true, altKey: true })))
  checkUndefined('Tab', paletteAction(key('Tab')))
  checkUndefined('空格', paletteAction(key(' ')))
}

console.log('--- B⑤ 固定行声明与平台展开 ---')
{
  check('逻辑组合是 primary+alt+M', [QUICK_SWITCH_BINDING.code, QUICK_SWITCH_BINDING.modifiers], ['KeyM', ['primary', 'alt']])
  check('固定行 id', QUICK_SWITCH_ID, 'dsh-workspace-quick-switch.quick-switch')

  check('macOS 键帽', quickSwitchKeys('macos'), ['⌘', '⌥', 'M'])
  check('Windows 键帽', quickSwitchKeys('windows'), ['Ctrl', 'Alt', 'M'])
  check('Linux 键帽', quickSwitchKeys('linux'), ['Ctrl', 'Alt', 'M'])
}

console.log('--- B⑥ 按键归属:各平台只认自己那一组 ---')
{
  checkTrue('macOS 认 ⌘⌥M', quickSwitchPress('macos', { code: 'KeyM', meta: true, alt: true }))
  check('macOS 不认 Ctrl+Alt+M(那是 Windows 的键)', quickSwitchPress('macos', { code: 'KeyM', control: true, alt: true }), false)
  checkTrue('Windows 认 Ctrl+Alt+M', quickSwitchPress('windows', { code: 'KeyM', control: true, alt: true }))
  check('Windows 不认 ⌘⌥M(那是 macOS 的键)', quickSwitchPress('windows', { code: 'KeyM', meta: true, alt: true }), false)
  check('Linux 认 Ctrl+Alt+M', quickSwitchPress('linux', { code: 'KeyM', control: true, alt: true }), true)

  check('多按 Shift 不认', quickSwitchPress('macos', { code: 'KeyM', meta: true, alt: true, shift: true }), false)
  check('缺 Alt 不认', quickSwitchPress('macos', { code: 'KeyM', meta: true }), false)
  check('缺主修饰键不认', quickSwitchPress('macos', { code: 'KeyM', alt: true }), false)
  check('按键不对不认', quickSwitchPress('macos', { code: 'KeyJ', meta: true, alt: true }), false)
}

finish()
