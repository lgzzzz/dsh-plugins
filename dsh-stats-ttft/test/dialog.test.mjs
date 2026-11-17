/**
 * 气泡正文还原：只认带 `dl[data-session-stats-details]` 标记的会话统计面板，
 * 在文本节点上把「按钮读数」改回「全会话读数」；不做元素替换，重复调用幂等。
 *
 * 运行：`node test/dialog.test.mjs`（或 pnpm test 跑全部）。
 */
import { installDialogPatch, patchDialogText } from '../src/dialog.ts'
import { check, checkFalse, checkTrue, finish } from './helpers.mjs'

/** 文本节点替身。 */
class FakeText {
  constructor(value) {
    this.nodeType = 3
    this.nodeValue = value
    this.childNodes = []
  }
}

/** 元素节点替身：只实现本模块用到的查询与包含判定。 */
class FakeElement {
  constructor(tag, { attrs = {}, children = [] } = {}) {
    this.nodeType = 1
    this.tag = tag
    this.attrs = attrs
    this.children = children
    this.childNodes = children
    this.nodeValue = null
    for (const child of children) child.parent = this
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.nodeType !== 1) continue
      if (selector === 'dl[data-session-stats-details]' && child.tag === 'dl' && 'data-session-stats-details' in child.attrs) {
        return child
      }
      const hit = child.querySelector(selector)
      if (hit !== null) return hit
    }
    return null
  }

  contains(node) {
    if (node === this) return true
    for (const child of this.children) {
      if (child.nodeType === 1 && child.contains(node)) return true
    }
    return false
  }
}

/** 记录回调与观察参数的假 MutationObserver。 */
class FakeObserver {
  static last = null

  constructor(callback) {
    this.callback = callback
    this.observed = null
    this.disconnected = false
    FakeObserver.last = this
  }

  observe(target, options) {
    this.observed = { target, options }
  }

  disconnect() {
    this.disconnected = true
  }

  emit(records) {
    this.callback(records)
  }
}

/** 一个会话统计气泡：标题值 + 带标记的正文（速度行）。 */
function activityDialog({ counts = '12 轮 34 步 · 2.3秒', speed = '45 tok/s', marked = true } = {}) {
  const dl = new FakeElement('dl', {
    attrs: marked ? { 'data-session-stats-details': '' } : {},
    children: [
      new FakeElement('dt', { children: [new FakeText('输出速度')] }),
      new FakeElement('dd', { children: [new FakeText(speed)] }),
    ],
  })
  return new FakeElement('div', {
    attrs: { role: 'dialog' },
    children: [
      new FakeElement('div', {
        children: [
          new FakeElement('span', { children: [new FakeText('会话统计')] }),
          new FakeElement('span', { children: [new FakeText(counts)] }),
        ],
      }),
      dl,
    ],
  })
}

/** 读面板里的标题值与速度行文本。 */
function textsOf(dialog) {
  const title = dialog.children[0]
  const dd = dialog.children[1].children[1]
  return { title: title.children[1].children[0].nodeValue, speed: dd.children[0].nodeValue }
}

/** 取标题值那个文本节点，模拟 React 的重写。 */
function titleNode(dialog) {
  return dialog.children[0].children[1].children[0]
}

/** 取速度行那个文本节点，模拟 React 的重写。 */
function speedNode(dialog) {
  return dialog.children[1].children[1].children[0]
}

const TEXTS = {
  countsFrom: '12 轮 34 步 · 2.3秒',
  countsTo: '12 轮 34 步',
  speedFrom: '45 tok/s',
  speedTo: '60 tok/s',
}

console.log('--- A 文本节点还原 ---')
{
  const dialog = activityDialog()
  checkTrue('确认改写', patchDialogText(dialog, TEXTS))
  check('标题值回到全会话计数', textsOf(dialog).title, '12 轮 34 步')
  check('速度行回到全会话 TPS', textsOf(dialog).speed, '60 tok/s')
  checkFalse('重复调用幂等', patchDialogText(dialog, TEXTS))
}

console.log('--- B 保护范围 ---')
{
  const unmarked = activityDialog({ marked: false })
  checkFalse('无正文标记的面板不改', patchDialogText(unmarked, TEXTS))
  check('用量气泡保持原样', textsOf(unmarked).title, '12 轮 34 步 · 2.3秒')

  const onlySpeed = activityDialog()
  checkTrue('只还原速度', patchDialogText(onlySpeed, { ...TEXTS, countsFrom: null, countsTo: null }))
  check('标题不动', textsOf(onlySpeed).title, '12 轮 34 步 · 2.3秒')
  check('速度已还原', textsOf(onlySpeed).speed, '60 tok/s')

  const noop = activityDialog()
  checkFalse('同一对文本不写', patchDialogText(noop, { ...TEXTS, countsTo: TEXTS.countsFrom, speedFrom: null, speedTo: null }))
  checkFalse('四对都缺席时不动', patchDialogText(noop, { countsFrom: null, countsTo: null, speedFrom: null, speedTo: null }))
}

/** 假 document：body 直接挂气泡面板，可选 observer。 */
function fakeDocument({ withObserver = true } = {}) {
  return {
    body: new FakeElement('body'),
    defaultView: withObserver ? { MutationObserver: FakeObserver } : {},
  }
}

/** 把气泡挂到 body 上并返回它。 */
function mount(doc, dialog) {
  doc.body.children.push(dialog)
  return dialog
}

console.log('--- C 安装、插入与同步 ---')
{
  FakeObserver.last = null
  const doc = fakeDocument()
  const mounted = mount(doc, activityDialog())
  let current = TEXTS
  const controller = installDialogPatch(doc, () => current)
  check('挂载时已有的气泡也还原', textsOf(mounted).speed, '60 tok/s')
  checkTrue('观察 body', FakeObserver.last.observed.target === doc.body)
  check('观察选项', FakeObserver.last.observed.options, { childList: true, subtree: true })

  const inserted = mount(doc, activityDialog())
  FakeObserver.last.emit([{ addedNodes: [inserted] }])
  check('新插入的气泡还原', textsOf(inserted).speed, '60 tok/s')

  // React 重写文本节点后，包装层带着新读数再同步一次。
  current = {
    countsFrom: '15 轮 40 步 · 1.8秒',
    countsTo: '15 轮 40 步',
    speedFrom: '46 tok/s',
    speedTo: '62 tok/s',
  }
  titleNode(inserted).nodeValue = '15 轮 40 步 · 1.8秒'
  speedNode(inserted).nodeValue = '46 tok/s'
  controller.sync()
  check('React 重写标题后同步还原', textsOf(inserted).title, '15 轮 40 步')
  check('React 重写速度后同步还原', textsOf(inserted).speed, '62 tok/s')
}

console.log('--- D 卸载与缺席 ---')
{
  FakeObserver.last = null
  const doc = fakeDocument()
  const dialog = mount(doc, activityDialog())
  const controller = installDialogPatch(doc, () => TEXTS)
  controller.dispose()
  checkTrue('卸载断开观察', FakeObserver.last.disconnected)
  speedNode(dialog).nodeValue = '45 tok/s'
  controller.sync()
  check('卸载后不再改写', textsOf(dialog).speed, '45 tok/s')

  const missing = installDialogPatch(undefined, () => TEXTS)
  missing.sync()
  missing.dispose()

  FakeObserver.last = null
  const plain = fakeDocument({ withObserver: false })
  const bare = mount(plain, activityDialog())
  installDialogPatch(plain, () => TEXTS)
  check('没有 observer 时初始同步仍还原', textsOf(bare).speed, '60 tok/s')

  const headless = installDialogPatch({ defaultView: {} }, () => TEXTS)
  headless.sync()
  headless.dispose()
}

console.log('--- E 移除后淘汰 ---')
{
  const doc = fakeDocument()
  const dialog = mount(doc, activityDialog())
  const controller = installDialogPatch(doc, () => TEXTS)
  doc.body.children.length = 0
  speedNode(dialog).nodeValue = '45 tok/s'
  controller.sync()
  check('从 body 摘掉的面板不再改写', textsOf(dialog).speed, '45 tok/s')
}

finish()
