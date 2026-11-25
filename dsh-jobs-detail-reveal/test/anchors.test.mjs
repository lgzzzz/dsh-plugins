/**
 * `src/anchors.ts` 的行为测试：在「会话面板 → 后台任务列表 → 行（外层还有 HoverCard 的
 * span）→ 展开按钮 / 详情」这棵真实结构上认锚点。
 *
 * 替身的选择器只认 `tag` 与 `tag[attr]`；`querySelector` 按整串查表，贴近上游生成的结构。
 * 跑全部请用 `node test/run-all.mjs`（或 `pnpm test`）。
 */
import {
  PANEL_SELECTOR,
  isRowExpanded,
  jobDetailOf,
  jobRowOf,
  rowToggleOf,
  sessionPanelOf,
} from '../src/anchors.ts'
import { check, finish, fakeElement } from './helpers.mjs'

/** 把 child 挂到 parent 下（只回填 parentElement，不登记选择器表）。 */
function connect(parent, child) {
  child.parentElement = parent
  return child
}

/** 搭一棵和上游渲染一致的树。 */
function buildRow({ withDetail = true, expanded = 'true' } = {}) {
  const panel = fakeElement({ tag: 'aside', attributes: { 'data-session-panel': 'docked' }, rect: { top: 12, height: 600 } })
  const list = fakeElement({ tag: 'ul', attributes: { 'data-jobs-section': '' } })
  const item = fakeElement({ tag: 'li', rect: { top: 490, height: 340 } })
  // 任务行的外层是 HoverCard 的锚点容器 `<span>`，行是它的子元素。
  const wrapper = fakeElement({ tag: 'span' })
  const row = fakeElement({ tag: 'div', attributes: { 'data-job-row': '' }, rect: { top: 500, height: 28 } })
  const toggle = fakeElement({ tag: 'button', attributes: { 'aria-expanded': expanded } })
  const stop = fakeElement({ tag: 'button', attributes: { 'aria-label': '停止任务 bash …' } })
  const chevron = fakeElement({ tag: 'span' })
  const detail = fakeElement({ tag: 'div', rect: { top: 528, height: 300 } })
  const terminal = fakeElement({ tag: 'div', attributes: { 'data-terminal': '' } })

  connect(panel, list)
  connect(list, item)
  connect(item, wrapper)
  connect(wrapper, row)
  row.attach('button[aria-expanded]', toggle)
  connect(row, stop)
  connect(row, chevron)
  connect(toggle, fakeElement({ tag: 'span', attributes: { 'aria-hidden': 'true' } }))
  connect(item, detail)
  if (withDetail) {
    connect(detail, terminal)
    // 详情里终端卡片是后代；替身的 querySelector 按登记表直接命中。
    item.children['[data-terminal]'] = terminal
  }
  return { panel, list, item, wrapper, row, toggle, stop, chevron, detail, terminal }
}

// ---- 从点击目标往上认 ------------------------------------------------------

{
  const dom = buildRow()
  check('从展开按钮认出会话面板', sessionPanelOf(dom.toggle) === dom.panel, true)
  check('从展开按钮认出任务行', jobRowOf(dom.toggle) === dom.row, true)
  check('点展开按钮命中它自己', rowToggleOf(dom.toggle) === dom.toggle, true)
  check('点停止按钮不算点展开按钮', rowToggleOf(dom.stop) === null, true)
  check('点行里的箭头不算点展开按钮', rowToggleOf(dom.chevron) === null, true)
  check('读展开状态', isRowExpanded(dom.row), true)
  dom.toggle.setAttribute('aria-expanded', 'false')
  check('读收起状态', isRowExpanded(dom.row), false)
  // 按钮里套图标时，点击目标是图标本身。
  const icon = fakeElement({ tag: 'span', attributes: { 'aria-hidden': 'true' } })
  connect(dom.toggle, icon)
  check('点按钮里的图标也算点按钮', rowToggleOf(icon) === dom.toggle, true)
}

// ---- 面板外的东西一律不认 ------------------------------------------------

{
  const dom = buildRow()
  const outside = fakeElement({ tag: 'button', attributes: { 'aria-expanded': 'true' } })
  check('面板外的按钮认不出任务行', jobRowOf(outside) === null, true)
  check('面板外的按钮认不出面板', sessionPanelOf(outside) === null, true)
  check('面板外的按钮不算展开按钮', rowToggleOf(outside) === null, true)
}

// ---- 详情定位 ------------------------------------------------------------

{
  const dom = buildRow()
  const targets = jobDetailOf(dom.row, dom.panel)
  check('详情定位成功', targets !== null, true)
  check('详情是 <li> 的直接子元素（不是行的 nextElementSibling）', targets.detail === dom.detail, true)
  check('<li> 取自任务行', targets.item === dom.item, true)
  check('行与面板原样带出', targets.row === dom.row && targets.panel === dom.panel, true)
}

{
  const dom = buildRow({ withDetail: false })
  check('详情还没挂载时不认', jobDetailOf(dom.row, dom.panel), null)
}

{
  const dom = buildRow()
  const other = fakeElement({ tag: 'aside', attributes: { 'data-session-panel': 'overlay' } })
  check('行不在这块面板里时不认', jobDetailOf(dom.row, other), null)
}

{
  // 终端卡片在另一个 <li> 里：结构对不上，不认。
  const dom = buildRow({ withDetail: false })
  const stray = fakeElement({ tag: 'div', attributes: { 'data-terminal': '' } })
  dom.panel.children['[data-terminal]'] = stray
  connect(dom.panel, stray)
  check('终端卡片不在这个 <li> 里时不认', jobDetailOf(dom.row, dom.panel), null)
}

check('采集选择器是面板根属性', PANEL_SELECTOR, '[data-session-panel]')

finish()
