/**
 * 全屏关栏判定:准入逐项否决、右栏文本控件保留 Esc、DOM 面板标记读数(全屏 / 停靠 /
 * 折叠 / 没有 document),以及接管判定要同时满足的准入、展开态与面板标记。
 */
import { check, checkTrue, FakeElement, fakeDocument, fakeSidebar, finish, gesture, shortcutContext } from './helpers.mjs'
import { fullscreenDismissEligible, fullscreenDismissOwned, fullscreenSidebarShown, sidebarOwnsTarget } from '../src/fullscreen-dismiss.ts'

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

finish()
