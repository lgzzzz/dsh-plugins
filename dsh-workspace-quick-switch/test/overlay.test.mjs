/**
 * 浮层组件本体:用真 React(react-dom/server)渲染成 HTML,断言候选、当前标记、选中行与 ARIA;
 * 按键通路直接驱动 `installPaletteKeys`(生产环境里由组件的 effect 调用它)。
 *
 * 渲染用自造的 hook 分派器:`useSyncExternalStore` 的读数从 store 现读,effect 登记下来由
 * 测试自己跑 —— `react-dom/server` 会换掉分派器、也不跑 effect。
 *
 * 运行:`node test/overlay.test.mjs`(或 pnpm test 跑全部)。
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { createPaletteStore, paletteEntries } from '../src/palette.ts'
import { sessionPaletteEntries } from '../src/sessions.ts'
import {
  installPaletteKeys,
  keepOptionVisible,
  PALETTE_CSS,
  PaletteOverlay,
  optionDomId,
  PALETTE_OPTION_ATTR,
  PALETTE_ROOT_ATTR,
  SESSION_ROOT_ATTR,
  SESSION_VIEW,
  WORKSPACE_VIEW,
} from '../src/client.ts'
import { check, checkTrue, finish, installDom, workspace } from './helpers.mjs'

const dom = installDom()

const HOSTS = [
  workspace('ws-1', 'Alpha'),
  workspace('ws-2', 'Beta'),
  workspace('ws-3', '', { path: '/projects/empty-title' }),
]

/** `selected` 明确传 undefined 表示「按 `open()` 的默认第一行打开」,传 null 表示不打开。 */
const OPEN_DEFAULT = Symbol('open-default')

/** 浮层状态:候选来自 HOSTS,`active` 决定当前标记,`selected` 决定初始选中行。 */
function makeStore({ active, selected = OPEN_DEFAULT } = {}) {
  const store = createPaletteStore()
  store.sync(paletteEntries(HOSTS, active))
  if (selected !== null) store.open(() => {}, selected === OPEN_DEFAULT ? undefined : selected)
  return store
}

/** 从 HTML 里解析候选行。 */
function parseOptions(html) {
  return [...html.matchAll(/<button[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/button>/gs)].map(
    ([, selected, body]) => ({
      selected,
      current: body.includes('dsh-workspace-quick-switch-current'),
      title: /dsh-workspace-quick-switch-name">([^<]*)</.exec(body)?.[1],
      index: /dsh-workspace-quick-switch-index">([^<]*)</.exec(body)?.[1],
    }),
  )
}

/** 标题右侧的计数字样(含页码)。 */
function countText(html) {
  return /dsh-workspace-quick-switch-count">([^<]*)</.exec(html)?.[1]
}

/** 底栏的提示条目。 */
function footHints(html) {
  return [...html.matchAll(/<span[^>]*>(↑ ↓ 选择|← → 翻页|Enter 新建会话|Enter 打开会话|Esc 关闭)<\/span>/g)].map(([, text]) => text)
}

/**
 * 渲染浮层,并收下组件登记的 effect(服务端渲染不跑它们)。
 *
 * 生产环境里 React 提交后跑这些 effect:聚焦面板、在 `document` 上挂按键捕获监听。
 * 这里把它们登记下来,`runEffects()` 负责跑,`cleanup()` 按逆序跑返回的清理函数,
 * 也就是组件卸载时会发生的事。
 */
function render(store, view = WORKSPACE_VIEW) {
  const effects = []
  const dispatcher = {
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useRef: (initial) => ({ current: initial }),
    useEffect: (callback) => {
      effects.push(callback)
    },
  }
  const shared = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  const slot = shared.ReactCurrentDispatcher
  const previous = slot.current
  slot.current = dispatcher
  let html = ''
  try {
    html = renderToStaticMarkup(React.createElement(PaletteOverlay, { store, view }))
  } finally {
    slot.current = previous
  }
  let cleanups = []
  return {
    html,
    rows: parseOptions(html),
    /** 跑一遍登记的 effect,返回清理函数。 */
    runEffects() {
      cleanups = []
      for (const callback of effects) {
        const cleanup = callback()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
      return cleanups
    },
    cleanup() {
      for (const cleanup of [...cleanups].reverse()) cleanup()
      cleanups = []
    },
  }
}

console.log('--- E① 未打开时什么都不渲染 ---')
{
  const store = createPaletteStore()
  store.sync(paletteEntries(HOSTS, 'ws-1'))
  const rendered = render(store)
  check('空串', rendered.html, '')
}

console.log('--- E② 渲染候选:顺序、标题、路径、当前标记与选中行 ---')
{
  // 与真实打开流程一致:容器把「当前工作区所在行」交给 open()。
  const store = makeStore({ active: 'ws-2', selected: 1 })
  const rendered = render(store)
  checkTrue('根节点带插件标记', rendered.html.includes(PALETTE_ROOT_ATTR))
  check('三行候选', rendered.rows.length, 3)
  check('标题按候选顺序', rendered.rows.map((row) => row.title), ['Alpha', 'Beta', 'ws-3'])
  check('空标题退回候选身份(这里是工作区 id)', rendered.rows[2].title, 'ws-3')
  check('当前工作区被选中', rendered.rows.map((row) => row.selected), ['false', 'true', 'false'])
  check('只有当前行带「当前」角标', rendered.rows.filter((row) => row.current).map((row) => row.title), ['Beta'])
  checkTrue('第二行(路径)也渲染出来', rendered.html.includes('/projects/ws-2'))
  checkTrue('空标题退回工作区 id', rendered.html.includes('>ws-3<'))
  checkTrue('每行都带插件行标记', rendered.html.split(PALETTE_OPTION_ATTR).length - 1 === 3)
  checkTrue(
    '列表容器带上 aria-activedescendant',
    rendered.html.includes('aria-activedescendant="dsh-workspace-quick-switch-option-1"'),
  )
  checkTrue('面板是 aria-modal 对话框', rendered.html.includes('role="dialog"') && rendered.html.includes('aria-modal="true"'))
  checkTrue('提示了快捷键', rendered.html.includes('Enter 新建会话') && rendered.html.includes('Esc 关闭'))

  // 选中行跟随 store,不必重挂。
  store.select(2)
  check('重渲后第 3 行被选中', render(store).rows.map((row) => row.selected), ['false', 'false', 'true'])

  const empty = createPaletteStore()
  empty.sync([])
  empty.open(() => {})
  check('没有候选时不出列表容器', render(empty).rows.length, 0)
  checkTrue('没有候选时给出提示', render(empty).html.includes('先在左侧栏添加一个工作区。'))
}

console.log('--- E③ 组件登记的 effect:聚焦 + 捕获监听 ---')
{
  // 服务端渲染不跑 effect,而且 React 会在渲染期间换掉分派器,所以这里直接把生产环境里
  // 组件 effect 调用的那个安装函数驱动起来,不走组件的挂载流程。
  const store = makeStore({ active: 'ws-1', selected: 0 })
  const cleanups = installPaletteKeys(store, dom.document)
  check('安装函数挂上捕获监听', dom.document.listenerCount(), 1)
  check('安装函数返回清理函数', typeof cleanups, 'function')

  // 打开状态下按 Enter:动作走完,浮层关闭。
  let confirmed = 0
  store.open(() => { confirmed += 1 }, 0)
  dom.pressKey('Enter')
  check('Enter 走完整个确认路径', confirmed, 1)
  check('确认后浮层关闭', store.getSnapshot().open, false)

  store.open(() => {}, 0)
  dom.pressKey('ArrowDown')
  check('↓ 移动选中行', store.getSnapshot().activeIndex, 1)

  cleanups()
  check('清理后撤掉监听', dom.document.listenerCount(), 0)
}

console.log('--- E④ installPaletteKeys:只接管浮层开着时的那四个键 ---')
{
  const store = makeStore({ active: 'ws-1', selected: null })
  check('用例起点是关闭状态', store.getSnapshot().open, false)
  const uninstall = installPaletteKeys(store, dom.document)
  check('监听挂上了', dom.document.listenerCount(), 1)

  // 浮层没开:一个键都不动。
  let confirmed = 0
  const idle = dom.pressKey('Enter')
  checkTrue('关闭时 Enter 不被动', idle.defaultPrevented === false && idle.stopped === false)
  check('关闭时 Enter 不触发动作', confirmed, 0)

  store.open(() => { confirmed += 1 }, 0)
  const enter = dom.pressKey('Enter')
  checkTrue('Enter 被消费', enter.defaultPrevented === true && enter.stopped === true)
  check('动作被调用一次', confirmed, 1)

  // ↑/↓ 环状移动。
  store.open(() => {}, 0)
  dom.pressKey('ArrowDown')
  check('↓ 移动选中行', store.getSnapshot().activeIndex, 1)
  dom.pressKey('ArrowUp')
  check('↑ 回到第一行', store.getSnapshot().activeIndex, 0)
  dom.pressKey('ArrowUp')
  check('↑ 从第一行绕到末尾', store.getSnapshot().activeIndex, 2)

  // 带修饰键、输入法组合中、长按确认键都不归浮层。
  const modified = dom.pressKey('ArrowDown', { ctrlKey: true })
  check('Ctrl+↓ 放行', modified.defaultPrevented, false)
  check('选中行没动', store.getSnapshot().activeIndex, 2)
  const composing = dom.pressKey('Enter', { isComposing: true })
  check('输入法组合中放行', composing.defaultPrevented, false)
  const repeated = dom.pressKey('Enter', { repeat: true })
  check('长按 Enter 放行', repeated.defaultPrevented, false)

  uninstall()
  check('卸载后撤掉监听', dom.document.listenerCount(), 0)
}

console.log('--- E⑤ Enter 用的是当下的选中行 ---')
{
  const store = makeStore({ active: 'ws-2' })
  const picked = []
  store.open(() => {
    const snapshot = store.getSnapshot()
    picked.push(snapshot.entries[snapshot.activeIndex]?.key)
  }, 0)
  const offKeys = installPaletteKeys(store, dom.document)
  check('打开在第一条', store.getSnapshot().entries[store.getSnapshot().activeIndex].key, 'ws-1')
  dom.pressKey('ArrowDown')
  dom.pressKey('Enter')
  offKeys()
  check('Enter 落在移动后的行', picked, ['ws-2'])
  check('行标记常量', PALETTE_OPTION_ATTR, 'data-workspace-quick-switch-option')
  checkTrue('浮层关闭', store.getSnapshot().open === false)
}

console.log('--- E⑥ 高度策略:面板不再被固定上限截断 ---')
{
  // 修复前是 `max-height: min(70vh, 560px)`:面板在任何窗口里都被截到 560px,而 10 行 × 50px
  // 需要 526px 的列表,于是第 10 行永远在滚动区外。现在面板只受浮层层高度约束。
  const css = PALETTE_CSS
  checkTrue('面板不设固定像素上限', !/^\s*max-height:\s*(?:min\(|\d+px)/m.test(css))
  checkTrue('面板吃满浮层留给它的高度', css.includes('max-height: 100%;'))
  checkTrue('矮窗口靠媒体查询收紧内边距(而不是截断高度)', /@media \(max-height: \d+px\)/.test(css))
  checkTrue('列表自己滚动、不再撑破面板', /\.dsh-workspace-quick-switch-list \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;[^}]*overflow-y: auto;/s.test(css))
  checkTrue('顶部内边距仍给 macOS 红绿灯 / Windows 标题栏让位', css.includes('var(--dsh-frame-overlay-top, 24px)'))
}

console.log('--- E⑦ 一屏 10 行、← / → 翻页、序号与页码跟着走 ---')
{
  const many = Array.from({ length: 25 }, (_, index) => workspace(`ws-${index + 1}`, `W${index + 1}`))
  const store = createPaletteStore()
  store.sync(paletteEntries(many, 'ws-13'))
  store.open(() => {}, 12)

  // 打开时「当前」在第二页:浮层直接开在那一页,而不是停在第 1 行让人自己翻。
  const second = render(store)
  check('开在当前工作区所在页', second.rows.map((row) => row.title), [
    'W11', 'W12', 'W13', 'W14', 'W15', 'W16', 'W17', 'W18', 'W19', 'W20',
  ])
  check('序号是全局序号(不是页内序号)', second.rows.map((row) => row.index), [
    '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  ])
  check('选中当前工作区那一行', second.rows.map((row) => row.selected).indexOf('true'), 2)
  check('页码文案', countText(second.html), '25 个工作区 · 第 2 / 3 页')
  check('多页时底栏提示 ← → 翻页', footHints(second.html), ['↑ ↓ 选择', '← → 翻页', 'Enter 新建会话', 'Esc 关闭'])

  // → 翻到下一页。
  store.turn(1)
  const third = render(store)
  check('→ 后是第三页', third.rows.map((row) => row.title), ['W21', 'W22', 'W23', 'W24', 'W25'])
  check('最后一页只渲染剩余的 5 行', third.rows.length, 5)
  check('最后一页序号继续', third.rows.map((row) => row.index), ['21', '22', '23', '24', '25'])
  check('页码跟到第三页', countText(third.html), '25 个工作区 · 第 3 / 3 页')

  // ← 回第二页;选中行落在这一页第一行。
  store.turn(-1)
  const back = render(store)
  check('← 回到第二页', back.rows.map((row) => row.title)[0], 'W11')
  check('翻页后选中本页第一行', back.rows.map((row) => row.selected), [
    'true', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false',
  ])

  // 单页:不显示翻页提示,页码也不出现。
  const few = createPaletteStore()
  few.sync(paletteEntries(many.slice(0, 4), undefined))
  few.open(() => {})
  check('单页页码文案只有总数', countText(render(few).html), '4 个工作区')
  check('单页没有翻页提示', footHints(render(few).html), ['↑ ↓ 选择', 'Enter 新建会话', 'Esc 关闭'])
}

console.log('--- E⑧ 选中行滚进可见区 ---')
{
  const seen = []
  const option = {
    scrollIntoView(init) {
      seen.push(init)
    },
  }
  keepOptionVisible(option)
  check('按 nearest 滚动', seen, [{ block: 'nearest' }])
  // 没有 scrollIntoView 的替身(以及 null)不能让浮层报错。
  keepOptionVisible({})
  keepOptionVisible(null)
  keepOptionVisible(undefined)
  check('缺席时静默跳过', seen.length, 1)

  // 组件按「选中行的 DOM id」查找:这个 id 必须就是渲染出来的那一行,否则滚不动。
  const rendered = render(makeStore({ active: 'ws-3', selected: 2 }))
  check('选中行按 id 查找', optionDomId(WORKSPACE_VIEW, 2), 'dsh-workspace-quick-switch-option-2')
  checkTrue('渲染结果里存在这个 id', rendered.html.includes('id="dsh-workspace-quick-switch-option-2"'))
  checkTrue('选中的正是那一行', rendered.rows[2].selected === 'true')
}

console.log('--- E⑨ 会话浮层:同一个组件、另一份文案与候选 ---')
{
  const store = createPaletteStore()
  store.sync(sessionPaletteEntries({
    sessions: {
      ids: ['s1', 's2'],
      byId: {
        s1: { id: 's1', title: '重构排序', updatedAt: 200, retainedBy: { mainView: 1 } },
        s2: { id: 's2', title: '修快捷键', updatedAt: 100, retainedBy: { mainView: 0 }, running: true },
      },
    },
    workspaces: [
      { workspaceId: 'w1', title: 'dsh-plugins', path: '/p', sessionIds: ['s1', 's2'] },
    ],
    rowState: { pinnedSessionIds: ['s2'] },
  }, 200))
  store.open(() => {}, 0)

  const rendered = render(store, SESSION_VIEW)
  checkTrue('根节点用会话浮层的标记', rendered.html.includes(`${SESSION_ROOT_ATTR}=""`))
  check('工作区浮层的根标记不出现', rendered.html.includes(`${PALETTE_ROOT_ATTR}=""`), false)
  check('标题是「切换会话」', rendered.html.includes('切换会话'), true)
  check('计数单位是「个会话」', countText(rendered.html), '2 个会话')
  check('底栏提示打开会话', footHints(rendered.html), ['↑ ↓ 选择', 'Enter 打开会话', 'Esc 关闭'])
  // 左侧栏的口径:置顶行在「最近更新」顺序之前,空白行再在置顶之前(这一组没有空白)。
  check('候选顺序:置顶在前,其余按最近更新', rendered.rows.map((row) => row.title), ['修快捷键', '重构排序'])
  check('第二行是「工作区 · 相对时间」', rendered.html.includes('dsh-plugins · 刚刚'), true)
  checkTrue('进行中角标渲染出来', rendered.html.includes('>进行中<'))
  checkTrue('置顶角标渲染出来', rendered.html.includes('>置顶<'))
  check('行 id 前缀独立(不与工作区浮层撞车)', optionDomId(SESSION_VIEW, 3), 'dsh-workspace-quick-switch-session-option-3')

  // 空态文案也来自 view,不是硬编码的工作区文案。
  const empty = createPaletteStore()
  empty.sync([])
  empty.open(() => {})
  const emptyHtml = render(empty, SESSION_VIEW).html
  checkTrue('空态给出会话文案', emptyHtml.includes(SESSION_VIEW.emptyHint))
  checkTrue('空态计数也是会话口径', emptyHtml.includes(SESSION_VIEW.emptyCount))
}

console.log('--- E⑩ 两张浮层各挂一份按键监听,只认自己那个 store ---')
{
  const workspaceStore = makeStore({ active: 'ws-1', selected: null })
  const sessionStore = createPaletteStore()
  sessionStore.sync(sessionPaletteEntries({
    sessions: { ids: ['s1'], byId: { s1: { id: 's1', title: 'A', updatedAt: 1 } } },
    workspaces: [],
    rowState: {},
  }, 2))
  const before = dom.document.listenerCount()
  const offWorkspace = installPaletteKeys(workspaceStore, dom.document)
  const offSession = installPaletteKeys(sessionStore, dom.document)
  check('两条监听', dom.document.listenerCount() - before, 2)

  // 只有会话浮层开着:工作区浮层那条监听什么都不做,会话浮层那条收下这一按。
  sessionStore.open(() => {}, 0)
  dom.pressKey('Escape')
  check('Esc 只关掉开着的那一张', [sessionStore.getSnapshot().open, workspaceStore.getSnapshot().open], [false, false])
  check('关闭它自己就够了', sessionStore.getSnapshot().open, false)

  offWorkspace()
  offSession()
  check('卸载后都撤掉', dom.document.listenerCount(), before)
}

finish()
dom.uninstall()
