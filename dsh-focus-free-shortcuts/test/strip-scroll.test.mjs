/**
 * S 页签行滚动(`src/strip-scroll.ts`):注入的规则文本与作用面、标签的单例 / 复用 / 卸载,
 * 经插件装配时的安装与释放,以及切页前后的"观察窗口保持"(采集 / 还原 / 最小推移 / 让位)。
 *
 * 两套假 document 各司其职:注入那一半只实现 `head.append` / `createElement('style')` /
 * 按 `data-plugin-css` 认领标签的 `querySelector`;窗口那一半用 `helpers.fakeDocument`,
 * 页签行的几何由 `stripFixture` 按"每颗 100 宽、盒宽 300、矩形随 scrollLeft 移动"给出。
 */
import { check, checkTrue, fakeDocument, FakeElement, fakePageSidebar, finish, gesture, harness, keydown, PAGE_CYCLE_ID, PAGE_PREVIOUS_PRESS, shortcutContext } from './helpers.mjs'
import { captureStripScroll, installInstantStripScroll, restoreStripScroll, STRIP_SCROLL_CSS, STRIP_SCROLL_STYLE_ID, STRIP_SCROLL_STYLE_SELECTOR } from '../src/strip-scroll.ts'

/**
 * 假 style 元素:`dataset` 是注入端的写入口,`getAttribute` 复刻"属性名 ↔ dataset 驼峰"的
 * 真实映射,让 `querySelector` 的认领判据与浏览器一致。
 */
class FakeStyleElement {
  constructor() {
    this.dataset = {}
    this.textContent = ''
    this.removed = 0
    this.parent = null
  }
  getAttribute(name) {
    if (!name.startsWith('data-')) return null
    const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    return this.dataset[key] ?? null
  }
  remove() {
    this.removed += 1
    if (this.parent !== null) {
      const index = this.parent.children.indexOf(this)
      if (index >= 0) this.parent.children.splice(index, 1)
      this.parent = null
    }
  }
}

/** 只有 `head` / `createElement` / `querySelector` 的假 document,外加一段可挂载的 style。 */
function fakeStyleDocument() {
  const children = []
  const head = {
    children,
    append(element) {
      element.parent = head
      children.push(element)
      return element
    },
  }
  return {
    head,
    createElement: () => new FakeStyleElement(),
    querySelectorAll: () => [],
    querySelector(selector) {
      const wanted = /^style\[data-plugin-css="([^"]*)"\]$/.exec(selector)
      if (wanted === null) return null
      return children.find((element) => element.getAttribute('data-plugin-css') === wanted[1]) ?? null
    },
  }
}

/** 一个只带 `effect` 的假 Cordis 上下文,复刻该模块用到的契约。 */
function effectContext() {
  const effects = []
  return {
    effects,
    effect(execute, label) {
      const dispose = execute()
      effects.push({ label, dispose })
      return { dispose }
    },
  }
}

/** 在假 document 下跑一段安装逻辑,返回各次认领的释放函数;用完即还原 document。 */
function withStyleDocument(run) {
  const previous = globalThis.document
  const document = fakeStyleDocument()
  globalThis.document = document
  try {
    return run(document)
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

/** 每颗芯片的宽度与盒子的可视宽度:盒里恰好放得下三颗。 */
const CHIP_WIDTH = 100
const BOX_WIDTH = 300

/**
 * 一条假页签行:会话根 > chip box > 芯片。几何按"每颗 100 宽、盒宽 300、矩形随 scrollLeft
 * 平移"给出,所以 `getBoundingClientRect()` 的读数与真实布局一致。
 * @param ids - 页签 id,按渲染顺序。
 * @param boxId - chip box 的 `data-dockkit-strip-tabs` 值(所属 pane)。
 * @param left - 初始 scrollLeft。
 * @param chipBox - 假条带不存在时(浮动 pane)传 false:芯片直接挂在会话根下。
 */
function stripFixture({ ids = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'], boxId = 'p1', left = 0, chipBox = true, sessionId = 's1' } = {}) {
  const root = new FakeElement('div', { 'data-sidebar-right-session': sessionId })
  const holder = chipBox ? root.append(new FakeElement('div', { 'data-dockkit-strip-tabs': boxId })) : root
  holder.scrollLeft = left
  for (const [index, id] of ids.entries()) {
    const chip = holder.append(new FakeElement('div', { 'data-dockkit-tab': id }))
    chip.getBoundingClientRect = () => ({
      left: index * CHIP_WIDTH - holder.scrollLeft,
      right: (index + 1) * CHIP_WIDTH - holder.scrollLeft,
    })
  }
  holder.getBoundingClientRect = () => ({ left: 0, right: BOX_WIDTH })
  return { root, box: holder }
}

/** 用 `helpers.fakeDocument` 跑一段窗口逻辑;用完即还原 document。 */
function withStripDocument(root, run) {
  const previous = globalThis.document
  globalThis.document = fakeDocument({ root })
  try {
    return run()
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

/** 装上假 document(带手泵 rAF 队列);`pump()` 把这一帧的 rAF 回调跑完。 */
function installFrameDom(root) {
  const previousDocument = globalThis.document
  const previousRaf = globalThis.requestAnimationFrame
  const queue = []
  globalThis.document = fakeDocument({ root })
  globalThis.requestAnimationFrame = (fn) => {
    queue.push(fn)
    return queue.length
  }
  return {
    pump() {
      while (queue.length > 0) queue.shift()()
    },
    restore() {
      if (previousDocument === undefined) delete globalThis.document
      else globalThis.document = previousDocument
      if (previousRaf === undefined) delete globalThis.requestAnimationFrame
      else globalThis.requestAnimationFrame = previousRaf
    },
  }
}

console.log('--- S① 规则文本:只作用于右侧栏的页签行,并把缓动关掉 ---')
{
  checkTrue('锚在 kit 的 chip box 标记上', STRIP_SCROLL_CSS.includes('[data-sidebar-right-session] [data-dockkit-strip-tabs]'))
  checkTrue('把滚动改成瞬时', /scroll-behavior:\s*auto/.test(STRIP_SCROLL_CSS))
  checkTrue('不用 !important(特异性已经够)', !STRIP_SCROLL_CSS.includes('!important'))
  checkTrue('不按哈希类名定位', !STRIP_SCROLL_CSS.includes('stripTabs'))
  check('认领选择器', STRIP_SCROLL_STYLE_SELECTOR, `style[data-plugin-css="${STRIP_SCROLL_STYLE_ID}"]`)
}

console.log('--- S② 安装:插入一个带认领标记的标签 ---')
{
  withStyleDocument((document) => {
    const ctx = effectContext()
    installInstantStripScroll(ctx)
    check('只插一个标签', document.head.children.length, 1)
    const tag = document.head.children[0]
    check('插件标记', tag.dataset.plugin, 'dsh-focus-free-shortcuts')
    check('认领标记', tag.dataset.pluginCss, STRIP_SCROLL_STYLE_ID)
    check('标签内容就是规则', tag.textContent, STRIP_SCROLL_CSS)
    check('登记了一个 effect', ctx.effects.length, 1)
    check('effect 标签可读', ctx.effects[0].label, 'dsh-focus-free-shortcuts: instant strip scroll')
    // 每节都把自己的认领放干净:持有者计数是模块级的,跨节共享。
    ctx.effects[0].dispose()
    check('释放后摘掉标签', document.head.children.length, 0)
  })
}

console.log('--- S③ 共享与卸载:多个持有者共用一个标签,最后一个才摘掉 ---')
{
  withStyleDocument((document) => {
    const first = effectContext()
    const second = effectContext()
    installInstantStripScroll(first)
    installInstantStripScroll(second)
    check('两个持有者仍只有一个标签', document.head.children.length, 1)
    const tag = document.head.children[0]

    first.effects[0].dispose()
    check('还有持有者时不摘标签', document.head.children.length, 1)
    check('标签未被移除', tag.removed, 0)

    second.effects[0].dispose()
    check('最后一个持有者卸载后摘掉标签', document.head.children.length, 0)
    check('标签被移除一次', tag.removed, 1)

    second.effects[0].dispose()
    check('重复释放无副作用', tag.removed, 1)
  })
}

console.log('--- S④ 复用:同一文档里已有同一份规则就不再插第二个 ---')
{
  withStyleDocument((document) => {
    const existing = document.createElement('style')
    existing.dataset.pluginCss = STRIP_SCROLL_STYLE_ID
    existing.textContent = STRIP_SCROLL_CSS
    document.head.append(existing)

    const ctx = effectContext()
    installInstantStripScroll(ctx)
    check('复用时不再插入', document.head.children.length, 1)
    checkTrue('复用的仍是原来那个', document.head.children[0] === existing)

    ctx.effects[0].dispose()
    check('复用来的标签不由本实例摘除', [document.head.children.length, existing.removed], [1, 0])
  })
}

console.log('--- S⑤ 退化:没有 document / document 承载不了标签时都不抛 ---')
{
  const previous = globalThis.document
  delete globalThis.document
  try {
    const ctx = effectContext()
    installInstantStripScroll(ctx)
    check('登记了一个 effect', ctx.effects.length, 1)
    checkTrue('释放函数可调用', typeof ctx.effects[0].dispose === 'function')
    ctx.effects[0].dispose()
    checkTrue('释放后不再持有', typeof ctx.effects[0].dispose === 'function')
  } finally {
    if (previous !== undefined) globalThis.document = previous
  }

  // 极简 document(如各桥测试的假文档):只有选择查询,没有 head / createElement。
  globalThis.document = { querySelector: () => null, querySelectorAll: () => [] }
  try {
    const ctx = effectContext()
    installInstantStripScroll(ctx)
    check('承载不了标签时也照常登记 effect', ctx.effects.length, 1)
    ctx.effects[0].dispose()
    checkTrue('释放函数可调用', typeof ctx.effects[0].dispose === 'function')
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

console.log('--- S⑥ 经插件装配:装上,释放全部 effect 后摘掉 ---')
{
  withStyleDocument((document) => {
    const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1' })
    const { ctx } = harness({ sidebar })
    check('装配后插入了规则标签', document.head.children.length, 1)
    check('标签内容就是规则', document.head.children[0].textContent, STRIP_SCROLL_CSS)
    for (const effect of ctx.effects) {
      if (typeof effect.dispose === 'function') effect.dispose()
    }
    check('卸载后摘掉标签', document.head.children.length, 0)
  })
}

console.log('--- S⑦ 注入失败模式:缺 document 时经插件装配也不抛、不告警 ---')
{
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1' })
  const { ctx, shortcuts, warnings } = harness({ sidebar })
  check('缺 document 时装配无告警', warnings, [])
  checkTrue('页面循环固定行照常挂载', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === PAGE_CYCLE_ID))
  for (const effect of ctx.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
}

console.log('--- S⑧ 采集:记下活动页芯片所在条带与它的 scrollLeft ---')
{
  const { root } = stripFixture({ left: 400 })
  withStripDocument(root, () => {
    check('记下所属条带与位置', captureStripScroll('s1', 't7'), { boxId: 'p1', left: 400 })
    check('这个页面没渲染', captureStripScroll('s1', 'tx'), undefined)
    check('没有活动页', captureStripScroll('s1', undefined), undefined)
  })

  // 同一个 tab id、但属于别的会话根:不跨会话比较(各面的 id 各自铸造)。
  const other = stripFixture({ left: 400, sessionId: 's2' })
  withStripDocument(other.root, () => check('别的会话的芯片不认', captureStripScroll('s1', 't7'), undefined))

  // 浮动 pane:芯片不在任何 chip box 里。
  const floating = stripFixture({ chipBox: false })
  withStripDocument(floating.root, () => check('浮动 pane 没有条带', captureStripScroll('s1', 't7'), undefined))

  check('没有 document', captureStripScroll('s1', 't7'), undefined)
}

console.log('--- S⑨ 还原 + 最小推移:以旧窗口为起点,目标不可见时才动、且只动最小距离 ---')
{
  // 旧窗口 400(容 t5/t6/t7 三颗)。新 chip box 从 0 开始。
  const cases = [
    ['t7', 400, '原来那颗:零位移'],
    ['t6', 400, '左邻:零位移,来源 t7 仍在视野里'],
    ['t5', 400, '窗口最左那颗:零位移'],
    ['t2', 76, '左外侧:最小左移(留 24px 余量)'],
    ['t9', 624, '右外侧:最小右移(留 24px 余量)'],
  ]
  for (const [target, expected, label] of cases) {
    const { root, box } = stripFixture({ left: 0 })
    withStripDocument(root, () => {
      restoreStripScroll({ boxId: 'p1', left: 400 }, 's1', target)
      check(label, box.scrollLeft, expected)
    })
  }
}

console.log('--- S⑩ 让位:跨 pane / 目标未渲染 / 没有窗口 / 浮动 pane / 没有 document ---')
{
  const crossed = stripFixture({ boxId: 'p2', left: 0 })
  withStripDocument(crossed.root, () => {
    restoreStripScroll({ boxId: 'p1', left: 400 }, 's1', 't6')
    check('跨 pane 不动作', crossed.box.scrollLeft, 0)
  })

  const missing = stripFixture({ left: 0 })
  withStripDocument(missing.root, () => {
    restoreStripScroll({ boxId: 'p1', left: 400 }, 's1', 'tx')
    check('目标未渲染不动作', missing.box.scrollLeft, 0)
  })

  const untouched = stripFixture({ left: 250 })
  withStripDocument(untouched.root, () => {
    restoreStripScroll(undefined, 's1', 't6')
    check('没有窗口时不动作', untouched.box.scrollLeft, 250)
  })

  const floating = stripFixture({ chipBox: false })
  withStripDocument(floating.root, () => {
    restoreStripScroll({ boxId: 'p1', left: 400 }, 's1', 't6')
    checkTrue('浮动 pane 不抛', true)
  })

  restoreStripScroll({ boxId: 'p1', left: 400 }, 's1', 't6')
  checkTrue('没有 document 不抛', true)
}

console.log('--- S⑪ 接线:切页前记窗口,focus 重建 chip box,下一帧还回去 ---')
{
  const { root, box } = stripFixture({ left: 400 })
  const sidebar = fakePageSidebar({ list: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'], active: 't7' })
  const focus = sidebar.focus.bind(sidebar)
  // 模拟"选中变化 = chip box 重建":focus 之后新的盒子从 0 开始。
  sidebar.focus = (tabId) => {
    focus(tabId)
    box.scrollLeft = 0
  }
  const dom = installFrameDom(root)
  try {
    const { shortcuts } = harness({ sidebar })
    const press = keydown(PAGE_PREVIOUS_PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('切到上一页', sidebar.focusCalls, ['t6'])
    check('这一刻新 chip box 还是从 0 开始的', box.scrollLeft, 0)
    dom.pump()
    check('下一帧把旧窗口还回去(目标就在窗内 → 零位移)', box.scrollLeft, 400)
    check('照常消费这一按', press.consumed.count, 1)
  } finally {
    dom.restore()
  }
}

console.log('--- S⑫ 接线让位:折叠 / 单页时不采也不还 ---')
{
  const { root, box } = stripFixture({ left: 400 })
  const sidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1', expanded: false })
  const dom = installFrameDom(root)
  try {
    const { shortcuts } = harness({ sidebar })
    shortcuts.emit(keydown(gesture('ArrowLeft', { control: true, alt: true }), shortcutContext({ target: null })).input)
    dom.pump()
    check('折叠时不切页也不动条带', [sidebar.focusCalls.length, box.scrollLeft], [0, 400])
  } finally {
    dom.restore()
  }
}

finish()
