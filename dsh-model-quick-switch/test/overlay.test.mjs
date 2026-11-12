/**
 * 渲染：浮层与设置页都注册的是组件本体，用真实的 React 渲染成 HTML 再断言。
 *
 * 覆盖一屏窗口、当前角标、目录外角标、空态、错误 / 进行中提示、浮层六键与滚轮、
 * 以及设置页的列表 / 只读 / 目录错误 / 空列表状态。
 *
 * 运行：`node test/overlay.test.mjs`（或 pnpm test 跑全部）。
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MODEL_VIEW,
  ModelOverlay,
  ModelSettingsSection,
  PALETTE_OPTION_ATTR,
  PALETTE_ROOT_ATTR,
  SETTINGS_ROOT_ATTR,
  countLabel,
  optionDomId,
} from '../src/client.ts'
import { createPaletteStore, installPaletteKeys, installPaletteWheel, wheelStep } from '../src/palette.ts'
import { choiceKey, choiceRows, flattenCatalog, orderCatalogGroups } from '../src/model.ts'
import { createModelDataStore } from '../src/model-data.ts'
import { check, checkTrue, finish, installDom } from './helpers.mjs'

const GROUPS = [
  { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }] },
  { id: 'opencode-go', name: 'OpenCode Go', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }] },
]

/** 造一份「已添加 2 个、当前是第一个」的数据快照。 */
function makeData({ choices, current = { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } } = {}) {
  const data = createModelDataStore()
  const groups = orderCatalogGroups(GROUPS)
  const list = choices ?? [
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
    { provider: 'retired', model: 'old-model' },
  ]
  data.set({
    choices: list,
    groups,
    defaultSelection: { provider: 'deepseek', model: 'deepseek-chat' },
    current,
    sessionId: 's1',
    configStatus: 'ready',
    catalogStatus: 'ready',
    writable: true,
  })
  return data
}

/** 造一张开着（或没开）的浮层，候选与数据快照对齐。 */
function makePalette(data, { open = true, index } = {}) {
  const palette = createPaletteStore()
  const state = data.getSnapshot()
  const rows = choiceRows(state.choices, state.catalog, state.current ?? state.defaultSelection)
  palette.sync(rows)
  if (open) palette.open(() => {}, index ?? Math.max(0, rows.findIndex((row) => row.current === true)))
  return palette
}

/** 渲染浮层 HTML。 */
function renderOverlay(palette, data) {
  return renderToStaticMarkup(React.createElement(ModelOverlay, { store: palette, data, view: MODEL_VIEW }))
}

/** 从 HTML 里读候选行。 */
function rowsOf(html) {
  return [...html.matchAll(/<button[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/button>/gs)].map(([, selected, body]) => ({
    selected,
    title: /dsh-model-quick-switch-name">([^<]*)</.exec(body)?.[1],
    subtitle: /dsh-model-quick-switch-path">([^<]*)</.exec(body)?.[1],
    current: body.includes('dsh-model-quick-switch-current'),
    badge: /dsh-model-quick-switch-badge[^>]*>([^<]*)</.exec(body)?.[1],
    enter: body.includes('dsh-model-quick-switch-enter'),
  }))
}

console.log('--- O① 没打开时不渲染 ---')
{
  const data = makeData()
  const palette = makePalette(data, { open: false })
  check('关闭状态渲染为空串', renderOverlay(palette, data), '')
}

console.log('--- O② 打开:候选、当前角标、目录外角标、选中行 ---')
{
  const data = makeData()
  const palette = makePalette(data, { index: 0 })
  const html = renderOverlay(palette, data)
  checkTrue('根节点带标记', html.includes(`${PALETTE_ROOT_ATTR}=""`))
  const rows = rowsOf(html)
  check('三行候选', rows.map((row) => row.title), ['DeepSeek Chat', 'DeepSeek V4.1 Flash', 'old-model'])
  check('没写强度的选择只显示提供方(强度交给默认值)', rows[0].subtitle, 'DeepSeek')
  check('当前行带角标', rows.map((row) => row.current), [true, false, false])
  check('目录外的行带角标', rows.map((row) => row.badge), [undefined, undefined, '目录外'])
  check('选中行落在当前行', rows.map((row) => row.selected), ['true', 'false', 'false'])
  check('选中行显示 Enter 提示', rows.map((row) => row.enter), [true, false, false])
  checkTrue('列表容器有 aria-activedescendant', html.includes(`aria-activedescendant="${optionDomId(MODEL_VIEW, 0)}"`))
  checkTrue('行带稳定身份', html.includes('data-palette-key='))
  check('行身份是完整选择(JSON 数组)', JSON.parse(html.match(/data-palette-key="([^"]*)"/)[1].replaceAll('&quot;', '"')), ['deepseek', 'deepseek-chat', ''])
  checkTrue('行带候选标记', html.includes(`${PALETTE_OPTION_ATTR}=""`))
  check('标题与计数', [MODEL_VIEW.title, html.includes('3 个模型')], ['快捷菜单', true])
  check('底栏提示', ['↑ ↓ 选择', 'Enter 切换模型', 'Esc 关闭'].map((text) => html.includes(text)), [true, true, true])
}

console.log('--- O③ 一屏 10 行:窗口连续滑动的渲染 ---')
{
  const choices = Array.from({ length: 12 }, (_, index) => ({ provider: 'deepseek', model: `m-${index + 1}` }))
  const data = makeData({ choices, current: null })
  const palette = makePalette(data, { index: 0 })
  check('第一屏 10 行', rowsOf(renderOverlay(palette, data)).length, 10)
  check('计数显示 1–10', countLabel(MODEL_VIEW, 12, 0), '12 个模型 · 显示 1–10')
  palette.slide(1)
  check('滚一行后显示 2–11', countLabel(MODEL_VIEW, 12, 1), '12 个模型 · 显示 2–11')
  const rows = rowsOf(renderOverlay(palette, data))
  check('第一行变成 m-2', rows[0].title, 'm-2')
  check('最后一行是 m-11', rows[9].title, 'm-11')
  palette.turn(1)
  check('→ 到末尾贴底', rowsOf(renderOverlay(palette, data))[9].title, 'm-12')
}

console.log('--- O④ 空列表与错误 / 进行中提示 ---')
{
  const data = makeData({ choices: [] })
  const palette = makePalette(data, { index: 0 })
  const html = renderOverlay(palette, data)
  checkTrue('空态提示', html.includes('在「设置 → 模型快速切换」里添加要在这里出现的模型。'))
  checkTrue('计数换成空态文案', html.includes('列表里还没有模型'))
  check('没有候选行', rowsOf(html).length, 0)
  // 状态区始终渲染（空闲 / 进行中 / 出错都是同一个定高容器），否则切换工作树或团队协作时
  // 浮层会因这一行的出现与消失改变高度、在居中的视口里上下跳一下。
  checkTrue('空闲时状态区也在', html.includes('dsh-model-quick-switch-status'))

  data.set({ error: '切换失败：session/writer-held: 会话被占用' })
  checkTrue('错误行带 role=alert', renderOverlay(palette, data).includes('role="alert"'))
  checkTrue('错误文案可见', renderOverlay(palette, data).includes('session/writer-held'))
  data.set({ error: null, pending: true })
  const pending = renderOverlay(palette, data)
  checkTrue('进行中提示', pending.includes('正在切换模型…'))
  check('进行中时不再显示错误', pending.includes('role="alert"'), false)
}

console.log('--- O⑤ 浮层内六键:捕获阶段接管、确认走 binding、关闭清状态 ---')
{
  const dom = installDom()
  try {
    const store = createPaletteStore()
    store.sync([{ key: 'a', title: 'A', subtitle: 'p' }, { key: 'b', title: 'B', subtitle: 'p' }])
    let confirmed = 0
    store.open(() => { confirmed += 1 })
    let confirms = 0
    const off = installPaletteKeys(store, dom.document, () => { confirms += 1 })
    check('document 上挂了一个捕获监听', dom.document.listenerCount(), 1)

    const down = dom.pressKey('ArrowDown')
    check('↓ 移选中行', store.getSnapshot().activeIndex, 1)
    check('↓ 被吞掉', [down.defaultPrevented, down.stopped], [true, true])

    dom.pressKey('ArrowDown')
    check('末尾再 ↓ 绕回第一行', store.getSnapshot().activeIndex, 0)
    dom.pressKey('ArrowUp')
    check('开头再 ↑ 绕回最后一行', store.getSnapshot().activeIndex, 1)

    const enter = dom.pressKey('Enter')
    check('Enter 交给自定义确认', confirms, 1)
    check('Enter 被吞掉', [enter.defaultPrevented, enter.stopped], [true, true])

    const modified = dom.pressKey('ArrowUp', { ctrlKey: true })
    check('带修饰键的键放行', [modified.defaultPrevented, modified.stopped], [false, false])
    check('放行的键不改选中行', store.getSnapshot().activeIndex, 1)

    dom.pressKey('Escape')
    check('Escape 关闭', store.getSnapshot().open, false)
    off()
    check('卸载撤掉监听', dom.document.listenerCount(), 0)

    // 第二步（选思考等级）传入 back 时，Esc 退回上一步而不是关闭浮层。
    store.open(() => {}, 0)
    let backs = 0
    const offBack = installPaletteKeys(store, dom.document, undefined, { back: () => { backs += 1 } })
    dom.pressKey('Escape')
    check('Esc 交给 back 且浮层不关', [backs, store.getSnapshot().open], [1, true])
    offBack()
    check('卸载撤掉返回监听', dom.document.listenerCount(), 0)
  } finally {
    dom.uninstall()
  }
}

console.log('--- O⑥ 滚轮:一格一行、捏合放行、卸载撤监听 ---')
{
  const listeners = new Set()
  const root = {
    addEventListener(type, listener) {
      if (type === 'wheel') listeners.add(listener)
    },
    removeEventListener(type, listener) {
      listeners.delete(listener)
    },
  }
  const slides = []
  const off = installPaletteWheel(root, (rows) => slides.push(rows))
  const fire = (overrides = {}) => {
    const event = {
      deltaY: 0,
      deltaMode: 0,
      ctrlKey: false,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true
      },
      ...overrides,
    }
    for (const listener of [...listeners]) listener(event)
    return event
  }
  const one = fire({ deltaY: 1 })
  check('1px 滑一行', slides, [1])
  check('滚轮被浮层吃掉', one.defaultPrevented, true)
  fire({ deltaY: 300 })
  check('300px 也只滑一行', slides, [1, 1])
  fire({ deltaY: 3, deltaMode: 1 })
  check('行模式同样一格一行', slides, [1, 1, 1])
  const pinch = fire({ deltaY: 20, ctrlKey: true })
  check('捏合手势放行', [slides.length, pinch.defaultPrevented], [3, false])
  fire({ deltaY: 0 })
  check('零位移不动', slides.length, 3)
  off()
  check('卸载撤掉滚轮监听', listeners.size, 0)
  check('wheelStep 只看方向', [wheelStep(1), wheelStep(120), wheelStep(-1)], [1, 1, -1])
}

console.log('--- O⑦ 设置页:列表、当前、只读、目录错误与不可用 ---')
{
  const data = makeData()
  const actions = { loadCatalog: async () => {}, add: async () => {}, remove: async () => {} }
  const html = renderToStaticMarkup(React.createElement(ModelSettingsSection, { data, actions }))
  checkTrue('设置页根标记', html.includes(`${SETTINGS_ROOT_ATTR}=""`))
  checkTrue('标题', html.includes('模型快速切换'))
  checkTrue('快捷键说明', html.includes('⌘⌥U') && html.includes('Ctrl+Alt+U'))
  checkTrue('当前会话', html.includes('当前会话：DeepSeek Chat · DeepSeek · High'))
  checkTrue('三个已添加项', html.includes('3 个'))
  checkTrue('删除按钮', html.includes('从列表删除 DeepSeek Chat'))
  checkTrue('目录外的项在设置页也标出来', html.includes('目录外'))
  checkTrue('添加按钮', html.includes('添加模型'))

  data.set({ current: null })
  checkTrue('没有显式选择时说明跟随默认', renderToStaticMarkup(React.createElement(ModelSettingsSection, { data, actions })).includes('跟随默认（DeepSeek Chat · DeepSeek）'))
  data.set({ current: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }, writable: false })
  checkTrue('只读提示', renderToStaticMarkup(React.createElement(ModelSettingsSection, { data, actions })).includes('只读'))
  data.set({ writable: true, catalogError: 'connection lost' })
  checkTrue('目录错误可见', renderToStaticMarkup(React.createElement(ModelSettingsSection, { data, actions })).includes('connection lost'))
  data.set({ catalogError: null, configStatus: 'unavailable' })
  checkTrue('命名空间不可用提示', renderToStaticMarkup(React.createElement(ModelSettingsSection, { data, actions })).includes('没有提供本插件的设置命名空间'))

  const empty = createModelDataStore()
  empty.set({ choices: [], groups: orderCatalogGroups(GROUPS), configStatus: 'ready', writable: true })
  const emptyHtml = renderToStaticMarkup(React.createElement(ModelSettingsSection, { data: empty, actions }))
  checkTrue('空列表提示', emptyHtml.includes('还没有添加模型'))
  checkTrue('空列表也有添加入口', emptyHtml.includes('添加模型'))
}

console.log('--- O⑧ 设置页:模型目录按提供方分组、显示推理强度 ---')
{
  const data = createModelDataStore()
  data.set({
    choices: [],
    groups: orderCatalogGroups(GROUPS),
    configStatus: 'ready',
    writable: true,
  })
  const actions = { loadCatalog: async () => {}, add: async () => {}, remove: async () => {} }
  // 目录面板默认收起；这里直接验证展开所需的模型行投影由 `flattenCatalog` 提供。
  const catalog = flattenCatalog(orderCatalogGroups(GROUPS))
  check('模型行按目录展开', catalog.map((row) => row.provider), ['deepseek', 'opencode-go'])
  check('推理强度名单', catalog[0].efforts.map((effort) => effort.name ?? effort.id), ['Low', 'High'])
  check('提供方名', catalog.map((row) => row.providerName), ['DeepSeek', 'OpenCode Go'])
  const html = renderToStaticMarkup(React.createElement(ModelSettingsSection, { data, actions }))
  checkTrue('收起时提示可以添加', html.includes('添加模型'))
}

finish()
