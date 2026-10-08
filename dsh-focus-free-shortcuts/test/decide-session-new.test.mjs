/**
 * 内置 `session.new` 终端桥的纯决策:命中当前生效键位,以及捕获路径的准入。
 *
 * 这不是本插件自己挂的固定行 —— `session.new` 是 Workspace browser 贡献的可配置命令,
 * 所以归属要看**生效目录**里那一行当前的绑定(行不在 / 解绑 / 有 issue / 冲突都不算),
 * 键位也就随时跟着用户改绑走。
 */
import { sessionNewEligible, sessionNewPress } from '../src/session-new.ts'
import {
  check,
  checkTrue,
  finish,
  gesture,
  row,
  shortcutContext,
  SESSION_NEW_BINDING,
  SESSION_NEW_ID,
  SESSION_NEW_MAC_BINDING,
  SESSION_NEW_MAC_PRESS,
  SESSION_NEW_PRESS,
  SESSION_NEW_ROWS,
  SESSION_NEW_MAC_ROWS,
} from './helpers.mjs'

console.log('--- U① 命中当前生效键位:各平台只认自己那一组 ---')
{
  checkTrue('Windows/Linux:Ctrl+Alt+N 命中', sessionNewPress(SESSION_NEW_ROWS, SESSION_NEW_PRESS))
  checkTrue('macOS:⌘⌥N 命中', sessionNewPress(SESSION_NEW_MAC_ROWS, SESSION_NEW_MAC_PRESS))
  check('macOS 上 Ctrl+Alt+N 不命中', sessionNewPress(SESSION_NEW_MAC_ROWS, SESSION_NEW_PRESS), false)
  check('Windows/Linux 上 ⌘⌥N 不命中', sessionNewPress(SESSION_NEW_ROWS, SESSION_NEW_MAC_PRESS), false)
  check('裸 N 不命中', sessionNewPress(SESSION_NEW_ROWS, gesture('KeyN')), false)
  check('只有 Ctrl 不命中', sessionNewPress(SESSION_NEW_ROWS, gesture('KeyN', { control: true })), false)
  check('只有 Alt 不命中', sessionNewPress(SESSION_NEW_ROWS, gesture('KeyN', { alt: true })), false)
  check('多按 Shift 不命中', sessionNewPress(SESSION_NEW_ROWS, gesture('KeyN', { control: true, alt: true, shift: true })), false)
  check('别的键不命中', sessionNewPress(SESSION_NEW_ROWS, gesture('KeyM', { control: true, alt: true })), false)
  check('目录里没有这一行不命中', sessionNewPress([], SESSION_NEW_PRESS), false)
}

console.log('--- U② 键位跟随生效目录:解绑 / issue / 冲突 / 改绑都照单全收 ---')
{
  check('解绑(binding 为 null)不命中', sessionNewPress([row(SESSION_NEW_ID, null)], SESSION_NEW_PRESS), false)
  check('有 issue 不命中', sessionNewPress([row(SESSION_NEW_ID, SESSION_NEW_BINDING, { issue: 'reserved' })], SESSION_NEW_PRESS), false)
  check('存在冲突不命中', sessionNewPress([row(SESSION_NEW_ID, SESSION_NEW_BINDING, { conflicts: ['other.command'] })], SESSION_NEW_PRESS), false)
  const rebound = [row(SESSION_NEW_ID, { code: 'KeyN', modifiers: ['control', 'shift'] })]
  check('改绑后新键命中', sessionNewPress(rebound, gesture('KeyN', { control: true, shift: true })), true)
  check('改绑后旧键不再命中', sessionNewPress(rebound, SESSION_NEW_PRESS), false)
  const otherRow = [row('session.search', SESSION_NEW_BINDING)]
  check('只有别的命令占着这个键也不命中', sessionNewPress(otherRow, SESSION_NEW_PRESS), false)
}

console.log('--- U③ 捕获路径准入:终端放行,模态 / 长按 / 组字否决 ---')
{
  checkTrue('终端内准入(这条路径存在的理由)', sessionNewEligible(SESSION_NEW_PRESS, shortcutContext({ region: 'terminal' })))
  checkTrue('页面上的同一按也准入(纯判定不看区域)', sessionNewEligible(SESSION_NEW_PRESS, shortcutContext()))
  checkTrue('文本控件内也准入', sessionNewEligible(SESSION_NEW_PRESS, shortcutContext({ region: 'editable' })))
  check('模态层之上否决', sessionNewEligible(SESSION_NEW_PRESS, shortcutContext({ modal: 'settings' })), false)
  check('长按重复否决', sessionNewEligible(gesture('KeyN', { control: true, alt: true, repeat: true }), shortcutContext({ region: 'terminal' })), false)
  check('组字中否决', sessionNewEligible(gesture('KeyN', { control: true, alt: true, composing: true }), shortcutContext({ region: 'terminal' })), false)
}

finish()
