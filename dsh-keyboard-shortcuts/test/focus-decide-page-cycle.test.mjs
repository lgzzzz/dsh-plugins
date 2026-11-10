/**
 * 页面循环纯决策:固定行同时预约逻辑组合 `primary+alt+←` / `primary+alt+→`(macOS 落成
 * `⌘⌥←/→`,Windows/Linux 落成 `Ctrl+Alt+←/→`)、准入(放行终端与已被消费的按)、
 * 环状步进,以及展开补位对内置 `sidebar.right.toggle` 有效行的跟随。
 */
import {
  PAGE_CYCLE_ID,
  PAGE_NEXT_BINDING,
  PAGE_PREVIOUS_BINDING,
  expansionPress,
  pageCycleAction,
  pageCycleCommand,
  pageCycleEligible,
  pageStepFor,
  steppedPageId,
} from '../src/page-cycle.ts'
import { activateViewTab, displayedViewTabs, steppedViewTab } from '../src/view-cycle.ts'
import { check, checkTrue, fakeDocument, FakeElement, fakePageSidebar, finish, gesture, row, shortcutContext, PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_MAC_FIXED_ROWS, PAGE_NEXT_MAC_PRESS, PAGE_NEXT_PRESS, PAGE_PREVIOUS_MAC_PRESS, PAGE_PREVIOUS_PRESS, SIDEBAR_TOGGLE_BINDING, SIDEBAR_TOGGLE_PRESS } from './focus-helpers.mjs'

console.log('--- L① 固定行本身:一行预约两个方向,键帽按平台落成,归 application 组 ---')
{
  const macos = pageCycleCommand('macos')
  const windows = pageCycleCommand('windows')
  check('固定行 id', macos.id, PAGE_CYCLE_ID)
  check('← 绑定', macos.bindings[0], PAGE_PREVIOUS_BINDING)
  check('→ 绑定', macos.bindings[1], PAGE_NEXT_BINDING)
  check('macOS 显示键', macos.keys, ['⌘', '⌥', '←/→'])
  check('Windows 显示键', windows.keys, ['Ctrl', 'Alt', '←/→'])
  check('固定行分组', macos.group, 'application')
}

console.log('--- L② 固定行归属与方向:各平台只认自己那一对键,方向由命中的 code 决定 ---')
{
  check('Windows:← 命中为 previous', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, PAGE_PREVIOUS_PRESS), 'previous')
  check('Windows:→ 命中为 next', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, PAGE_NEXT_PRESS), 'next')
  check('macOS:← 命中为 previous', pageStepFor(PAGE_CYCLE_MAC_FIXED_ROWS, PAGE_CYCLE_ID, PAGE_PREVIOUS_MAC_PRESS), 'previous')
  check('macOS:→ 命中为 next', pageStepFor(PAGE_CYCLE_MAC_FIXED_ROWS, PAGE_CYCLE_ID, PAGE_NEXT_MAC_PRESS), 'next')
  check('macOS:Ctrl+Alt+← 不命中(那是 Windows 的键)', pageStepFor(PAGE_CYCLE_MAC_FIXED_ROWS, PAGE_CYCLE_ID, PAGE_PREVIOUS_PRESS), undefined)
  check('裸 ← 不命中', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, gesture('ArrowLeft')), undefined)
  check('Ctrl+← 不命中', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, gesture('ArrowLeft', { control: true })), undefined)
  check('Alt+← 不命中', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, gesture('ArrowLeft', { alt: true })), undefined)
  check('Ctrl+Alt+Shift+← 不命中', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, gesture('ArrowLeft', { control: true, alt: true, shift: true })), undefined)
  check('⌘⌥⇧← 不命中', pageStepFor(PAGE_CYCLE_MAC_FIXED_ROWS, PAGE_CYCLE_ID, gesture('ArrowLeft', { meta: true, alt: true, shift: true })), undefined)
  check('别的键不命中', pageStepFor(PAGE_CYCLE_FIXED_ROWS, PAGE_CYCLE_ID, gesture('Enter')), undefined)
  check('行未挂载不命中', pageStepFor([], PAGE_CYCLE_ID, PAGE_NEXT_PRESS), undefined)
}

console.log('--- L③ 准入:页 / 文本控件 / 终端 / 已被消费都准入,模态 / repeat / 组字否决 ---')
{
  checkTrue('page 上准入', pageCycleEligible(PAGE_NEXT_PRESS, shortcutContext()))
  checkTrue('文本控件内准入(要离开的正是页面自身)', pageCycleEligible(PAGE_NEXT_PRESS, shortcutContext({ region: 'editable' })))
  checkTrue('终端内准入(核心:焦点在终端里依然能切页)', pageCycleEligible(PAGE_NEXT_PRESS, shortcutContext({ region: 'terminal' })))
  checkTrue('已被消费仍准入(终端等本地控件先处理也不算数)', pageCycleEligible(gesture('ArrowLeft', { control: true, alt: true, defaultPrevented: true }), shortcutContext()))
  check('模态层之上否决', pageCycleEligible(PAGE_NEXT_PRESS, shortcutContext({ modal: 'settings' })), false)
  check('repeat 否决', pageCycleEligible(gesture('ArrowLeft', { control: true, alt: true, repeat: true }), shortcutContext()), false)
  check('组字中否决', pageCycleEligible(gesture('ArrowLeft', { control: true, alt: true, composing: true }), shortcutContext()), false)
}

// 准入只负责"能不能出手",具体键归固定行管。
{
  check('别的键同样准入(是否动作由固定行决定)', pageCycleEligible(gesture('Enter'), shortcutContext()), true)
}

console.log('--- L④ 环状步进:回头绕到末尾,到头绕回开头 ---')
{
  const pages = ['t1', 't2', 't3']
  check('3 页向前走一步', steppedPageId(pages, 't1', 'next'), 't2')
  check('3 页向后走一步', steppedPageId(pages, 't2', 'previous'), 't1')
  check('末尾向前绕回开头', steppedPageId(pages, 't3', 'next'), 't1')
  check('开头向后绕到末尾', steppedPageId(pages, 't1', 'previous'), 't3')
  check('2 页双向', steppedPageId(['a', 'b'], 'a', 'next'), 'b')
  check('2 页反向', steppedPageId(['a', 'b'], 'a', 'previous'), 'b')

  const one = ['only']
  check('单页无可切', steppedPageId(one, 'only', 'next'), undefined)
  check('空列表无可切', steppedPageId([], undefined, 'next'), undefined)
  check('当前页不在列表不切', steppedPageId(pages, 'ghost', 'next'), undefined)
  check('没有当前页不切', steppedPageId(pages, undefined, 'next'), undefined)
}

console.log('--- L⑤ 展开补位判定:跟随内置 sidebar.right.toggle 的当前有效行 ---')
{
  const rows = [row('sidebar.right.toggle', SIDEBAR_TOGGLE_BINDING)]
  checkTrue('有效行命中', expansionPress(rows, SIDEBAR_TOGGLE_PRESS, shortcutContext()))
  check('别的键不命中', expansionPress(rows, gesture('KeyB'), shortcutContext()), false)
  check('少一个修饰不命中', expansionPress(rows, gesture('KeyB', { control: true }), shortcutContext()), false)
  check('模态否决', expansionPress(rows, SIDEBAR_TOGGLE_PRESS, shortcutContext({ modal: 'settings' })), false)
  check('repeat 否决', expansionPress(rows, gesture('KeyB', { control: true, shift: true, repeat: true }), shortcutContext()), false)
  check('组字中否决', expansionPress(rows, gesture('KeyB', { control: true, shift: true, composing: true }), shortcutContext()), false)
  check('行未注册不命中', expansionPress([], SIDEBAR_TOGGLE_PRESS, shortcutContext()), false)
  check('解绑不命中', expansionPress([row('sidebar.right.toggle', null)], SIDEBAR_TOGGLE_PRESS, shortcutContext()), false)
  check('冲突不命中', expansionPress([row('sidebar.right.toggle', SIDEBAR_TOGGLE_BINDING, { conflicts: ['other'] })], SIDEBAR_TOGGLE_PRESS, shortcutContext()), false)
  check('改键后旧键不命中', expansionPress([row('sidebar.right.toggle', { code: 'Backquote', modifiers: ['control'] })], SIDEBAR_TOGGLE_PRESS, shortcutContext()), false)
  check('改键后新键命中', expansionPress([row('sidebar.right.toggle', { code: 'Backquote', modifiers: ['control'] })], gesture('Backquote', { control: true }), shortcutContext()), true)
}

console.log('--- L⑥ 右栏折叠时改切会话视图:读当前渲染出来的页签,环状步进 ---')
{
  /** 一份页签读数:第 `active` 颗是当前视图;`element` 只作为点击目标。 */
  const tabsOf = (labels, active) => labels.map((label, index) => ({
    index,
    label,
    active: index === active,
    element: createTab(),
  }))
  /** 页签按钮假元素:记录 `click()`。 */
  const createTab = () => {
    const element = new FakeElement('button', { role: 'tab' })
    return element
  }

  const pair = tabsOf(['对话', '轨迹'], 0)
  check('next 落到未选中的那一颗', steppedViewTab(pair, 'next'), pair[1])
  check('previous 从第 0 颗绕到末尾', steppedViewTab(pair, 'previous'), pair[1])

  const triple = tabsOf(['对话', '轨迹', '统计'], 1)
  check('3 颗向前走一步', steppedViewTab(triple, 'next'), triple[2])
  check('3 颗向后走一步', steppedViewTab(triple, 'previous'), triple[0])

  const last = tabsOf(['a', 'b', 'c'], 2)
  check('末尾向前绕回开头', steppedViewTab(last, 'next'), last[0])
  check('开头向后绕到末尾', steppedViewTab(tabsOf(['a', 'b', 'c'], 0), 'previous')?.label, 'c')
}

console.log('--- L⑦ 会话视图页签的让位:不足两颗 / 当前缺失时不动作或退回端点 ---')
{
  const one = [{ index: 0, label: '对话', active: true, element: new FakeElement('button', { role: 'tab' }) }]
  check('只有一颗页签无可切', steppedViewTab(one, 'next'), undefined)
  check('空候选无可切', steppedViewTab([], 'next'), undefined)

  const noActive = [
    { index: 0, label: '对话', active: false, element: new FakeElement('button', { role: 'tab' }) },
    { index: 1, label: '轨迹', active: false, element: new FakeElement('button', { role: 'tab' }) },
  ]
  check('当前页不在行里:next 落行首', steppedViewTab(noActive, 'next'), noActive[0])
  check('当前页不在行里:previous 落行尾', steppedViewTab(noActive, 'previous'), noActive[1])
}

console.log('--- L⑧ 页签行与点击:只取第一行、跳过右栏那行、点击与用户点页签同一动作 ---')
{
  const previous = globalThis.document
  try {
    /** 一行标签:role="tab" 的按钮,文案挂在子节点上(与上游 DOM 同形)。 */
    const rowOf = (labels, active) => {
      const list = new FakeElement('div', { 'data-conversation-tabs': '' })
      const buttons = labels.map((label, index) => {
        const button = list.append(new FakeElement('button', {
          role: 'tab',
          ...(index === active ? { 'aria-selected': 'true' } : {}),
        }))
        const text = button.append(new FakeElement('span'))
        text.textContent = label
        return button
      })
      return { list, buttons }
    }

    const main = rowOf(['对话', '轨迹'], 0)
    const rightbar = new FakeElement('div', { 'data-sidebar-right-session': 's1' })
    rightbar.append(rowOf(['对话', '轨迹'], 1).list)
    const root = new FakeElement('div', { 'data-app': '' })
    root.append(rightbar)
    root.append(main.list)
    globalThis.document = fakeDocument({ root })

    const displayed = displayedViewTabs()
    check('取主会话那一行(右栏那行跳过)', displayed.map((entry) => entry.label), ['对话', '轨迹'])
    check('选中读数来自 aria-selected', displayed.map((entry) => entry.active), [true, false])

    const next = steppedViewTab(displayed, 'next')
    check('next 是「轨迹」', next?.label, '轨迹')
    activateViewTab(next)
    check('点击落到「轨迹」按钮上', main.buttons.map((button) => button.clickCount), [0, 1])
    check('右栏那行一颗都没点', rightbar.querySelectorAll('[role="tab"]').map((button) => button.clickCount), [0, 0])

    globalThis.document = fakeDocument({ root: new FakeElement('div') })
    check('没有标签行时候选为空', displayedViewTabs(), [])

    delete globalThis.document
    check('没有 document 时候选为空', displayedViewTabs(), [])
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

console.log('--- L⑨ 分档:右栏展开切页、折叠切会话视图,一次按键只走一档 ---')
{
  const rowOf = (labels, active) => {
    const list = new FakeElement('div', { 'data-conversation-tabs': '' })
    labels.forEach((label, index) => {
      const button = list.append(new FakeElement('button', {
        role: 'tab',
        ...(index === active ? { 'aria-selected': 'true' } : {}),
      }))
      button.append(new FakeElement('span')).textContent = label
    })
    return list
  }
  const previous = globalThis.document
  try {
    const root = new FakeElement('div', { 'data-app': '' })
    root.append(rowOf(['对话', '轨迹'], 0))
    globalThis.document = fakeDocument({ root })

    const shortcuts = { fixedCatalog: { getSnapshot: () => PAGE_CYCLE_FIXED_ROWS } }
    const expanded = fakePageSidebar({ list: ['t1', 't2', 't3'], active: 't1' })
    const folded = fakePageSidebar({ list: ['t1', 't2', 't3'], active: 't1', expanded: false })

    const pageAction = pageCycleAction(shortcuts, expanded, PAGE_NEXT_PRESS, shortcutContext())
    check('展开:走切页', pageAction?.kind, 'page')
    check('展开:目标是下一页', pageAction?.kind === 'page' ? pageAction.target.nextId : undefined, 't2')

    const viewAction = pageCycleAction(shortcuts, folded, PAGE_NEXT_PRESS, shortcutContext())
    check('折叠:走会话视图', viewAction?.kind, 'view')
    check('折叠:方向随键', viewAction?.kind === 'view' ? viewAction.step : undefined, 'next')
    check('折叠:目标是「轨迹」', viewAction?.kind === 'view' ? viewAction.tab.label : undefined, '轨迹')
    check('折叠:不切右栏页', folded.focusCalls, [])

    // 折叠 + 只有一颗页签:没有可切的目标,这一按不消费、原样放行。
    globalThis.document = fakeDocument({ root: new FakeElement('div') })
    check('折叠但没有任何页签:不动作', pageCycleAction(shortcuts, folded, PAGE_NEXT_PRESS, shortcutContext()), undefined)
    check('折叠但不命中本行键:不动作', pageCycleAction(shortcuts, folded, gesture('KeyY'), shortcutContext()), undefined)
    check('折叠但模态打开:不动作', pageCycleAction(shortcuts, folded, PAGE_NEXT_PRESS, shortcutContext({ modal: 'settings' })), undefined)

    // 展开但右栏只有一页:切页那一档让位,不回落到会话视图。
    globalThis.document = fakeDocument({ root })
    check('展开但只有一页:不动作', pageCycleAction(shortcuts, fakePageSidebar({ list: ['t1'], active: 't1' }), PAGE_NEXT_PRESS, shortcutContext()), undefined)
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

finish()