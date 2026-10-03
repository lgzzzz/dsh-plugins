/**
 * 聚焦输入框纯决策:固定行预约的物理组合(`Ctrl+Alt+J`)、无焦点准入,
 * 以及"行不在就不出手"。
 */
import { fixedRowOwns } from '../src/binding.ts'
import {
  FOCUS_COMPOSER_BINDING,
  FOCUS_COMPOSER_COMMAND,
  FOCUS_COMPOSER_ID,
  focusComposerEligible,
} from '../src/focus-composer.ts'
import { check, checkTrue, finish, gesture, shortcutContext, FOCUS_COMPOSER_FIXED_ROWS, FOCUS_COMPOSER_PRESS } from './helpers.mjs'

console.log('--- J① 固定行本身:预约 Ctrl+Alt+J,归 input 组 ---')
{
  check('固定行 id', FOCUS_COMPOSER_COMMAND.id, FOCUS_COMPOSER_ID)
  check('固定行组合', FOCUS_COMPOSER_COMMAND.bindings[0], FOCUS_COMPOSER_BINDING)
  check('固定行显示键', FOCUS_COMPOSER_COMMAND.keys, ['Ctrl', 'Alt', 'J'])
  check('固定行分组', FOCUS_COMPOSER_COMMAND.group, 'input')
}

console.log('--- J② 固定行归属:只有 Ctrl+Alt+J 命中 ---')
{
  checkTrue('Ctrl+Alt+J 命中', fixedRowOwns(FOCUS_COMPOSER_FIXED_ROWS, FOCUS_COMPOSER_ID, FOCUS_COMPOSER_PRESS))
  check('裸 J 不命中', fixedRowOwns(FOCUS_COMPOSER_FIXED_ROWS, FOCUS_COMPOSER_ID, gesture('KeyJ')), false)
  check('Ctrl+J 不命中', fixedRowOwns(FOCUS_COMPOSER_FIXED_ROWS, FOCUS_COMPOSER_ID, gesture('KeyJ', { control: true })), false)
  check('Alt+J 不命中', fixedRowOwns(FOCUS_COMPOSER_FIXED_ROWS, FOCUS_COMPOSER_ID, gesture('KeyJ', { alt: true })), false)
  check('Ctrl+Alt+Shift+J 不命中', fixedRowOwns(FOCUS_COMPOSER_FIXED_ROWS, FOCUS_COMPOSER_ID, gesture('KeyJ', { control: true, alt: true, shift: true })), false)
  check('别的键不命中', fixedRowOwns(FOCUS_COMPOSER_FIXED_ROWS, FOCUS_COMPOSER_ID, gesture('Enter')), false)
  check('行未挂载不命中', fixedRowOwns([], FOCUS_COMPOSER_ID, FOCUS_COMPOSER_PRESS), false)
}

console.log('--- J③ 无焦点准入:page 与文本控件都准入,模态 / 终端 / repeat / 组字 / 已消费否决 ---')
{
  checkTrue('page 上准入', focusComposerEligible(FOCUS_COMPOSER_PRESS, shortcutContext()))
  checkTrue('文本控件内也准入(这键就是来抢键盘的)', focusComposerEligible(FOCUS_COMPOSER_PRESS, shortcutContext({ region: 'editable' })))
  check('模态层之上否决', focusComposerEligible(FOCUS_COMPOSER_PRESS, shortcutContext({ modal: 'settings' })), false)
  check('终端内否决', focusComposerEligible(FOCUS_COMPOSER_PRESS, shortcutContext({ region: 'terminal' })), false)
  check('repeat 否决', focusComposerEligible(gesture('KeyJ', { control: true, alt: true, repeat: true }), shortcutContext()), false)
  check('组字中否决', focusComposerEligible(gesture('KeyJ', { control: true, alt: true, composing: true }), shortcutContext()), false)
  check('已被消费否决', focusComposerEligible(gesture('KeyJ', { control: true, alt: true, defaultPrevented: true }), shortcutContext()), false)
}

// 准入只负责"能不能出手",具体键归固定行管。
{
  check('别的键同样准入(是否动作由固定行决定)', focusComposerEligible(gesture('Enter'), shortcutContext()), true)
}

finish()