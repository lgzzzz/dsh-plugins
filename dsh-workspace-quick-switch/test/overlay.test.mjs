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
import { installPaletteKeys, PaletteOverlay, PALETTE_OPTION_ATTR, PALETTE_ROOT_ATTR } from '../src/client.ts'
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
    }),
  )
}

/**
 * 渲染浮层并跑它登记的 effect。
 *
 * 生产环境里 React 提交后跑这些 effect(聚焦面板、在 `document` 上挂按键捕获监听);
 * 服务端渲染不跑,所以这里自己拿登记去跑,返回的 `cleanup` 就是组件卸载时会发生的事。
 */
function render(store) {
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
    html = renderToStaticMarkup(React.createElement(PaletteOverlay, { store }))
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
  check('当前工作区被选中', rendered.rows.map((row) => row.selected), ['false', 'true', 'false'])
  check('只有当前行带「当前」角标', rendered.rows.filter((row) => row.current).map((row) => row.title), ['Beta'])
  checkTrue('路径也渲染出来', rendered.html.includes('/projects/ws-2'))
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
  // 组件 effect 调用的那个安装函数驱动起来;组件内部对它的调用由 E④② 的渲染路径覆盖。
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
    picked.push(snapshot.entries[snapshot.activeIndex]?.workspaceId)
  }, 0)
  installPaletteKeys(store, dom.document)
  check('打开在第一条', store.getSnapshot().entries[store.getSnapshot().activeIndex].workspaceId, 'ws-1')
  dom.pressKey('ArrowDown')
  dom.pressKey('Enter')
  check('Enter 落在移动后的行', picked, ['ws-2'])
  check('行标记常量', PALETTE_OPTION_ATTR, 'data-workspace-quick-switch-option')
  checkTrue('浮层关闭', store.getSnapshot().open === false)
}

finish()
dom.uninstall()
