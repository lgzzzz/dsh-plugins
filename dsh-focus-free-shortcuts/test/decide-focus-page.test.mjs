/**
 * 聚焦右栏页面纯决策:固定行声明的逻辑组合(`primary+alt+K`,macOS 落成 `⌘⌥K`、
 * Windows/Linux 落成 `Ctrl+Alt+K`)、准入(任何区域都放行,含终端与已被消费的按),
 * 以及"行不在 / 右栏折叠 / 没有会话就不出手"。
 */
import { fixedRowOwns } from '../src/binding.ts'
import {
  FOCUS_PAGE_BINDING,
  FOCUS_PAGE_ID,
  focusPageCommand,
  focusPageEligible,
  focusPageTarget,
} from '../src/focus-page.ts'
import { check, checkTrue, fakePageSidebar, finish, gesture, shortcutContext, FOCUS_PAGE_FIXED_ROWS, FOCUS_PAGE_MAC_FIXED_ROWS, FOCUS_PAGE_MAC_PRESS, FOCUS_PAGE_PRESS, UNUSED_PRESS } from './helpers.mjs'

/** 只读固定行目录的假面:`focusPageTarget` 只读这一个读数。 */
const catalog = (rows) => ({ fixedCatalog: { getSnapshot: () => rows } })

console.log('--- N① 固定行本身:声明 primary+alt+K,键帽按平台落成,归 application 组 ---')
{
  const macos = focusPageCommand('macos')
  const windows = focusPageCommand('windows')
  check('固定行 id', macos.id, FOCUS_PAGE_ID)
  check('固定行组合', macos.bindings[0], FOCUS_PAGE_BINDING)
  check('macOS 显示键', macos.keys, ['⌘', '⌥', 'K'])
  check('Windows 显示键', windows.keys, ['Ctrl', 'Alt', 'K'])
  check('固定行分组', macos.group, 'application')
}

console.log('--- N② 固定行归属:各平台只认自己的那一组物理键 ---')
{
  checkTrue('Windows:Ctrl+Alt+K 命中', fixedRowOwns(FOCUS_PAGE_FIXED_ROWS, FOCUS_PAGE_ID, FOCUS_PAGE_PRESS))
  checkTrue('macOS:⌘⌥K 命中', fixedRowOwns(FOCUS_PAGE_MAC_FIXED_ROWS, FOCUS_PAGE_ID, FOCUS_PAGE_MAC_PRESS))
  check('macOS:Ctrl+Alt+K 不命中(那是 Windows 的键)', fixedRowOwns(FOCUS_PAGE_MAC_FIXED_ROWS, FOCUS_PAGE_ID, FOCUS_PAGE_PRESS), false)
  check('Windows:⌘⌥K 不命中(那是 macOS 的键)', fixedRowOwns(FOCUS_PAGE_FIXED_ROWS, FOCUS_PAGE_ID, FOCUS_PAGE_MAC_PRESS), false)
  check('裸 K 不命中', fixedRowOwns(FOCUS_PAGE_FIXED_ROWS, FOCUS_PAGE_ID, gesture('KeyK')), false)
  check('Ctrl+K 不命中', fixedRowOwns(FOCUS_PAGE_FIXED_ROWS, FOCUS_PAGE_ID, gesture('KeyK', { control: true })), false)
  check('Alt+K 不命中', fixedRowOwns(FOCUS_PAGE_FIXED_ROWS, FOCUS_PAGE_ID, gesture('KeyK', { alt: true })), false)
  check('Ctrl+Alt+Shift+K 不命中', fixedRowOwns(FOCUS_PAGE_FIXED_ROWS, FOCUS_PAGE_ID, gesture('KeyK', { control: true, alt: true, shift: true })), false)
  check('⌘⌥⇧K 不命中', fixedRowOwns(FOCUS_PAGE_MAC_FIXED_ROWS, FOCUS_PAGE_ID, gesture('KeyK', { meta: true, alt: true, shift: true })), false)
  check('别的键不命中', fixedRowOwns(FOCUS_PAGE_FIXED_ROWS, FOCUS_PAGE_ID, gesture('Enter')), false)
  check('行未挂载不命中', fixedRowOwns([], FOCUS_PAGE_ID, FOCUS_PAGE_PRESS), false)
}

console.log('--- N③ 准入:page / 文本控件 / 终端 / 已被消费都准入,模态 / repeat / 组字否决 ---')
{
  checkTrue('page 上准入', focusPageEligible(FOCUS_PAGE_PRESS, shortcutContext()))
  checkTrue('文本控件内准入(要离开的正是 composer)', focusPageEligible(FOCUS_PAGE_PRESS, shortcutContext({ region: 'editable' })))
  checkTrue('终端内准入(交棒是无操作,但这一按不该漏进 shell)', focusPageEligible(FOCUS_PAGE_PRESS, shortcutContext({ region: 'terminal' })))
  checkTrue('已被消费仍准入(与页面切换键同一份准入)', focusPageEligible(gesture('KeyK', { control: true, alt: true, defaultPrevented: true }), shortcutContext()))
  check('模态层之上否决', focusPageEligible(FOCUS_PAGE_PRESS, shortcutContext({ modal: 'settings' })), false)
  check('repeat 否决', focusPageEligible(gesture('KeyK', { control: true, alt: true, repeat: true }), shortcutContext()), false)
  check('组字中否决', focusPageEligible(gesture('KeyK', { control: true, alt: true, composing: true }), shortcutContext()), false)
}

// 准入只负责"能不能出手",具体键归固定行管。
{
  check('别的键同样准入(是否动作由固定行决定)', focusPageEligible(gesture('Enter'), shortcutContext()), true)
}

console.log('--- N④ 交棒目标:行在 + 右栏展开 + 有会话才出手 ---')
{
  const rows = FOCUS_PAGE_FIXED_ROWS
  const windows = fakePageSidebar({ mounted: 's1' })
  const macos = fakePageSidebar({ mounted: 's1' })

  check('Windows:Ctrl+Alt+K → 交棒到屏幕会话', focusPageTarget(catalog(rows), windows, FOCUS_PAGE_PRESS, shortcutContext()), { sessionId: 's1' })
  check('macOS:⌘⌥K → 交棒到屏幕会话', focusPageTarget(catalog(FOCUS_PAGE_MAC_FIXED_ROWS), macos, FOCUS_PAGE_MAC_PRESS, shortcutContext()), { sessionId: 's1' })
  check('Windows 行不认 ⌘⌥K', focusPageTarget(catalog(rows), windows, FOCUS_PAGE_MAC_PRESS, shortcutContext()), undefined)
  check('文本控件内同样交棒(从 composer 抢键盘)', focusPageTarget(catalog(rows), windows, FOCUS_PAGE_PRESS, shortcutContext({ region: 'editable' })), { sessionId: 's1' })
  check('终端内同样交棒', focusPageTarget(catalog(rows), windows, FOCUS_PAGE_PRESS, shortcutContext({ region: 'terminal' })), { sessionId: 's1' })
}

console.log('--- N⑤ 让位:右栏折叠 / 没有会话 / 行未挂载 / 别的键 / 模态 ---')
{
  const rows = FOCUS_PAGE_FIXED_ROWS
  check('右栏折叠(没有当前显示的页)', focusPageTarget(catalog(rows), fakePageSidebar({ expanded: false }), FOCUS_PAGE_PRESS, shortcutContext()), undefined)
  check('没有会话', focusPageTarget(catalog(rows), fakePageSidebar({ mounted: null }), FOCUS_PAGE_PRESS, shortcutContext()), undefined)
  check('固定行未挂载', focusPageTarget(catalog([]), fakePageSidebar(), FOCUS_PAGE_PRESS, shortcutContext()), undefined)
  check('别的键', focusPageTarget(catalog(rows), fakePageSidebar(), UNUSED_PRESS, shortcutContext()), undefined)
  check('模态层之上', focusPageTarget(catalog(rows), fakePageSidebar(), FOCUS_PAGE_PRESS, shortcutContext({ modal: 'settings' })), undefined)
  check('长按重复', focusPageTarget(catalog(rows), fakePageSidebar(), gesture('KeyK', { control: true, alt: true, repeat: true }), shortcutContext()), undefined)
}

finish()
