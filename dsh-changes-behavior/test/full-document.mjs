/**
 * 总装测试的共享装置：覆盖全部读写面的假文档、观察器、多文件卡片与假右栏面。
 */
import { FakeDocument, FakeElement, fakeSidebar } from './card-helpers.mjs'

/** 观察器替身：记录观察目标与断开状态。 */
export class FakeObserver {
  static instances = []

  constructor(callback) {
    this.callback = callback
    this.observed = []
    this.disconnected = false
    FakeObserver.instances.push(this)
  }

  observe(target, options) {
    this.observed.push({ target, options })
  }

  disconnect() {
    this.disconnected = true
  }

  static reset() {
    FakeObserver.instances = []
  }
}

/** 覆盖本插件全部读写面的假文档。 */
export class FullDocument extends FakeDocument {
  constructor() {
    super()
    this.body = new FakeElement('div')
    this.defaultView = { innerWidth: 1440, MutationObserver: FakeObserver }
    this.head = {
      child: null,
      appendChild(node) { this.child = node },
      removeChild() { this.child = null },
    }
    this.createElement = (tag) => ({
      tag,
      dataset: {},
      textContent: '',
      remove() { this.removed = true },
    })
  }
}

/** 多文件卡片：标题 + 一行文件。 */
export function multiCard() {
  const card = new FakeElement('div', { 'data-changed-files': '' })
  const header = card.append(new FakeElement('button'))
  const list = card.append(new FakeElement('ul'))
  const row = list.append(new FakeElement('li'))
  const rowButton = row.append(new FakeElement('button', { 'aria-describedby': 'p-0' }))
  return { card, header, rowButton }
}

/** 带按会话打开入口的假右栏面。 */
export function fakePolicySidebar(options = {}) {
  const sidebar = fakeSidebar(options)
  sidebar.inOpened = []
  sidebar.openResourceIn = (sessionId, address) => {
    sidebar.inOpened.push([sessionId, address])
  }
  sidebar.openTabIn = (sessionId, kind) => {
    sidebar.inOpened.push([sessionId, kind])
  }
  return sidebar
}
