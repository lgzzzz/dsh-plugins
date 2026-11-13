/**
 * 打开呈现策略的行为测试：指定入口全屏、其余入口非全屏、四个打开入口全部被包住，
 * 以及窄窗口 / 浮层 / 折叠 / 陈旧目标等不干预路径。
 *
 * 运行：`node test/presentation.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  AUTO_FULLSCREEN_WIDTH,
  FULLSCREEN_MODE,
  MARKER_ATTRIBUTE,
  PANEL_ATTRIBUTE,
  PUSH_MODE,
  installOpenPolicy,
  isAutoFullscreen,
  panelMode,
  presentFullscreen,
  presentPush,
} from '../src/presentation.ts'
import {
  FakeDocument,
  FakeElement,
  attachSidebarPanel,
  check,
  checkTrue,
  finish,
} from './card-helpers.mjs'

/** 记录调用顺序的假右栏面；toggleFullscreen 会把面板属性真的改掉。 */
function setup({ mode = PUSH_MODE, expanded = true, width = 1440, sessionId = 'session-1' } = {}) {
  const doc = new FakeDocument()
  doc.defaultView = { innerWidth: width }
  const panel = attachSidebarPanel(doc, { sessionId, mode })
  const target = { sessionId, paneId: 'pane-1', host: 'dock' }
  const calls = []
  const original = {}
  const sidebar = {
    calls,
    activeTab: { kind: 'forge-changes', contentId: 'dsh-resource://forge-changes/session-1/local' },
    mounted: { getSnapshot: () => sessionId },
    openResource(...args) {
      calls.push(['openResource', ...args])
    },
    openTab(...args) {
      calls.push(['openTab', ...args])
    },
    openResourceIn(...args) {
      calls.push(['openResourceIn', ...args])
    },
    openTabIn(...args) {
      calls.push(['openTabIn', ...args])
    },
    isExpanded: () => expanded,
    active: () => sidebar.activeTab,
    commandTarget: () => target,
    isTargetCurrent: () => true,
    toggleFullscreen: () => {
      calls.push(['toggleFullscreen'])
      panel.setAttribute(PANEL_ATTRIBUTE, panel.getAttribute(PANEL_ATTRIBUTE) === FULLSCREEN_MODE ? PUSH_MODE : FULLSCREEN_MODE)
    },
  }
  for (const name of ['openResource', 'openTab', 'openResourceIn', 'openTabIn']) original[name] = sidebar[name]
  return { doc, panel, sidebar, calls, original }
}

console.log('--- P① 呈现方式读数 ---')
{
  const doc = new FakeDocument()
  const panel = attachSidebarPanel(doc, { sessionId: 's1', mode: FULLSCREEN_MODE })
  check('读当前会话面板', panelMode(doc, 's1'), FULLSCREEN_MODE)
  check('别的会话：undefined', panelMode(doc, 's2'), undefined)
  panel.setAttribute(PANEL_ATTRIBUTE, PUSH_MODE)
  check('读推挤', panelMode(doc, 's1'), PUSH_MODE)
  panel.setAttribute('hidden', '')
  check('隐藏视图里的面板不算', panelMode(doc, 's1'), undefined)
}

console.log('--- P② 指定入口：presentFullscreen 只从推挤切到全屏 ---')
{
  const { doc, sidebar, calls } = setup({ mode: PUSH_MODE })
  check('推挤 → 切全屏', presentFullscreen(sidebar, doc, 'session-1', sidebar.activeTab), true)
  check('切换一次', calls.filter(([name]) => name === 'toggleFullscreen').length, 1)
  calls.length = 0
  check('已经全屏 → 不重复切', presentFullscreen(sidebar, doc, 'session-1', sidebar.activeTab), false)
  check('没有切换', calls.filter(([name]) => name === 'toggleFullscreen').length, 0)
  calls.length = 0
  check('活动页不是认领页 → 不切', presentFullscreen(sidebar, doc, 'session-1', { kind: 'file', contentId: 'x' }), false)
  check('没有切换', calls.filter(([name]) => name === 'toggleFullscreen').length, 0)
}

console.log('--- P③ 其余入口：安装包层后，全屏打开会先切回推挤 ---')
{
  const { doc, panel, sidebar, calls, original } = setup({ mode: FULLSCREEN_MODE })
  const dispose = installOpenPolicy(sidebar, doc)
  check('装上后写入标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), '')
  check('openResource 被包住', sidebar.openResource === original.openResource, false)

  sidebar.openResource('dsh-resource://file/session-1/x.md')
  check('仍然打开', calls[0], ['openResource', 'dsh-resource://file/session-1/x.md'])
  check('打开后切回推挤', calls[1], ['toggleFullscreen'])
  check('面板回到推挤', panel.getAttribute(PANEL_ATTRIBUTE), PUSH_MODE)

  calls.length = 0
  sidebar.openTab('forge-panel')
  check('推挤下打开不再切屏', calls, [['openTab', 'forge-panel']])

  panel.setAttribute(PANEL_ATTRIBUTE, FULLSCREEN_MODE)
  calls.length = 0
  sidebar.openResourceIn('session-1', 'dsh-resource://file/session-1/y.md', {})
  check('按会话入口也切回推挤', calls.map(([name]) => name), ['openResourceIn', 'toggleFullscreen'])

  panel.setAttribute(PANEL_ATTRIBUTE, FULLSCREEN_MODE)
  calls.length = 0
  sidebar.openTabIn('session-1', 'terminal', {})
  check('openTabIn 同样切回推挤', calls.map(([name]) => name), ['openTabIn', 'toggleFullscreen'])

  dispose()
  check('卸载后还原 openResource', sidebar.openResource, original.openResource)
  check('卸载后还原 openTab', sidebar.openTab, original.openTab)
  check('卸载后还原 openResourceIn', sidebar.openResourceIn, original.openResourceIn)
  check('卸载后还原 openTabIn', sidebar.openTabIn, original.openTabIn)
  check('卸载后移除标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
}

console.log('--- P④ 不干预：浮层、窄窗口、折叠、读不到会话 / 现值 ---')
{
  const float = setup({ mode: FULLSCREEN_MODE })
  const disposeFloat = installOpenPolicy(float.sidebar, float.doc)
  float.sidebar.openTab('browser', { destination: 'float' })
  check('浮层打开不切屏', float.calls.map(([name]) => name), ['openTab'])
  disposeFloat()

  const narrow = setup({ mode: FULLSCREEN_MODE, width: AUTO_FULLSCREEN_WIDTH - 1 })
  checkTrue('窄窗口判定', isAutoFullscreen(narrow.doc))
  const disposeNarrow = installOpenPolicy(narrow.sidebar, narrow.doc)
  narrow.sidebar.openResource('dsh-resource://file/session-1/z.md')
  check('窄窗口自动全屏不切', narrow.calls.map(([name]) => name), ['openResource'])
  disposeNarrow()

  const collapsed = setup({ mode: FULLSCREEN_MODE, expanded: false })
  const disposeCollapsed = installOpenPolicy(collapsed.sidebar, collapsed.doc)
  collapsed.sidebar.openResource('dsh-resource://file/session-1/z.md')
  check('折叠时交给打开动作自己展开，不切屏', collapsed.calls.map(([name]) => name), ['openResource'])
  disposeCollapsed()

  const signedOut = setup({ mode: FULLSCREEN_MODE })
  signedOut.sidebar.mounted = { getSnapshot: () => undefined }
  const disposeSignedOut = installOpenPolicy(signedOut.sidebar, signedOut.doc)
  signedOut.sidebar.openResource('dsh-resource://file/session-1/z.md')
  check('没有屏幕会话：只打开', signedOut.calls.map(([name]) => name), ['openResource'])
  disposeSignedOut()
}

console.log('--- P⑤ 失败路径：打开抛错不切屏，切屏抛错只告警 ---')
{
  const { doc, sidebar, calls } = setup({ mode: FULLSCREEN_MODE })
  sidebar.openResource = () => { throw new Error('unloaded') }
  const dispose = installOpenPolicy(sidebar, doc)
  let threw = false
  try {
    sidebar.openResource('x')
  } catch {
    threw = true
  }
  check('原错误继续抛出', threw, true)
  check('不切屏', calls.filter(([name]) => name === 'toggleFullscreen'), [])
  dispose()

  const broken = setup({ mode: FULLSCREEN_MODE })
  broken.sidebar.toggleFullscreen = () => { throw new Error('no store') }
  const warns = []
  const disposeBroken = installOpenPolicy(broken.sidebar, broken.doc, { warn: (message) => warns.push(message) })
  broken.sidebar.openResource('y')
  check('切屏失败不吞打开', broken.calls.some(([name]) => name === 'openResource'), true)
  check('记录一条告警', warns.length, 1)
  disposeBroken()
}

console.log('--- P⑥ presentPush：只从全屏切回推挤 ---')
{
  const { doc, panel, sidebar, calls } = setup({ mode: FULLSCREEN_MODE })
  check('全屏 → 切回推挤', presentPush(sidebar, doc, 'session-1'), true)
  check('切一次', calls.filter(([name]) => name === 'toggleFullscreen').length, 1)
  check('面板变推挤', panel.getAttribute(PANEL_ATTRIBUTE), PUSH_MODE)
  calls.length = 0
  check('已经推挤 → 不动作', presentPush(sidebar, doc, 'session-1'), false)
  check('没有切换', calls.filter(([name]) => name === 'toggleFullscreen').length, 0)
}

finish()
