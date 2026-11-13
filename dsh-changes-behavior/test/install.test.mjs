/**
 * 总装行为测试：一个插件装上后同时具备卡片点击、审查分栏 / 换行默认、悬停闸门、
 * 14px 样式、文件树宽度记忆与打开呈现策略，并且卸载时全部清理。
 *
 * 运行：`node test/install.test.mjs`（或 pnpm test 跑全部）。
 */
import { installChangesBehavior, MARKER_ATTRIBUTE } from '../src/install.ts'
import { MARKER_ATTRIBUTE as CARD_MARKER } from '../src/card.ts'
import { INSTALL_MARKER as SPLIT_MARKER } from '../src/split-default.ts'
import { INSTALL_MARKER as WRAP_MARKER } from '../src/wrap-default.ts'
import { MARKER_ATTRIBUTE as HOVER_MARKER } from '../src/hover-gate.ts'
import { MARKER_ATTRIBUTE as FONT_MARKER } from '../src/font-14.ts'
import { INSTALL_MARKER as TREE_MARKER } from '../src/tree-width.ts'
import {
  attachSidebarPanel,
  check,
  checkTrue,
  fakeSidebar,
  fakeTabs,
  finish,
  pointerEvent,
} from './card-helpers.mjs'
import { FakeObserver, FullDocument, fakePolicySidebar, multiCard } from './full-document.mjs'

/** 装配一次总装；返回全部可断言的替身。 */
function setup({ sessionId = 'session-1', mode = 'push' } = {}) {
  FakeObserver.reset()
  const doc = new FullDocument()
  const panel = attachSidebarPanel(doc, { sessionId, mode })
  const sidebar = fakePolicySidebar({ sessionId })
  const tabs = fakeTabs()
  const warns = []
  const ctx = {
    get: (name) => ({ sidebarRight: sidebar, sidebarRightTabs: tabs })[name],
  }
  const originals = {
    openResource: sidebar.openResource,
    openResourceIn: sidebar.openResourceIn,
    toggleFullscreen: sidebar.toggleFullscreen,
  }
  const dispose = installChangesBehavior(ctx, { warn: (message) => warns.push(message) }, doc)
  return { doc, panel, sidebar, tabs, warns, dispose, originals }
}

console.log('--- I① 总装：一个标记、六条行为全部装上 ---')
{
  const { doc, sidebar, warns } = setup()
  check('总装标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), '')
  check('卡片标记', doc.documentElement.getAttribute(CARD_MARKER), '')
  check('分栏标记', doc.documentElement.getAttribute(SPLIT_MARKER), '')
  check('换行标记', doc.documentElement.getAttribute(WRAP_MARKER), '')
  check('悬停标记', doc.documentElement.getAttribute(HOVER_MARKER), '')
  check('字号标记', doc.documentElement.getAttribute(FONT_MARKER), '')
  check('文件树宽度标记', doc.documentElement.getAttribute(TREE_MARKER), '')
  check('监听类型', doc.types.sort(), ['click', 'keyup', 'mouseenter', 'mouseover', 'pointerenter', 'pointerover', 'pointerup'].sort())
  checkTrue('注入 14px 样式', String(doc.head.child?.textContent).includes('[data-forge-changes]'))
  check('样式带插件标记', doc.head.child?.dataset?.plugin, 'dsh-changes-behavior')
  checkTrue('打开入口已包层', sidebar.openResource !== undefined)
  check('没有告警', warns, [])
}

console.log('--- I② 指定入口：标题打开本地变更并切全屏；其余打开切回推挤 ---')
{
  const { doc, panel, sidebar, originals } = setup({ mode: 'push' })
  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('打开本地变更', sidebar.opened, ['dsh-resource://forge-changes/session-1/local'])
  check('切全屏一次', sidebar.toggles.length, 1)
  check('阻止上游打开本轮审查', event.stopped, 1)

  // 模拟切屏后上游把面板画成全屏；随后一次「其余入口」应把它拉回推挤。
  panel.setAttribute('data-sidebar-right-panel', 'fullscreen')
  sidebar.opened.length = 0
  sidebar.toggles.length = 0
  sidebar.openResource('dsh-resource://file/session-1/other.md')
  check('普通打开仍照常', sidebar.opened, ['dsh-resource://file/session-1/other.md'])
  check('普通打开切回推挤', sidebar.toggles.length, 1)
  check('包层没有破坏原方法', originals.openResource !== sidebar.openResource, true)
}

console.log('--- I③ 悬停浮层：卡片内手势被拦下 ---')
{
  const { doc } = setup()
  const { card } = multiCard()
  const event = pointerEvent(card)
  doc.dispatch('pointerover', event)
  check('阻止 React 合成 enter', event.stopped, 1)
}

console.log('--- I④ 卸载：监听、样式、标记、包层全部还原 ---')
{
  const { doc, sidebar, dispose, originals } = setup()
  dispose()
  check('卸载后无捕获监听', doc.types, [])
  check('卸载后移除总装标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
  check('卸载后移除卡片标记', doc.documentElement.getAttribute(CARD_MARKER), null)
  check('卸载后移除字号标记', doc.documentElement.getAttribute(FONT_MARKER), null)
  check('卸载后移除文件树宽度标记', doc.documentElement.getAttribute(TREE_MARKER), null)
  check('卸载后还原 openResource', sidebar.openResource, originals.openResource)
  check('卸载后还原 openResourceIn', sidebar.openResourceIn, originals.openResourceIn)
  check('卸载后还原 toggleFullscreen', sidebar.toggleFullscreen, originals.toggleFullscreen)
}

console.log('--- I⑤ 没有文档：空操作 ---')
{
  const dispose = installChangesBehavior({ get: () => undefined }, {}, undefined)
  checkTrue('返回可调用卸载函数', typeof dispose === 'function')
  dispose()
}

finish()
