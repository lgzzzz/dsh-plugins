/**
 * B Escape 准入:`src/decide.ts` 的 `escapeEligible` 逐项否决 —— 裸 Escape
 * 才准入,repeat / composing / 已被消费 / 任何修饰键 / 模态 / 终端区都被挡下。
 *
 * 运行:`node test/decide-escape.test.mjs`(或 pnpm test 跑全部)。
 */
import { escapeEligible } from '../src/decide.ts'
import { check, checkTrue, finish, gesture, shortcutContext } from './helpers.mjs'

console.log('--- B① 裸 Escape 的准入与逐项否决 ---')
{
  const base = gesture('Escape')
  checkTrue('裸 Escape 准入', escapeEligible(base, shortcutContext()))
  check('repeat 否决', escapeEligible(gesture('Escape', { repeat: true }), shortcutContext()), false)
  check('composing 否决', escapeEligible(gesture('Escape', { composing: true }), shortcutContext()), false)
  check('已被消费否决', escapeEligible(gesture('Escape', { defaultPrevented: true }), shortcutContext()), false)
  check('control 否决', escapeEligible(gesture('Escape', { control: true }), shortcutContext()), false)
  check('alt 否决', escapeEligible(gesture('Escape', { alt: true }), shortcutContext()), false)
  check('shift 否决', escapeEligible(gesture('Escape', { shift: true }), shortcutContext()), false)
  check('meta 否决', escapeEligible(gesture('Escape', { meta: true }), shortcutContext()), false)
  check('模态中否决', escapeEligible(base, shortcutContext({ modal: 'settings' })), false)
  check('终端区否决', escapeEligible(base, shortcutContext({ region: 'terminal' })), false)
  check('editable 区允许', escapeEligible(base, shortcutContext({ region: 'editable' })), true)
  check('别的物理码否决', escapeEligible(gesture('Backspace'), shortcutContext()), false)
}

finish()
