/**
 * 行为测试：标题左键 → 本地变更，文件行左键 → 上游，右键 → 本轮快照 diff 菜单，
 * 以及各类失败路径都收敛为「不动作」。
 *
 * 运行：`node test/card.test.mjs`（或 pnpm test 跑全部）。
 * 直接 import `src/install.ts`（Node 22+ Type Stripping）。
 */
import {
  CARD_SELECTOR,
  LOCAL_CHANGES_PREFIX,
  MARKER_ATTRIBUTE,
  MENU_ACTION_ID,
  MENU_TARGET,
  TOGGLE_ATTRIBUTE,
  headerButton,
  installCardBehavior,
  localChangesAddress,
  menuButton,
} from '../src/card.ts'
import { en, NS, zh } from '../src/locales.ts'
import {
  FakeDocument,
  FakeElement,
  attachClickHandler,
  attachSidebarPanel,
  check,
  checkTrue,
  fakeLocale,
  fakeMenus,
  fakeSidebar,
  fakeTabs,
  finish,
  pointerEvent,
} from './card-helpers.mjs'

/** 一张多文件卡片：标题、一行文件、折叠按钮。 */
function multiCard() {
  const card = new FakeElement('div', { 'data-changed-files': '' })
  const header = card.append(new FakeElement('button'))
  header.append(new FakeElement('span'))
  const list = card.append(new FakeElement('ul'))
  const row = list.append(new FakeElement('li'))
  const rowButton = row.append(new FakeElement('button', { 'aria-describedby': 'p-0' }))
  const rowText = rowButton.append(new FakeElement('span'))
  const toggle = card.append(new FakeElement('button', { [TOGGLE_ATTRIBUTE]: 'false' }))
  return { card, header, row, rowButton, rowText, toggle }
}

/** 一张单文件卡片：标题就是唯一一行，带 aria-describedby 与 data-single。 */
function singleCard() {
  const card = new FakeElement('div', { 'data-changed-files': '', 'data-single': '' })
  const header = card.append(new FakeElement('button', { 'aria-describedby': 'p' }))
  const text = header.append(new FakeElement('span'))
  return { card, header, text }
}

/** 装配一次安装；默认带齐四个服务。 */
function setup({ sessionId = 'session-1', signedOut = false, claimable = true, sidebarFail = false, withMenus = true, locale, sidebar: sidebarOptions = {} } = {}) {
  const doc = new FakeDocument()
  const sidebar = fakeSidebar({ sessionId, signedOut, fail: sidebarFail, ...sidebarOptions })
  const tabs = fakeTabs({ claimable })
  const menus = fakeMenus()
  const services = { sidebarRight: sidebar, sidebarRightTabs: tabs }
  if (withMenus) services.contextMenus = menus
  if (locale !== undefined) services.locale = locale
  const warns = []
  const ctx = { get: (name) => services[name] }
  const dispose = installCardBehavior(ctx, { warn: (message) => warns.push(message) }, doc)
  return { doc, sidebar, tabs, menus, warns, dispose }
}

console.log('--- V① 多文件卡片：点标题打开本地变更，并阻止上游打开审查页 ---')
{
  const { doc, sidebar, tabs } = setup()
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  const expected = 'dsh-resource://forge-changes/session-1/local'
  check('打开地址', sidebar.opened, [expected])
  check('地址符合本地变更前缀', expected.startsWith(LOCAL_CHANGES_PREFIX), true)
  check('先确认类型能认领', tabs.claimed, [expected])
  check('阻止冒泡（React 收不到）', event.stopped, 1)
  check('不干涉浏览器默认行为', event.prevented, 0)
}

console.log('--- V② 单文件卡片：标题同样打开本地变更 ---')
{
  const { doc, sidebar } = setup()
  const { text } = singleCard()
  const event = pointerEvent(text)
  doc.dispatch('click', event)
  check('打开本地变更', sidebar.opened, ['dsh-resource://forge-changes/session-1/local'])
  check('阻止冒泡', event.stopped, 1)
}

console.log('--- V③ 文件行：不处理，保持上游的本轮文件 diff ---')
{
  const { doc, sidebar, tabs } = setup()
  const { rowText } = multiCard()
  const event = pointerEvent(rowText)
  doc.dispatch('click', event)
  check('不打开本地变更', sidebar.opened, [])
  check('不认领地址', tabs.claimed, [])
  check('不阻止冒泡', event.stopped, 0)
}

console.log('--- V④ 展开全部文件：不处理 ---')
{
  const { doc, sidebar } = setup()
  const { toggle } = multiCard()
  const event = pointerEvent(toggle)
  doc.dispatch('click', event)
  check('不打开本地变更', sidebar.opened, [])
  check('不阻止冒泡', event.stopped, 0)
}

console.log('--- V⑤ 卡片外点击：不处理 ---')
{
  const { doc, sidebar } = setup()
  const outside = new FakeElement('button')
  const event = pointerEvent(outside)
  doc.dispatch('click', event)
  check('不打开本地变更', sidebar.opened, [])
  check('不阻止冒泡', event.stopped, 0)
}

console.log('--- V⑥ 修饰键点击：放行上游（逃生口） ---')
{
  for (const key of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
    const { doc, sidebar } = setup()
    const { header } = multiCard()
    const event = pointerEvent(header, { [key]: true })
    doc.dispatch('click', event)
    check(`${key} 点击不接管`, [sidebar.opened, event.stopped], [[], 0])
  }
}

console.log('--- V⑦ 没有屏幕上的会话：不动作 ---')
{
  const { doc, sidebar } = setup({ signedOut: true })
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('不打开本地变更', sidebar.opened, [])
  check('不阻止冒泡', event.stopped, 0)
}

console.log('--- V⑧ 本地变更类型没注册：放行上游 ---')
{
  const { doc, sidebar, warns } = setup({ claimable: false })
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('不打开本地变更', sidebar.opened, [])
  check('不阻止冒泡', event.stopped, 0)
  check('不告警（这是合法的缺席）', warns, [])
}

console.log('--- V⑨ 打开失败：不吞点击，只告警 ---')
{
  const { doc, sidebar, warns } = setup({ sidebarFail: true })
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('没有打开成功', sidebar.opened, [])
  check('不阻止冒泡（留给上游）', event.stopped, 0)
  check('记录一条告警', warns.length, 1)
}

console.log('--- V⑩ 右键文件行：宿主菜单里一条「查看本轮快照 diff」，执行回到上游 onClick ---')
{
  const locale = fakeLocale()
  const { doc, menus, sidebar } = setup({ locale })
  const { rowText, rowButton } = multiCard()
  let opened = 0
  attachClickHandler(rowButton, () => { opened += 1 })
  const event = pointerEvent(rowText, { clientX: 10, clientY: 20 })
  doc.dispatch('contextmenu', event)
  check('弹出宿主菜单一次', menus.opened.length, 1)
  check('目标种类是本插件自己的', menus.opened[0]?.target.kind, MENU_TARGET)
  check('菜单落点是指针坐标', menus.opened[0]?.point, { x: 10, y: 20 })
  check('阻止浏览器原生菜单', event.prevented, 1)
  check('阻止冒泡', event.stopped, 1)
  check('不打开本地变更', sidebar.opened, [])

  const contributions = menus.registered[0]
  check('注册了本插件的菜单贡献', contributions?.target, MENU_TARGET)
  const signal = new AbortController().signal
  const actions = contributions.resolve({ kind: MENU_TARGET, value: {} }, signal)
  check('解析出一条动作', actions.length, 1)
  check('动作 id', actions[0]?.id, MENU_ACTION_ID)
  check('动作文案（中文）', actions[0]?.label, zh.openSnapshot)
  check('执行前没有打开审查页', opened, 0)
  actions[0].run()
  check('执行后调用上游 onClick 一次', opened, 1)
  const after = contributions.resolve({ kind: MENU_TARGET, value: {} }, signal)
  check('同一次右键只消费一次', after, [])
}

console.log('--- V⑪ 右键标题：同样可用 ---')
{
  const { doc, menus } = setup()
  const { header } = multiCard()
  let opened = 0
  attachClickHandler(header, () => { opened += 1 })
  const event = pointerEvent(header, { clientX: 3, clientY: 4 })
  doc.dispatch('contextmenu', event)
  check('弹出宿主菜单一次', menus.opened.length, 1)
  const actions = menus.registered[0].resolve({}, new AbortController().signal)
  actions[0]?.run()
  check('执行后调用上游 onClick 一次', opened, 1)
}

console.log('--- V⑫ 读不到上游 onClick：不弹菜单，保留浏览器原生菜单 ---')
{
  const { doc, menus } = setup()
  const { rowText } = multiCard()
  const event = pointerEvent(rowText, { clientX: 1, clientY: 2 })
  doc.dispatch('contextmenu', event)
  check('不弹宿主菜单', menus.opened, [])
  check('不阻止原生菜单', event.prevented, 0)
  check('不阻止冒泡', event.stopped, 0)
}

console.log('--- V⑬ contextMenus 服务缺席：不弹菜单 ---')
{
  const { doc } = setup({ withMenus: false })
  const { rowText, rowButton } = multiCard()
  attachClickHandler(rowButton, () => {})
  const event = pointerEvent(rowText, { clientX: 1, clientY: 2 })
  doc.dispatch('contextmenu', event)
  check('不阻止原生菜单', event.prevented, 0)
}

console.log('--- V⑭ 键盘手势：ContextMenu 键与 Shift+F10 ---')
{
  const { doc, menus } = setup()
  const { rowButton } = multiCard()
  attachClickHandler(rowButton, () => {})
  const event = pointerEvent(rowButton, { key: 'ContextMenu', clientX: undefined, clientY: undefined })
  doc.dispatch('keydown', event)
  check('ContextMenu 键弹出菜单', menus.opened.length, 1)
  check('键盘手势用按钮底边定位', menus.opened[0]?.point, { x: 24, y: 120 })
  check('阻止默认行为', event.prevented, 1)
}
{
  const { doc, menus } = setup()
  const { rowButton } = multiCard()
  attachClickHandler(rowButton, () => {})
  const plain = pointerEvent(rowButton, { key: 'F10' })
  doc.dispatch('keydown', plain)
  check('F10 没有 Shift 不弹菜单', menus.opened, [])
}
{
  const { doc, menus } = setup()
  const { rowButton } = multiCard()
  attachClickHandler(rowButton, () => {})
  const shifted = pointerEvent(rowButton, { key: 'F10', shiftKey: true })
  doc.dispatch('keydown', shifted)
  check('Shift+F10 弹出菜单', menus.opened.length, 1)
}

console.log('--- V⑮ 夹具级别：标题 / 菜单落点的判定 ---')
{
  const { header, rowButton, toggle, rowText } = multiCard()
  checkTrue('标题按钮', headerButton(header) === header)
  check('行按钮不是标题', headerButton(rowText), null)
  check('折叠按钮不是标题', headerButton(toggle), null)
  check('卡片外不是标题', headerButton(new FakeElement('button')), null)
  checkTrue('菜单落点包含行按钮', menuButton(rowText) === rowButton)
  check('折叠按钮没有菜单', menuButton(toggle), null)
  check('卡片外没有菜单', menuButton(new FakeElement('button')), null)
}

console.log('--- V⑯ locale：注册字典；缺席时回退英文 ---')
{
  const locale = fakeLocale()
  setup({ locale })
  check('注册了本插件的命名空间', locale.registered[0]?.namespace, NS)
  check('字典含中英文', Object.keys(locale.registered[0]?.entries ?? {}), ['zh', 'en'])
}
{
  const { doc, menus } = setup()
  const { rowButton } = multiCard()
  attachClickHandler(rowButton, () => {})
  doc.dispatch('contextmenu', pointerEvent(rowButton, { clientX: 1, clientY: 2 }))
  const actions = menus.registered[0].resolve({}, new AbortController().signal)
  check('没有 locale 时用英文', actions[0]?.label, en.openSnapshot)
}

console.log('--- V⑰ 卸载：移除监听、菜单贡献与标记 ---')
{
  const { doc, menus, dispose } = setup()
  check('装上后有标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), '')
  check('装了三个捕获监听', doc.types.sort(), ['click', 'contextmenu', 'keydown'])
  // 只有右键过才会注册菜单贡献；这里先触发一次。
  const { rowButton } = multiCard()
  attachClickHandler(rowButton, () => {})
  doc.dispatch('contextmenu', pointerEvent(rowButton, { clientX: 1, clientY: 2 }))
  check('菜单已注册', menus.registered.length, 1)
  dispose()
  check('卸载后无监听', doc.types, [])
  check('卸载后移除标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
  check('卸载后注销菜单贡献', menus.disposed, true)
}

console.log('--- V⑱ 没有文档：空操作 ---')
{
  const ctx = { get: () => undefined }
  const dispose = installCardBehavior(ctx, {}, undefined)
  checkTrue('返回可调用的卸载函数', typeof dispose === 'function')
  dispose()
}

console.log('--- V⑲ 地址编码：会话 id 里的特殊字符 ---')
{
  check('编码会话 id', localChangesAddress('a/b:c'), 'dsh-resource://forge-changes/a%2Fb%3Ac/local')
  check('前缀常量', CARD_SELECTOR, '[data-changed-files]')
}

console.log('--- V⑳ 推挤呈现：打开后切成全屏 ---')
{
  const { doc, sidebar, warns } = setup()
  attachSidebarPanel(doc, { mode: 'push' })
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('打开本地变更', sidebar.opened, ['dsh-resource://forge-changes/session-1/local'])
  check('切换全屏一次', sidebar.toggles.length, 1)
  check('目标从布局读（传 null，不读焦点）', sidebar.targets, [null])
  check('阻止冒泡', event.stopped, 1)
  check('不告警', warns, [])
}

console.log('--- V㉑ 已经全屏：不再切换（避免切回推挤） ---')
{
  const { doc, sidebar } = setup()
  attachSidebarPanel(doc, { mode: 'fullscreen' })
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('打开本地变更', sidebar.opened, ['dsh-resource://forge-changes/session-1/local'])
  check('不切换呈现方式', sidebar.toggles, [])
  check('仍阻止冒泡', event.stopped, 1)
}

console.log('--- V㉒ 面板还没画出来：打开但不切屏，仍接管点击 ---')
{
  const { doc, sidebar } = setup()
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('打开本地变更', sidebar.opened, ['dsh-resource://forge-changes/session-1/local'])
  check('不切换（读不到现值）', sidebar.toggles, [])
  check('阻止冒泡', event.stopped, 1)
}

console.log('--- V㉓ 活动页不是本地变更（打开落在浮层 / 别的页）：不切屏 ---')
{
  const { doc, sidebar } = setup({ sidebar: { active: { kind: 'file', contentId: 'dsh-resource://file/x.md' } } })
  attachSidebarPanel(doc, { mode: 'push' })
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('打开本地变更', sidebar.opened, ['dsh-resource://forge-changes/session-1/local'])
  check('不切换无关页面', sidebar.toggles, [])
}

console.log('--- V㉔ 右栏面没有全屏命令（老版本 / 别的实现）：只打开 ---')
{
  const { doc, sidebar, warns } = setup({ sidebar: { command: false } })
  attachSidebarPanel(doc, { mode: 'push' })
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('打开本地变更', sidebar.opened, ['dsh-resource://forge-changes/session-1/local'])
  check('没有切换入口时不动作', sidebar.toggles, [])
  check('阻止冒泡', event.stopped, 1)
  check('不告警（合法的缺席）', warns, [])
}

console.log('--- V㉕ 其它会话视图里的全屏面板不算：当前会话仍从推挤切全屏 ---')
{
  const { doc, sidebar } = setup()
  attachSidebarPanel(doc, { mode: 'fullscreen', hidden: true })
  attachSidebarPanel(doc, { mode: 'push' })
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('切换全屏一次', sidebar.toggles.length, 1)
}

console.log('--- V㉖ 目标已陈旧：不切屏 ---')
{
  const { doc, sidebar } = setup({ sidebar: { targetCurrent: false } })
  attachSidebarPanel(doc, { mode: 'push' })
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('打开本地变更', sidebar.opened, ['dsh-resource://forge-changes/session-1/local'])
  check('陈旧目标不切换', sidebar.toggles, [])
  check('仍阻止冒泡', event.stopped, 1)
}

console.log('--- V㉗ 切屏抛错：只告警，已完成的打开与点击接管不受影响 ---')
{
  const { doc, sidebar, warns } = setup()
  attachSidebarPanel(doc, { mode: 'push' })
  sidebar.toggleFullscreen = () => { throw new Error('stale target') }
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('打开本地变更', sidebar.opened, ['dsh-resource://forge-changes/session-1/local'])
  check('阻止冒泡', event.stopped, 1)
  check('记录一条告警', warns.length, 1)
}

finish()
