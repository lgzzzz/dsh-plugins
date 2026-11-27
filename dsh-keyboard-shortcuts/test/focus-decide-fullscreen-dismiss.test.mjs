/**
 * 全屏关栏判定:准入逐项否决、右栏文本控件保留 Esc、DOM 面板标记读数(全屏 / 停靠 /
 * 折叠 / 隐藏会话 / 没有 document / 没有 querySelectorAll),以及接管判定要同时满足的
 * 准入、展开态与可见面板标记。
 */
import { check, checkTrue, FakeElement, fakeDocument, fakeSidebar, finish, gesture, shortcutContext } from './focus-helpers.mjs'
import {
  DISMISS_GRACE_MS, dismissalFollowUp, fullscreenDismissEligible, fullscreenDismissOwned, fullscreenSidebarShown,
  markFullscreenDismissed, recentlyDismissedFullscreenSidebar, resetFullscreenDismissed, sidebarOwnsTarget,
} from '../src/fullscreen-dismiss.ts'

/** 装一段假 document(判定函数只读这个全局),跑完还原。 */
function withDocument(root, run) {
  const previous = globalThis.document
  globalThis.document = fakeDocument({ root })
  try {
    run()
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

/** 一个右栏面板根节点:呈现方式与开合状态是落在同一元素上的两个标记。 */
function panel({ mode = 'fullscreen', open = true, sessionId = 's1' } = {}) {
  const app = new FakeElement('div', { 'data-app': '' })
  const root = app.append(new FakeElement('div', {
    'data-sidebar-right-session': sessionId,
    'data-sidebar-right-panel': mode,
    ...(open ? { 'data-sidebar-right-open': '' } : {}),
  }))
  return { app, root }
}

/** 右栏根节点里的一段普通内容(不是文本控件)。 */
function contentOf(root) {
  return root.append(new FakeElement('div'))
}

/** 一个会话的全屏右栏面板根节点(挂在给定容器下)。 */
function fullscreenPanel(parent, sessionId) {
  return parent.append(new FakeElement('div', {
    'data-sidebar-right-session': sessionId,
    'data-sidebar-right-panel': 'fullscreen',
    'data-sidebar-right-open': '',
  }))
}

/**
 * 一段假 DOM:非当前会话的整棵视图带隐藏标记,里面仍留着那份全屏右栏面板。
 * @param attributes - 会话外层的隐藏标记(`hidden` 或 `aria-hidden="true"`)。
 */
function hiddenColumn(attributes) {
  const app = new FakeElement('div', { 'data-app': '' })
  const session = app.append(new FakeElement('div', { 'data-sidebar-right-session': 's2', ...attributes }))
  fullscreenPanel(session, 's2')
  return app
}

/** 同一份 document 里既有隐藏会话的面板、也有当前会话的面板;`hiddenFirst` 控制先后。 */
function mixedColumn({ hiddenFirst = true } = {}) {
  const app = new FakeElement('div', { 'data-app': '' })
  const addHidden = () => {
    const session = app.append(new FakeElement('div', { 'data-sidebar-right-session': 's2', hidden: '' }))
    fullscreenPanel(session, 's2')
  }
  const addVisible = () => fullscreenPanel(app, 's1')
  if (hiddenFirst) {
    addHidden()
    addVisible()
  } else {
    addVisible()
    addHidden()
  }
  return app
}

console.log('--- Y① 准入:裸 Esc 通过,其余逐项否决 ---')
{
  const { root } = panel()
  const inside = contentOf(root)
  checkTrue('裸 Esc 通过', fullscreenDismissEligible(gesture('Escape'), shortcutContext({ target: inside })))
  check('带 Ctrl 否决', fullscreenDismissEligible(gesture('Escape', { control: true }), shortcutContext()), false)
  check('带 Alt 否决', fullscreenDismissEligible(gesture('Escape', { alt: true }), shortcutContext()), false)
  check('带 Shift 否决', fullscreenDismissEligible(gesture('Escape', { shift: true }), shortcutContext()), false)
  check('带 Meta 否决', fullscreenDismissEligible(gesture('Escape', { meta: true }), shortcutContext()), false)
  check('长按重复否决', fullscreenDismissEligible(gesture('Escape', { repeat: true }), shortcutContext()), false)
  check('组字中否决', fullscreenDismissEligible(gesture('Escape', { composing: true }), shortcutContext()), false)
  check('已被消费否决', fullscreenDismissEligible(gesture('Escape', { defaultPrevented: true }), shortcutContext()), false)
  check('模态层之上否决', fullscreenDismissEligible(gesture('Escape'), shortcutContext({ modal: 'settings' })), false)
  check('终端内否决', fullscreenDismissEligible(gesture('Escape'), shortcutContext({ region: 'terminal' })), false)
  check('别的键否决', fullscreenDismissEligible(gesture('Enter'), shortcutContext()), false)
}

console.log('--- Y② 归属:只有右栏自己的文本控件保留 Esc ---')
{
  const { app, root } = panel()
  const rename = root.append(new FakeElement('input'))
  const composer = app.append(new FakeElement('textarea'))
  check('文本控件在右栏内:否决', fullscreenDismissEligible(gesture('Escape'), shortcutContext({ region: 'editable', target: rename })), false)
  checkTrue('文本控件在右栏外:通过', fullscreenDismissEligible(gesture('Escape'), shortcutContext({ region: 'editable', target: composer })))
  checkTrue('页面区域在右栏内:通过(只有 editable 看归属)', fullscreenDismissEligible(gesture('Escape'), shortcutContext({ region: 'page', target: root })))
  checkTrue('sidebarOwnsTarget 认面板根', sidebarOwnsTarget(root))
  checkTrue('sidebarOwnsTarget 认面板内的控件', sidebarOwnsTarget(rename))
  check('sidebarOwnsTarget 不认右栏外', sidebarOwnsTarget(composer), false)
  check('sidebarOwnsTarget 不认 null', sidebarOwnsTarget(null), false)
  check('sidebarOwnsTarget 不认没有 closest 的裸对象', sidebarOwnsTarget({}), false)
}

console.log('--- Y③ 面板标记:只有「全屏 + 已展开」算数 ---')
{
  withDocument(panel().app, () => {
    checkTrue('全屏 + 展开', fullscreenSidebarShown())
  })
  withDocument(panel({ mode: 'push' }).app, () => {
    check('停靠呈现不算', fullscreenSidebarShown(), false)
  })
  withDocument(panel({ open: false }).app, () => {
    check('折叠态不算', fullscreenSidebarShown(), false)
  })
  withDocument(new FakeElement('div', { 'data-app': '' }), () => {
    check('没有面板不算', fullscreenSidebarShown(), false)
  })
  const previous = globalThis.document
  delete globalThis.document
  try {
    check('没有 document 不算', fullscreenSidebarShown(), false)
  } finally {
    globalThis.document = previous
  }
}

console.log('--- Y④ 接管:准入、服务面展开态、面板标记三者同时成立 ---')
{
  const { app, root } = panel()
  const inside = contentOf(root)
  const rename = root.append(new FakeElement('input'))
  withDocument(app, () => {
    const sidebar = fakeSidebar()
    checkTrue('全屏 + 展开:接管', fullscreenDismissOwned(sidebar, gesture('Escape'), shortcutContext({ target: inside })))
    sidebar.expanded = false
    check('服务面已折叠:不接管(免得把折叠翻成展开)', fullscreenDismissOwned(sidebar, gesture('Escape'), shortcutContext({ target: inside })), false)
    sidebar.expanded = true
    check('带修饰键:不接管', fullscreenDismissOwned(sidebar, gesture('Escape', { meta: true }), shortcutContext({ target: inside })), false)
    check('文本控件在右栏内:不接管', fullscreenDismissOwned(sidebar, gesture('Escape'), shortcutContext({ region: 'editable', target: rename })), false)
  })
  withDocument(panel({ mode: 'push' }).app, () => {
    check('停靠呈现:不接管', fullscreenDismissOwned(fakeSidebar(), gesture('Escape'), shortcutContext()), false)
  })
}

console.log('--- Y⑤ 隐藏会话遗留的全屏面板不算可见 ---')
{
  // 非当前会话的整棵视图带 hidden / aria-hidden="true",里面那份全屏面板的标记仍在 DOM 里。
  // 旧实现只读第一个匹配(querySelector),会把这个遗留面板当成当前可见的浮层。
  withDocument(hiddenColumn({ hidden: '' }), () => {
    check('只有 hidden 会话里的全屏面板:不算可见', fullscreenSidebarShown(), false)
  })
  withDocument(hiddenColumn({ 'aria-hidden': 'true' }), () => {
    check('只有 aria-hidden 会话里的全屏面板:不算可见', fullscreenSidebarShown(), false)
  })

  // 隐藏面板与当前会话的可见全屏面板同时存在:至少一个可见就算可见;隐藏面板排在前面时,
  // 旧实现只读第一个匹配会误判为"隐藏",新实现要遍历全部匹配。
  withDocument(mixedColumn({ hiddenFirst: true }), () => {
    checkTrue('隐藏面板之后有当前会话的全屏面板:可见', fullscreenSidebarShown())
  })
  withDocument(mixedColumn({ hiddenFirst: false }), () => {
    checkTrue('当前会话的全屏面板之后另有隐藏面板:仍可见', fullscreenSidebarShown())
  })
}

console.log('--- Y⑥ 极简 document:没有 querySelectorAll / closest 也不抛 ---')
{
  const previous = globalThis.document
  try {
    globalThis.document = { querySelector: () => ({}) }
    checkTrue('没有 querySelectorAll 时退回 querySelector;元素没有 closest 按可见', fullscreenSidebarShown())

    globalThis.document = { querySelector: () => null }
    check('退回 querySelector 且没有面板:不算可见', fullscreenSidebarShown(), false)

    globalThis.document = { querySelectorAll: () => [{}, {}] }
    checkTrue('没有 closest 的多个匹配按可见', fullscreenSidebarShown())
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

console.log('--- Y⑦ 关栏宽限:时刻推进与裸 Esc 判定 ---')
{
  resetFullscreenDismissed()
  check('没有关栏记录:不算宽限', recentlyDismissedFullscreenSidebar(1000), false)
  check('没有关栏记录:裸 Esc 也不追吞', dismissalFollowUp(gesture('Escape')), false)

  markFullscreenDismissed(1000)
  checkTrue('刚关栏:算宽限', recentlyDismissedFullscreenSidebar(1000))
  checkTrue('宽限内(末尾前一毫秒):算宽限', recentlyDismissedFullscreenSidebar(1000 + DISMISS_GRACE_MS - 1))
  check('宽限到期:不算宽限', recentlyDismissedFullscreenSidebar(1000 + DISMISS_GRACE_MS), false)
  check('时钟回拨到关栏之前:不算宽限', recentlyDismissedFullscreenSidebar(999), false)

  // 归关栏的那一按用当前时钟判定。
  markFullscreenDismissed(performance.now())
  checkTrue('宽限内裸 Esc:继续归关栏', dismissalFollowUp(gesture('Escape')))
  check('宽限内带 Ctrl 的 Esc:不是关栏那一按', dismissalFollowUp(gesture('Escape', { control: true })), false)
  check('宽限内带 Meta 的 Esc:不是关栏那一按', dismissalFollowUp(gesture('Escape', { meta: true })), false)
  check('宽限内组字中的 Esc:留给输入法', dismissalFollowUp(gesture('Escape', { composing: true })), false)
  check('宽限内 Enter:不受影响', dismissalFollowUp(gesture('Enter')), false)

  markFullscreenDismissed(performance.now() - 1000)
  check('宽限过后裸 Esc:不再归关栏', dismissalFollowUp(gesture('Escape')), false)

  resetFullscreenDismissed()
  check('复位后:不算宽限', recentlyDismissedFullscreenSidebar(1000), false)
}

finish()
