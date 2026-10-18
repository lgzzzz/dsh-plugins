/**
 * 绑定纯函数:修饰键归一、绑定匹配、生效绑定(解绑 / 保留 / 冲突 / 缺席),
 * 以及"谁是这一按的 owner"。
 */
import { bindingMatches, enabledBinding, modifiersOf } from '../src/binding.ts'
import { paneSplitFor } from '../src/pane-split.ts'
import { check, checkTrue, finish, FULLSCREEN_BINDING, FULLSCREEN_PRESS, gesture, row, SPLIT_BINDING, SPLIT_PRESS } from './focus-helpers.mjs'

console.log('--- A① 修饰键顺序与绑定匹配 ---')
{
  check('control+shift 归一顺序', modifiersOf(gesture('KeyK', { shift: true, control: true })), ['control', 'shift'])
  check('alt+meta 归一顺序', modifiersOf(FULLSCREEN_PRESS), ['alt', 'meta'])
  checkTrue('⌘⌥Enter 命中默认绑定', bindingMatches(FULLSCREEN_BINDING, FULLSCREEN_PRESS))
  check('多一个 shift 不命中', bindingMatches(FULLSCREEN_BINDING, gesture('Enter', { alt: true, meta: true, shift: true })), false)
  check('少一个 alt 不命中', bindingMatches(FULLSCREEN_BINDING, gesture('Enter', { meta: true })), false)
  check('物理码不同不命中', bindingMatches(FULLSCREEN_BINDING, gesture('NumpadEnter', { alt: true, meta: true })), false)
  check('双键和弦不命中', bindingMatches({ code: 'KeyK', secondCode: 'KeyS', modifiers: ['meta'] }, gesture('KeyK', { meta: true })), false)
  check(
    '手势带 secondCode 不命中',
    bindingMatches(FULLSCREEN_BINDING, gesture('Enter', { alt: true, meta: true, secondCode: 'KeyS' })),
    false,
  )
}

console.log('--- A② 生效绑定:未绑 / 被系统拒绝 / 冲突都不算掌权 ---')
{
  const rows = [row('pane.fullscreen.toggle', FULLSCREEN_BINDING)]
  check('正常行', enabledBinding(rows, 'pane.fullscreen.toggle'), FULLSCREEN_BINDING)
  check('解绑(null)', enabledBinding([row('pane.fullscreen.toggle', null)], 'pane.fullscreen.toggle'), undefined)
  check('被保留键拒绝', enabledBinding([row('pane.fullscreen.toggle', FULLSCREEN_BINDING, { issue: 'reserved' })], 'pane.fullscreen.toggle'), undefined)
  check('冲突中', enabledBinding([row('pane.fullscreen.toggle', FULLSCREEN_BINDING, { conflicts: ['x.y'] })], 'pane.fullscreen.toggle'), undefined)
  check('未注册', enabledBinding(rows, 'pane.split'), undefined)
}

console.log('--- A③ 分屏键的归属 ---')
{
  const rows = [row('pane.split', SPLIT_BINDING)]
  checkTrue('⌘\\ → 分屏', paneSplitFor(rows, SPLIT_PRESS))
  check('⌘⌥Enter 不再归分屏桥(全屏由固定行接管)', paneSplitFor(rows, FULLSCREEN_PRESS), false)
  check('无修饰 Enter → 无', paneSplitFor(rows, gesture('Enter')), false)
  const rebound = [row('pane.split', { code: 'KeyJ', modifiers: ['meta', 'shift'] })]
  check('改绑后新键命中', paneSplitFor(rebound, gesture('KeyJ', { meta: true, shift: true })), true)
  check('改绑后旧键落空', paneSplitFor(rebound, SPLIT_PRESS), false)
  check('解绑后落空', paneSplitFor([row('pane.split', null)], SPLIT_PRESS), false)
  check('冲突后落空', paneSplitFor([row('pane.split', SPLIT_BINDING, { conflicts: ['other.cmd'] })], SPLIT_PRESS), false)
}

finish()
