/**
 * C 运行时与发送:核对 `src/notify-runtime.ts` 的订阅装配、前台判定与退订,
 * 以及 `src/notify-delivery.ts` 构造浏览器通知的方式与兜底。
 *
 * 运行:`node test/notify-runtime.test.mjs`(或 pnpm test 跑全部)。
 */
import { startNotifyRuntime } from '../src/notify-runtime.ts'
import { createBrowserDelivery } from '../src/notify-delivery.ts'
import { check, checkTrue, finish, ROWS } from './helpers.mjs'

function fakeRuntime(options = {}) {
  const listeners = new Set()
  let statuses = new Map()
  const delivered = []
  const source =
    options.broken === true
      ? undefined
      : {
          getSnapshot: () => (options.undefinedSnapshot === true ? undefined : statuses),
          subscribe: (listener) => {
            listeners.add(listener)
            return () => {
              listeners.delete(listener)
            }
          },
        }
  const services = {
    uiSession: source === undefined ? undefined : { sessionStatus: source },
    sessions: {
      list: {
        getSnapshot: () => ({ byId: options.rows ?? ROWS }),
      },
    },
    slots: undefined,
  }
  const store = {
    isActive: () => options.active !== false,
  }
  let pageActive = options.pageActive === true
  const dispose = startNotifyRuntime({
    services,
    store,
    isPageActive: () => pageActive,
    deliver: (plan) => delivered.push(plan),
  })
  return {
    delivered,
    dispose,
    setPageActive: (value) => {
      pageActive = value
    },
    push(statusEntries) {
      statuses = new Map(statusEntries)
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
}

console.log('--- C. 运行时与发送(notify-runtime / notify-delivery)---')

{
  const runtime = fakeRuntime({ broken: true })
  checkTrue('服务面缺席返回 disposer', typeof runtime.dispose === 'function')
  runtime.dispose()
  check('服务面缺席不发通知', runtime.delivered, [])
}

{
  const runtime = fakeRuntime({ undefinedSnapshot: true })
  runtime.push([['s-1', { running: true }]])
  check('状态表 undefined 时不抛且不发', runtime.delivered, [])
}

{
  const runtime = fakeRuntime({ pageActive: true })
  runtime.push([['s-1', { running: true }]])
  runtime.push([['s-1', { running: false }]])
  check('页面在前台 → 不发', runtime.delivered, [])

  runtime.setPageActive(false)
  runtime.push([['s-1', { running: true }]])
  runtime.push([['s-1', { running: false }]])
  check('页面转后台 → 发一条', runtime.delivered.length, 1)
  check('交付内容为回合完成', runtime.delivered[0]?.reason, 'turn-complete')
}

{
  const runtime = fakeRuntime({ active: false })
  runtime.push([['s-1', { running: true }]])
  runtime.push([['s-1', { running: false }]])
  check('未开启时不发', runtime.delivered, [])
}

{
  const runtime = fakeRuntime()
  runtime.push([['s-1', { running: true }]])
  runtime.push([['s-1', { running: false }]])
  check('订阅生命周期内正常发送', runtime.delivered.length, 1)
  check('订阅已登记', runtime.listenerCount(), 1)
  runtime.dispose()
  check('dispose 退订', runtime.listenerCount(), 0)
  runtime.push([['s-1', { running: true }]])
  runtime.push([['s-1', { running: false }]])
  check('dispose 后不再发送', runtime.delivered.length, 1)
}

{
  const built = []
  class FakeNotification {
    constructor(title, options) {
      this.title = title
      this.options = options
      this.onclick = null
      this.closed = false
      built.push(this)
    }
    close() {
      this.closed = true
    }
  }
  let focused = 0
  const win = { Notification: FakeNotification, focus: () => { focused += 1 } }
  const doc = { visibilityState: 'hidden', hasFocus: () => false }
  const delivery = createBrowserDelivery(win, doc)
  checkTrue('标签页不可见 → 不在前台', delivery.isPageActive() === false)

  doc.visibilityState = 'visible'
  doc.hasFocus = () => true
  checkTrue('可见且聚焦 → 在前台', delivery.isPageActive() === true)
  doc.visibilityState = 'visible'
  doc.hasFocus = () => false
  checkTrue('可见但失焦 → 不在前台', delivery.isPageActive() === false)

  delivery.deliver({ sessionId: 's-1', reason: 'turn-complete', title: 't', body: 'b', tag: 'tag-1' })
  check('构造了一条通知', built.length, 1)
  check('通知标题', built[0].title, 't')
  check('通知带 tag', built[0].options.tag, 'tag-1')
  checkTrue('同 tag 重复提醒已打开', built[0].options.renotify === true)
  checkTrue('onclick 已挂', typeof built[0].onclick === 'function')
  built[0].onclick()
  check('点击通知聚焦窗口', focused, 1)
  checkTrue('点击后关闭通知', built[0].closed === true)

  const throwing = createBrowserDelivery({ Notification: class { constructor() { throw new Error('denied') } }, focus: () => {} }, doc)
  throwing.deliver({ sessionId: 's-1', reason: 'question', title: 't', body: 'b', tag: 'tag-2' })
  console.log('ok   构造抛错时静默(已记账到 console.warn)')

  const missing = createBrowserDelivery({ focus: () => {} }, doc)
  missing.deliver({ sessionId: 's-1', reason: 'question', title: 't', body: 'b', tag: 'tag-3' })
  console.log('ok   环境无 Notification 时 no-op')
}

finish()
