/**
 * 行为测试：会话面板那行「本地变更」的打开按指定入口处理 —— 面板可见时打开本地变更页
 * 切成全屏（行主体与行内「⋯」菜单走同一个打开），已经全屏时保持；面板不可见或打开的是
 * 别的页时仍按非全屏处理。
 *
 * 判定不拦点击（见 src/session-panel.ts），所以测试直接调用打开入口来模拟上游行为：
 * 面板可见 + `openResourceIn(sessionId, 本地变更地址)`。
 *
 * 运行：`node test/session-panel.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  FULLSCREEN_MODE,
  PANEL_ATTRIBUTE,
  PUSH_MODE,
  installOpenPolicy,
} from '../src/presentation.ts'
import {
  PANEL_ATTRIBUTE as SESSION_PANEL_ATTRIBUTE,
  isSessionPanelLocalOpen,
  sessionPanelVisible,
} from '../src/session-panel.ts'
import {
  FakeDocument,
  FakeElement,
  attachSidebarPanel,
  check,
  checkTrue,
  finish,
} from './card-helpers.mjs'

/** 「本地变更」页地址（会话 session-1）。 */
const LOCAL = 'dsh-resource://forge-changes/session-1/local'

/** 一块会话面板：`presentation` 取 `docked` / `overlay`，与上游的取值一致。 */
function sessionPanel(presentation = 'docked') {
  return new FakeElement('aside', { [SESSION_PANEL_ATTRIBUTE]: presentation })
}

/**
 * 装配一次：右栏打开策略 + 会话面板判定。
 *
 * `presentation` 为 null 时不画会话面板；`hiddenView` 把会话面板放进带 `hidden` 的会话视图；
 * `attach` 为 false 时右栏面板还没画出来；`expanded` 是右栏是否展开（打开入口会把它展开）。
 * `active` 覆写打开后的活动页（模拟打开落在浮层 / 别的页）。
 */
function setup({
  mode = PUSH_MODE,
  sessionId = 'session-1',
  presentation = 'docked',
  hiddenView = false,
  attach = true,
  expanded = true,
  width = 1440,
  active,
} = {}) {
  const doc = new FakeDocument()
  doc.defaultView = { innerWidth: width }
  const panel = attach ? attachSidebarPanel(doc, { sessionId, mode }) : null
  const aside = presentation === null ? null : sessionPanel(presentation)
  if (aside !== null) {
    if (hiddenView) {
      const view = new FakeElement('div', { 'data-sidebar-right-session': sessionId, hidden: '' })
      view.append(aside)
      doc.mount(view)
    } else {
      doc.mount(aside)
    }
  }
  const target = { sessionId, paneId: 'pane-1', host: 'dock' }
  const calls = []
  const state = { expanded }
  const opened = []
  const sidebar = {
    calls,
    opened,
    state,
    mounted: { getSnapshot: () => sessionId },
    activeTab: { kind: 'forge-changes', contentId: LOCAL },
    openResource(address) {
      calls.push(['openResource', address])
      opened.push(address)
      state.expanded = true
      sidebar.activeTab = active ?? { kind: 'forge-changes', contentId: address }
    },
    openTab(kind) {
      calls.push(['openTab', kind])
    },
    openResourceIn(id, address) {
      calls.push(['openResourceIn', id, address])
      opened.push(address)
      state.expanded = true
      sidebar.activeTab = active ?? { kind: 'forge-changes', contentId: address }
    },
    openTabIn(id, kind) {
      calls.push(['openTabIn', id, kind])
    },
    isExpanded: () => state.expanded,
    active: () => sidebar.activeTab,
    commandTarget: () => target,
    isTargetCurrent: () => true,
    toggleFullscreen: () => {
      calls.push(['toggleFullscreen'])
      if (panel === null) return
      panel.setAttribute(
        PANEL_ATTRIBUTE,
        panel.getAttribute(PANEL_ATTRIBUTE) === FULLSCREEN_MODE ? PUSH_MODE : FULLSCREEN_MODE,
      )
    },
  }
  const warns = []
  const dispose = installOpenPolicy(sidebar, doc, {
    warn: (message) => warns.push(message),
    designated: (address, id) => isSessionPanelLocalOpen(address, id, doc),
  })
  return { doc, panel, aside, sidebar, calls, warns, dispose }
}

/** 调用名序列。 */
function names(calls) {
  return calls.map(([name]) => name)
}

console.log('--- S① 判定原语：面板可见 + 当前会话的本地变更页 ---')
{
  const empty = new FakeDocument()
  check('没有会话面板时不可见', sessionPanelVisible(empty), false)
  check('没有会话面板时不命中', isSessionPanelLocalOpen(LOCAL, 'session-1', empty), false)

  const doc = new FakeDocument()
  doc.mount(sessionPanel('overlay'))
  check('面板可见', sessionPanelVisible(doc), true)
  check('overlay 也命中', isSessionPanelLocalOpen(LOCAL, 'session-1', doc), true)
  check('别的地址不命中', isSessionPanelLocalOpen('dsh-resource://file/session-1/x.md', 'session-1', doc), false)
  check('别的会话不命中', isSessionPanelLocalOpen(LOCAL, 'session-2', doc), false)
  check('按 kind 打开（没有地址）不命中', isSessionPanelLocalOpen(undefined, 'session-1', doc), false)

  const hidden = new FakeDocument()
  const view = new FakeElement('div', { hidden: '' })
  view.append(sessionPanel('docked'))
  hidden.mount(view)
  check('隐藏会话视图里的面板不算可见', sessionPanelVisible(hidden), false)
  check('隐藏时不命中', isSessionPanelLocalOpen(LOCAL, 'session-1', hidden), false)
}

console.log('--- S② 行主体 / 行内菜单：面板可见时打开本地变更切成全屏 ---')
{
  const { panel, sidebar } = setup()
  sidebar.openResourceIn('session-1', LOCAL)
  check('打开本地变更一次', sidebar.opened, [LOCAL])
  check('先打开、再切全屏', names(sidebar.calls), ['openResourceIn', 'toggleFullscreen'])
  check('面板变全屏', panel.getAttribute(PANEL_ATTRIBUTE), FULLSCREEN_MODE)
}

console.log('--- S③ 已经全屏：从同一行再打开保持全屏，不被推回推挤 ---')
{
  const { panel, sidebar } = setup({ mode: FULLSCREEN_MODE })
  sidebar.openResourceIn('session-1', LOCAL)
  check('只打开、不切换', names(sidebar.calls), ['openResourceIn'])
  check('仍为全屏', panel.getAttribute(PANEL_ATTRIBUTE), FULLSCREEN_MODE)
}

console.log('--- S④ 面板不可见（收起 / 没画出来）：仍按非全屏处理 ---')
{
  const { panel, sidebar } = setup({ mode: FULLSCREEN_MODE, presentation: null })
  sidebar.openResourceIn('session-1', LOCAL)
  check('打开后切回推挤', names(sidebar.calls), ['openResourceIn', 'toggleFullscreen'])
  check('面板回到推挤', panel.getAttribute(PANEL_ATTRIBUTE), PUSH_MODE)
}

console.log('--- S⑤ 隐藏会话视图里的会话面板不算可见 ---')
{
  const { panel, sidebar } = setup({ mode: FULLSCREEN_MODE, hiddenView: true })
  sidebar.openResourceIn('session-1', LOCAL)
  check('按非全屏处理', names(sidebar.calls), ['openResourceIn', 'toggleFullscreen'])
  check('面板回到推挤', panel.getAttribute(PANEL_ATTRIBUTE), PUSH_MODE)
}

console.log('--- S⑥ 打开别的页：与本行无关，仍按非全屏处理 ---')
{
  const { panel, sidebar } = setup({ mode: FULLSCREEN_MODE })
  sidebar.openResourceIn('session-1', 'dsh-resource://file/session-1/x.md')
  check('打开后切回推挤', names(sidebar.calls), ['openResourceIn', 'toggleFullscreen'])
  check('面板回到推挤', panel.getAttribute(PANEL_ATTRIBUTE), PUSH_MODE)
}

console.log('--- S⑦ 按 kind 的打开没有地址：不受本行判定影响 ---')
{
  const { panel, sidebar } = setup({ mode: FULLSCREEN_MODE })
  sidebar.openTab('terminal', {})
  check('非指定入口：切回推挤', names(sidebar.calls), ['openTab', 'toggleFullscreen'])
  panel.setAttribute(PANEL_ATTRIBUTE, FULLSCREEN_MODE)
  sidebar.calls.length = 0
  sidebar.openTabIn('session-1', 'terminal', {})
  check('按会话的 kind 打开同样切回推挤', names(sidebar.calls), ['openTabIn', 'toggleFullscreen'])
  check('面板回到推挤', panel.getAttribute(PANEL_ATTRIBUTE), PUSH_MODE)
}

console.log('--- S⑧ 右栏初始折叠：打开时上游同步展开，仍切成全屏 ---')
{
  const { panel, sidebar } = setup({ expanded: false })
  sidebar.openResourceIn('session-1', LOCAL)
  check('打开并切全屏', names(sidebar.calls), ['openResourceIn', 'toggleFullscreen'])
  check('面板全屏', panel.getAttribute(PANEL_ATTRIBUTE), FULLSCREEN_MODE)
}

console.log('--- S⑨ 面板还没画出来（读不到呈现现值）：只打开、不切 ---')
{
  const { sidebar } = setup({ attach: false })
  sidebar.openResourceIn('session-1', LOCAL)
  check('打开本地变更', sidebar.opened, [LOCAL])
  check('不切换', names(sidebar.calls), ['openResourceIn'])
}

console.log('--- S⑩ 活动页不是本地变更（打开落在浮层 / 别的页）：不切屏 ---')
{
  const { panel, sidebar } = setup({ active: { kind: 'file', contentId: 'dsh-resource://file/session-1/x.md' } })
  sidebar.openResourceIn('session-1', LOCAL)
  check('打开成功', sidebar.opened, [LOCAL])
  check('不切换无关页面', names(sidebar.calls), ['openResourceIn'])
  check('仍为推挤', panel.getAttribute(PANEL_ATTRIBUTE), PUSH_MODE)
}

console.log('--- S⑪ 无会话参数的 openResource（如 forgeChanges.open）同样生效 ---')
{
  const { panel, sidebar } = setup()
  sidebar.openResource(LOCAL)
  check('打开并切全屏', names(sidebar.calls), ['openResource', 'toggleFullscreen'])
  check('面板全屏', panel.getAttribute(PANEL_ATTRIBUTE), FULLSCREEN_MODE)
}

console.log('--- S⑫ 卸载：还原四个打开入口，判定不再参与 ---')
{
  const { sidebar, dispose } = setup()
  const wrapped = sidebar.openResourceIn
  checkTrue('装上后入口被包住', typeof wrapped === 'function')
  dispose()
  sidebar.calls.length = 0
  sidebar.openResourceIn('session-1', LOCAL)
  check('卸载后只打开（包层不再切屏）', names(sidebar.calls), ['openResourceIn'])
}

finish()
