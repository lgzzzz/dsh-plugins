/**
 * dsh-changes-behavior 评论框键盘测试的共享装置：断言与失败计数、可带 fiber 的假元素、
 * 假文档、评论框夹具与假按键。
 *
 * 跑全部请用 `node test/run-all.mjs`（或 pnpm test）。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */

let failures = 0

/** 已失败的断言数。 */
export function failureCount() {
  return failures
}

export function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e}，实得 ${a}`}`)
}

export function checkTrue(label, actual) {
  const ok = actual === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 true，实得 ${JSON.stringify(actual)}`}`)
}

/** 打印本文件的结论并设置退出码。每个测试文件末尾调用一次。 */
export function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/** 文档根元素的假替身：记录 data-* 标记。 */
export class FakeRootElement {
  constructor() {
    this.attributes = new Map()
  }

  setAttribute(name, value) {
    this.attributes.set(name, value)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }
}

/** 记录捕获阶段监听、根标记的假文档。 */
export class FakeDocument {
  constructor() {
    this.listeners = new Map()
    this.documentElement = new FakeRootElement()
  }

  addEventListener(type, listener, capture) {
    const list = this.listeners.get(type) ?? []
    list.push({ listener, capture })
    this.listeners.set(type, list)
  }

  removeEventListener(type, listener, capture) {
    const list = (this.listeners.get(type) ?? []).filter(
      (item) => item.listener !== listener || item.capture !== capture,
    )
    if (list.length === 0) this.listeners.delete(type)
    else this.listeners.set(type, list)
  }

  /** 派发给该类型的全部监听（本插件只挂捕获阶段）。 */
  dispatch(type, event) {
    for (const item of this.listeners.get(type) ?? []) item.listener(event)
  }

  /** 当前有监听的事件类型。 */
  get types() {
    return [...this.listeners.keys()]
  }
}

/** 属性、结构、文案、fiber 与连接态都可查询的假元素。 */
export class FakeElement {
  constructor(tag = 'div', attributes = {}, options = {}) {
    this.tag = tag
    this.attributes = new Map(Object.entries(attributes))
    this.parent = null
    this.children = []
    this.textContent = options.textContent ?? ''
    this.value = options.value
    this.disabled = options.disabled ?? false
    this.isConnected = options.isConnected ?? true
    if (options.handler !== undefined) {
      this['__reactFiber$fake'] = { memoizedProps: { onClick: options.handler } }
    }
    if (options.fiber !== undefined) {
      this['__reactFiber$fake'] = options.fiber
    }
  }

  append(child) {
    child.parent = this
    this.children.push(child)
    return child
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  setAttribute(name, value) {
    this.attributes.set(name, value)
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  closest(selector) {
    for (let node = this; node !== null; node = node.parent) {
      if (matchesSelector(node, selector)) return node
    }
    return null
  }

  querySelectorAll(selector) {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }
}

/** 选择器只覆盖本项目用到的三种：`tag` / `[attr]` / `[attr="value"]`。 */
function matchesSelector(node, selector) {
  const valued = selector.match(/^\[([a-zA-Z-]+)="([^"]*)"\]$/)
  if (valued !== null) return node.getAttribute(valued[1]) === valued[2]
  const present = selector.match(/^\[([a-zA-Z-]+)\]$/)
  if (present !== null) return node.hasAttribute(present[1])
  return node.tag === selector
}

/**
 * 一个完整的行内评论框夹具：section + textarea + 取消 / 添加到输入框两个按钮，
 * 并在 section 的上一层 fiber 上挂 `ReviewComposer` 的 props。
 *
 * @param options.text - textarea 的当前文本。
 * @param options.label - 「添加到输入框」按钮的文案（假 `t` 会对同一个 key 返回它）。
 * @param options.addKey - 文案 key；默认 `review.addToInput`。
 * @param options.withQuoteCopy - 是否把 key 放进 `actions.quoteCopy.add`（模拟上游改 key）。
 * @param options.withProps - false 时不给 section 挂 fiber，模拟取不到 props。
 * @param options.withTranslate - false 时 props 上没有 `t`。
 * @param options.addEnabled - 「添加到输入框」按钮的禁用态。
 * @param options.addThrows - 「添加到输入框」的 onClick 抛错。
 */
export function composerFixture(options = {}) {
  const text = options.text ?? '这行看起来没问题'
  const label = options.label ?? '添加到输入框'
  const addKey = options.addKey ?? 'review.addToInput'
  const calls = []
  const section = new FakeElement('section', { 'data-forge-comment': 'R3-4' })
  const field = section.append(new FakeElement('textarea', {}, { value: text }))
  const title = section.append(new FakeElement('div', {}, { textContent: 'R3-4' }))
  section.append(new FakeElement('button', {}, { textContent: '取消', handler: () => { calls.push('cancel') } }))
  section.append(new FakeElement('button', {}, {
    textContent: label,
    disabled: options.addEnabled === false,
    handler: () => {
      calls.push('add')
      if (options.addThrows === true) throw new Error('boom')
    },
  }))
  const props = {
    selection: { source: { kind: 'local' }, comment: { path: 'src/a.ts', side: 'R', startLine: 3, endLine: 4, body: '' } },
    actions: {
      addToInput: () => true,
      quoteCopy: options.withQuoteCopy === true ? { add: addKey } : undefined,
    },
    close: () => { calls.push('close') },
    t: options.withTranslate === false
      ? undefined
      : (key) => (key === addKey ? label : key),
  }
  if (options.withProps !== false) {
    // 宿主 fiber 的 props 是 DOM 属性，真正的组件 props 在上一层。
    section['__reactFiber$fake'] = { memoizedProps: { 'data-forge-comment': 'R3-4' }, return: { memoizedProps: props } }
  }
  return { section, field, title, props, calls }
}

/** 假按键：记录 `preventDefault` / `stopPropagation`。 */
export function keyEvent(target, options = {}) {
  return {
    target,
    key: options.key ?? 'Enter',
    keyCode: options.keyCode ?? 0,
    isComposing: options.isComposing ?? false,
    repeat: options.repeat ?? false,
    shiftKey: options.shiftKey ?? false,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    altKey: options.altKey ?? false,
    defaultPrevented: options.defaultPrevented ?? false,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
      this.defaultPrevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
  }
}
