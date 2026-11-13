/**
 * 点击判定、全屏切换条件与捕获监听的装配行为。
 *
 * 运行：`node test/fullscreen.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  clickElement,
  fullscreenReviewAfterOpen,
  installChangesReviewFullscreen,
  panelMode,
  reviewOpenButton,
} from '../src/fullscreen.ts'
import {
  CARD_SELECTOR,
  FakeDocument,
  FakeElement,
  MARKER_ATTRIBUTE,
  REVIEW_KIND,
  check,
  checkTrue,
  clickEvent,
  fakeSidebar,
  finish,
} from './helpers.mjs'

/** 一张改动文件卡片：标题按钮、一个文件行、一个带 aria-expanded 的折叠按钮。 */
function card() {
  const root = new FakeElement('div', { 'data-changed-files': '' })
  const header = root.append(new FakeElement('button'))
  const headerText = header.append(new FakeElement('span'))
  const row = root.append(new FakeElement('button'))
  const rowText = row.append(new FakeElement('span'))
  const toggle = root.append(new FakeElement('button', { 'aria-expanded': 'false' }))
  return { root, header, headerText, row, rowText, toggle }
}

console.log('--- U① 只认打开审查页的按钮 ---')
{
  const { root, header, headerText, row, rowText, toggle } = card()
  checkTrue('标题里的文字归到标题按钮', reviewOpenButton(headerText) === header)
  checkTrue('文件行的文字归到文件行按钮', reviewOpenButton(rowText) === row)
  check('折叠按钮带 aria-expanded：不认', reviewOpenButton(toggle), null)
  check('卡片外的按钮：不认', reviewOpenButton(new FakeElement('button')), null)
  check('没有 closest 的目标：不认', reviewOpenButton({}), null)
  check('null：不认', reviewOpenButton(null), null)

  const disabled = root.append(new FakeElement('button'))
  disabled.disabled = true
  check('disabled 按钮：不认', reviewOpenButton(disabled), null)
  const ariaDisabled = root.append(new FakeElement('button', { 'aria-disabled': 'true' }))
  check('aria-disabled 按钮：不认', reviewOpenButton(ariaDisabled), null)
}

console.log('--- U② clickElement：取组合路径上的第一个元素 ---')
{
  const { rowText } = card()
  checkTrue('composedPath 优先', clickElement(clickEvent(rowText)) === rowText)
  const target = new FakeElement('span')
  checkTrue('没有 composedPath 时退回 target', clickElement({ target }) === target)
  check('没有目标：null', clickElement({ target: null }), null)
}

console.log('--- U③ 呈现方式读数 ---')
{
  check('push', panelMode(new FakeDocument({ mode: 'push' })), 'push')
  check('fullscreen', panelMode(new FakeDocument({ mode: 'fullscreen' })), 'fullscreen')
  check('没有面板', panelMode(new FakeDocument({ mode: 'none' })), undefined)
  check('当前是 push，另一个会话视图是全屏：仍读 push',
    panelMode(new FakeDocument({ mode: 'push', hiddenMode: 'fullscreen' })), 'push')
  check('当前是全屏，另一个会话视图是 push：仍读 fullscreen',
    panelMode(new FakeDocument({ mode: 'fullscreen', hiddenMode: 'push' })), 'fullscreen')
}

console.log('--- U④ 打开之后：push + 审查页 + 当前 dock 面板才切全屏 ---')
{
  const doc = new FakeDocument({ mode: 'push' })
  const sidebar = fakeSidebar()
  check('切换', fullscreenReviewAfterOpen(sidebar, doc), true)
  check('调用一次 toggleFullscreen', sidebar.calls, [['fullscreen', { host: 'dock' }]])
  check('按活动 dock 面板解析（传 null）', sidebar.commandTargets, [null])

  const already = new FakeDocument({ mode: 'fullscreen' })
  const alreadySidebar = fakeSidebar()
  check('已经是全屏：不切', fullscreenReviewAfterOpen(alreadySidebar, already), false)
  check('不调用', alreadySidebar.calls, [])

  // 切换会话后，上一个会话的视图仍可能留在 DOM 里（hidden）；不能拿它的 push 标记把当前全屏切回去。
  const previousPush = new FakeDocument({ mode: 'fullscreen', hiddenMode: 'push' })
  const currentSidebar = fakeSidebar()
  check('另一个会话视图是 push：当前全屏不动', fullscreenReviewAfterOpen(currentSidebar, previousPush), false)
  check('不调用', currentSidebar.calls, [])

  const absent = new FakeDocument({ mode: 'none' })
  check('读不到面板：不动作', fullscreenReviewAfterOpen(fakeSidebar(), absent), false)

  check('右栏折叠：不动作', fullscreenReviewAfterOpen(fakeSidebar({ expanded: false }), doc), false)
  check('活动标签页不是审查页：不动作', fullscreenReviewAfterOpen(fakeSidebar({ activeKind: 'forge-panel' }), doc), false)
  check('没有活动标签页：不动作', fullscreenReviewAfterOpen(fakeSidebar({ activeKind: null }), doc), false)
  check('目标是浮动面板：不动作', fullscreenReviewAfterOpen(fakeSidebar({ target: { host: 'float' } }), doc), false)
  check('目标已陈旧：不动作', fullscreenReviewAfterOpen(fakeSidebar({ current: false }), doc), false)
  const noTarget = fakeSidebar()
  noTarget.commandTarget = () => undefined
  check('没有目标：不动作', fullscreenReviewAfterOpen(noTarget, doc), false)

  check('只切 changes-review', REVIEW_KIND, 'changes-review')
  check('卡片锚点', CARD_SELECTOR, '[data-changed-files]')
}

console.log('--- U⑤ 捕获监听：点击卡片后排一次微任务，折叠按钮与卡片外不动 ---')
{
  const doc = new FakeDocument({ mode: 'push' })
  const sidebar = fakeSidebar()
  const callbacks = []
  const dispose = installChangesReviewFullscreen(sidebar, { schedule: (callback) => callbacks.push(callback) }, doc)

  check('注册 click 捕获监听', [...doc.types], ['click'])
  check('写入生效标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), '')

  const { rowText, toggle } = card()
  doc.dispatch('click', clickEvent(rowText))
  check('排了一次动作', callbacks.length, 1)
  check('动作尚未执行', sidebar.calls, [])
  callbacks.shift()()
  check('执行后切全屏', sidebar.calls, [['fullscreen', { host: 'dock' }]])

  doc.dispatch('click', clickEvent(toggle))
  check('折叠按钮不排动作', callbacks.length, 0)

  doc.dispatch('click', clickEvent(new FakeElement('button')))
  check('卡片外不排动作', callbacks.length, 0)

  dispose()
  check('卸载后无监听', doc.types, [])
  check('卸载后移除标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
}

console.log('--- U⑥ 连续点击只排一次，避免把刚打开的全屏又切回去 ---')
{
  const doc = new FakeDocument({ mode: 'push' })
  const sidebar = fakeSidebar()
  const callbacks = []
  installChangesReviewFullscreen(sidebar, { schedule: (callback) => callbacks.push(callback) }, doc)
  const { rowText } = card()
  doc.dispatch('click', clickEvent(rowText))
  doc.dispatch('click', clickEvent(rowText))
  check('只排一次', callbacks.length, 1)
  callbacks.shift()()
  check('只切一次', sidebar.calls.length, 1)
}

finish()
