/**
 * 绑定纯函数:修饰键归一、绑定匹配、生效绑定(解绑 / 保留 / 冲突 / 缺席),
 * 以及"谁是这一按的 owner"。
 */
import { bindingMatches, enabledBinding, modifiersOf } from '../src/binding.ts'
import { paneActionFor } from '../src/pane-keys.ts'
import { check, checkTrue, finish, FULLSCREEN_BINDING, FULLSCREEN_PRESS, gesture, PANE_IDS, row, SPLIT_BINDING, SPLIT_PRESS } from './helpers.mjs'

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

console.log('--- A③ 谁是这一按的owner ---')
{
  const rows = [row('pane.fullscreen.toggle', FULLSCREEN_BINDING), row('pane.split', SPLIT_BINDING)]
  check('⌘⌥Enter → 全屏', paneActionFor(rows, FULLSCREEN_PRESS, PANE_IDS), 'fullscreen')
  check('⌘\\ → 分屏', paneActionFor(rows, SPLIT_PRESS, PANE_IDS), 'split')
  check('无修饰 Enter → 无', paneActionFor(rows, gesture('Enter'), PANE_IDS), undefined)
  check('⌘Enter → 无', paneActionFor(rows, gesture('Enter', { meta: true }), PANE_IDS), undefined)
  const rebound = [row('pane.fullscreen.toggle', { code: 'KeyJ', modifiers: ['meta', 'shift'] })]
  check('改绑后新键命中', paneActionFor(rebound, gesture('KeyJ', { meta: true, shift: true }), PANE_IDS), 'fullscreen')
  check('改绑后旧键落空', paneActionFor(rebound, FULLSCREEN_PRESS, PANE_IDS), undefined)
  const unbound = [row('pane.fullscreen.toggle', null)]
  check('解绑后落空', paneActionFor(unbound, FULLSCREEN_PRESS, PANE_IDS), undefined)
  const conflicted = [row('pane.fullscreen.toggle', FULLSCREEN_BINDING, { conflicts: ['other.cmd'] })]
  check('冲突后落空', paneActionFor(conflicted, FULLSCREEN_PRESS, PANE_IDS), undefined)
}

finish()
