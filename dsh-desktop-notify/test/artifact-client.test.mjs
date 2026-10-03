/**
 * D 构建产物装配:把 `lib/client.js` 装进 ModuleLoader 桩与假 React,核对插件
 * 导出面、inject / 注册项、设置行渲染、通知链路与 disposer 退订。
 *
 * 运行:`node test/artifact-client.test.mjs`(或 pnpm test 跑全部)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, checkTrue, finish, pluginRoot, ROWS } from './helpers.mjs'

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
}

function loadBundle(options = {}) {
  const calls = { inject: [], register: [], effects: [], removedFocus: 0, addedFocus: 0 }
  const notifications = []
  let statuses = new Map()
  let listener = null

  class FakeNotification {
    constructor(title, notificationOptions) {
      this.title = title
      this.options = notificationOptions
      this.onclick = null
      this.closed = false
      notifications.push(this)
    }
    close() {
      this.closed = true
    }
  }

  const storage = new Map()
  if (options.stored !== undefined) storage.set('dsh.desktop-notify.enabled', options.stored ? '1' : '0')
  FakeNotification.permission = options.permission ?? 'default'

  const win = {
    Notification: options.supported === false ? undefined : FakeNotification,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
    },
    focus: () => {},
    addEventListener: (type) => {
      if (type === 'focus') calls.addedFocus += 1
    },
    removeEventListener: (type) => {
      if (type === 'focus') calls.removedFocus += 1
    },
  }
  const doc = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
    visibilityState: 'hidden',
    hasFocus: () => false,
  }

  const services = {
    sessions: { list: { getSnapshot: () => ({ byId: options.rows ?? ROWS }) } },
    uiSession: {
      sessionStatus: {
        getSnapshot: () => statuses,
        subscribe: (next) => {
          listener = next
          return () => {
            listener = null
          }
        },
      },
    },
    slots: {
      inject: (key, callback) => {
        calls.inject.push(key)
        callback()
      },
      register: (registerOptions, component) => {
        calls.register.push({ options: registerOptions, component })
        return {}
      },
    },
  }
  const ctx = {
    get: (name) => services[name],
    effect: (callback) => {
      calls.effects.push(callback())
    },
  }

  let loaded = null
  win.__ModuleLoader__ = {
    load: (spec) => {
      loaded = spec
    },
  }

  const source = readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8')
  const required = []
  const run = new Function('window', 'document', 'console', source)
  run(win, doc, console)
  const module = loaded.factory((id) => {
    required.push(id)
    if (id === 'react') return fakeReact
    throw new Error(`产物要求了未声明的外部模块:${id}`)
  })

  module.apply(ctx)

  return {
    calls,
    notifications,
    required,
    module,
    loaded,
    storage,
    push(entries) {
      statuses = new Map(entries)
      if (listener !== null) listener()
    },
    pushUndefined() {
      statuses = undefined
      if (listener !== null) listener()
    },
    listenerCount: () => (listener === null ? 0 : 1),
    hasNotificationCtor: win.Notification !== undefined,
  }
}

console.log('--- D. 构建产物装配(lib/client.js + ModuleLoader 桩)---')

{
  const bundle = loadBundle({ permission: 'granted' })
  check('产物 id', bundle.loaded.id, 'dsh-desktop-notify')
  check('客服入口包名', bundle.module.name, 'dsh-desktop-notify')
  check('inject 声明', bundle.module.inject, ['sessions', 'uiSession', 'slots'])
  check('react 是唯一外部依赖', bundle.required, ['react'])
  check('挂到设置-通用条目区', bundle.calls.inject, ['settings.general.item'])
  check('注册项 id', bundle.calls.register[0]?.options.id, 'desktop-notify')
  check('注册项 name', bundle.calls.register[0]?.options.name, 'settings.general.item')
  check('注册项 order', bundle.calls.register[0]?.options.order, 30)
  checkTrue('注册项有组件', typeof bundle.calls.register[0]?.component === 'function')
  check('注册了一个 fiber disposer', bundle.calls.effects.length, 1)
  check('已在窗口上登记 focus 监听', bundle.calls.addedFocus, 1)

  const element = bundle.calls.register[0].component()
  check('开关行是 div 元素', element.type, 'div')
  check('开关行类名', element.props.className, 'dsh-desktop-notify-setting')
  check('行左侧文案列', element.children[0]?.props?.className, 'dsh-desktop-notify-setting-text')
  check('行标题', element.children[0]?.children[0]?.children[0], '桌面通知')
  checkTrue('行描述非空', typeof element.children[0]?.children[1]?.children[0] === 'string')
  const control = element.children[1]
  check('控件是 switch', [control.type, control.props.role], ['button', 'switch'])
  check('已授权且开启 → aria-checked', control.props['aria-checked'], true)
  checkTrue('switch 已挂 onclick', typeof control.props.onClick === 'function')
  checkTrue('带圆形滑块', control.children[0]?.props?.className === 'dsh-desktop-notify-switch-thumb')

  bundle.push([['s-1', { running: true }]])
  bundle.push([['s-1', { running: false }]])
  check('后台时发出系统通知', bundle.notifications.length, 1)
  check('通知标题', bundle.notifications[0].title, 'DSH · 回合完成')
  check('通知正文', bundle.notifications[0].options.body, '修复登录 bug')
  checkTrue('通知 onclick 已挂', typeof bundle.notifications[0].onclick === 'function')

  bundle.push([['s-1', { running: false, pendingInteraction: { key: 'q1', kind: 'question', questions: [{ question: '选哪个?' }] } }]])
  check('待答也发系统通知', bundle.notifications.length, 2)
  check('待答通知标题', bundle.notifications[1].title, 'DSH · 需要你回答')

  bundle.pushUndefined()
  check('状态表变 undefined 不抛', bundle.notifications.length, 2)

  check('订阅已登记', bundle.listenerCount(), 1)
  bundle.calls.effects[0]()
  check('disposer 退订', bundle.listenerCount(), 0)
  check('disposer 撤销 focus 监听', bundle.calls.removedFocus, 1)
}

{
  const bundle = loadBundle({ permission: 'default' })
  const element = bundle.calls.register[0].component()
  const control = element.children[1]
  check('未授权 → aria-checked false', control.props['aria-checked'], false)
  check('未授权可点击', control.props.disabled, false)
  checkTrue('未授权提示先授权', control.props.title.includes('开启桌面通知'))
  checkTrue('未授权行描述提到授权', element.children[0].children[1].children[0].includes('授权'))

  bundle.push([['s-1', { running: true }]])
  bundle.push([['s-1', { running: false }]])
  check('未授权时不发通知', bundle.notifications, [])
}

{
  const bundle = loadBundle({ permission: 'denied' })
  const element = bundle.calls.register[0].component()
  const control = element.children[1]
  check('已拒绝 → aria-checked false', control.props['aria-checked'], false)
  check('已拒绝 disabled', control.props.disabled, true)
  checkTrue('已拒绝提示去站点设置', control.props.title.includes('网站设置'))
  checkTrue('已拒绝行描述指向站点设置', element.children[0].children[1].children[0].includes('站点设置'))
}

{
  const bundle = loadBundle({ permission: 'granted', stored: false })
  const element = bundle.calls.register[0].component()
  check('开关关着 → aria-checked false', element.children[1].props['aria-checked'], false)
  bundle.push([['s-1', { running: true }]])
  bundle.push([['s-1', { running: false }]])
  check('开关关着不发通知', bundle.notifications, [])
}

{
  const bundle = loadBundle({ supported: false })
  checkTrue('无 Notification API 时开关行渲染空', bundle.calls.register[0].component() === null)
  bundle.push([['s-1', { running: true }]])
  bundle.push([['s-1', { running: false }]])
  check('无 Notification API 时不发通知', bundle.notifications, [])
}

{
  const bundle = loadBundle({ permission: 'granted' })
  bundle.push([['s-2', { running: true }]])
  bundle.push([['s-2', { running: false }]])
  check('子代理结束不发通知', bundle.notifications, [])
}

finish()
