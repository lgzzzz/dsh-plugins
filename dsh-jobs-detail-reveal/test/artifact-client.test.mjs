/**
 * 产物装配：把 `lib/client.js` 当成浏览器里的独立 bundle 加载，验证模块 id / 插件名 /
 * apply 的作用域，并在替身 window 上跑一遍「点开详情 → 滚动 + 加高 → 卸载还原」。
 *
 * 这一层测的是**构建产物**：TS 擦除、打包边界、`window.__ModuleLoader__` 外壳是否都对。
 * 运行：`node test/artifact-client.test.mjs`（或 `pnpm test` 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fakeElement, finish, pluginRoot } from './helpers.mjs'

/** 载入产物并返回它的插件对象。 */
function loadPlugin() {
  let registration = null
  globalThis.window = {
    __ModuleLoader__: {
      load: (value) => { registration = value },
    },
  }
  try {
    // eslint-disable-next-line no-eval
    ;(0, eval)(readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8'))
  } finally {
    delete globalThis.window
  }
  if (registration === null) throw new Error('bundle 没有注册到 __ModuleLoader__')
  return registration.factory((id) => {
    throw new Error(`产物要求了未声明的外部模块：${id}`)
  })
}

/** 让 child 的 parentElement 指向 parent（不登记选择器表）。 */
function connect(parent, child) {
  child.parentElement = parent
  return child
}

/** 最小 window 替身：与 reveal.test.mjs 同一套接口，rAF 手动推进。 */
function fakeWindow({ innerHeight = 800 } = {}) {
  const listeners = new Map()
  const queue = []
  const cancelled = new Set()
  let nextId = 1
  const win = {
    innerHeight,
    resizeObservers: [],
    addEventListener(type, fn) { listeners.set(type, fn) },
    removeEventListener(type) { listeners.delete(type) },
    listener(type) { return listeners.get(type) },
    requestAnimationFrame(fn) {
      const id = nextId++
      queue.push({ id, fn })
      return id
    },
    cancelAnimationFrame(id) { cancelled.add(id) },
    getComputedStyle(element) {
      const override = element.style.getPropertyValue('max-height')
      return {
        paddingTop: element.computed?.paddingTop ?? '0px',
        paddingBottom: element.computed?.paddingBottom ?? '0px',
        maxHeight: override !== '' ? override : (element.computed?.maxHeight ?? 'none'),
      }
    },
    runFrames(count) {
      let ran = 0
      while (ran < count) {
        const index = queue.findIndex(item => !cancelled.has(item.id))
        if (index === -1) break
        const [{ fn }] = queue.splice(index, 1)
        fn(0)
        ran += 1
      }
      return ran
    },
  }
  win.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      win.resizeObservers.push(this)
    }
    observe(element) { this.element = element }
    disconnect() { this.disconnected = true }
    fire() { this.callback([]) }
  }
  return win
}

/** 搭「面板 → 列表 → 行（外套 HoverCard span）+ 详情」。 */
function buildDom({ naturalMaxHeight = '200px', itemHeight = 340, rowTop = 500 } = {}) {
  const panel = fakeElement({ tag: 'aside', attributes: { 'data-session-panel': 'docked' }, rect: { top: 12, height: 600 } })
  panel.computed = { paddingTop: '6px', paddingBottom: '6px', maxHeight: naturalMaxHeight }
  const list = fakeElement({ tag: 'ul', attributes: { 'data-jobs-section': '' } })
  const item = fakeElement({ tag: 'li', rect: { top: rowTop - 10, height: itemHeight } })
  const wrapper = fakeElement({ tag: 'span' })
  const row = fakeElement({ tag: 'div', attributes: { 'data-job-row': '' }, rect: { top: rowTop, height: 28 } })
  const toggle = fakeElement({ tag: 'button', attributes: { 'aria-expanded': 'false' } })
  const detail = fakeElement({ tag: 'div', rect: { height: itemHeight - 30 } })
  const terminal = fakeElement({ tag: 'div', attributes: { 'data-terminal': '' } })
  connect(panel, list)
  connect(list, item)
  connect(item, wrapper)
  connect(wrapper, row)
  row.attach('button[aria-expanded]', toggle)
  connect(item, detail)
  connect(detail, terminal)
  return { panel, item, row, toggle, terminal }
}

console.log('--- A：bundle 注册与插件声明 ---')
const plugin = loadPlugin()
check('模块 id', plugin.id ?? plugin.name, 'dsh-jobs-detail-reveal')
check('插件名', plugin.name, 'dsh-jobs-detail-reveal')
check('apply 是函数', typeof plugin.apply, 'function')
check('不声明额外 inject', plugin.inject, undefined)

console.log('--- B：apply 装上行为，点开详情就滚动 + 加高 ---')
const win = fakeWindow({ innerHeight: 800 })
const dom = buildDom()
let cleanup
let effectLabel
globalThis.window = win
try {
  plugin.apply({
    effect: (callback, label) => {
      effectLabel = label
      cleanup = callback()
    },
  })
  check('effect 标签带插件名', effectLabel, 'dsh-jobs-detail-reveal: reveal job detail')
  check('装上点击监听', typeof win.listener('click'), 'function')

  win.listener('click')({ target: dom.toggle })
  dom.toggle.setAttribute('aria-expanded', 'true')
  dom.item.children['[data-terminal]'] = dom.terminal
  win.runFrames(1)
  // 行 + 详情 340，加面板上下内边距 12；视口 800、面板顶 12，够放。
  check('产物按需加高面板', dom.panel.style.getPropertyValue('max-height'), '352px')
  check('产物把行顶到面板顶部', dom.panel.scrollTop, 500 - 12 - 6)
} finally {
  delete globalThis.window
}

console.log('--- C：卸载还原 ---')
check('cleanup 是函数', typeof cleanup, 'function')
cleanup()
check('卸载后撤掉加高', dom.panel.style.size, 0)
check('卸载后撤掉监听', win.listener('click'), undefined)
check('卸载时断开观察者', win.resizeObservers.at(-1)?.disconnected, true)

finish()
