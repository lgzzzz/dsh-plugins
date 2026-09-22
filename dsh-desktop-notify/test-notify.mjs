/**
 * 诊断脚本(非插件产物):纯 Node,无浏览器。四部分:
 *   A. src/notify-policy.ts —— 相邻两帧差异 → 通知计划的全部判定分支;
 *   B. src/notify-store.ts —— 授权 / 开关 / 拒绝 / 重读权限的环境缝分支;
 *   C. src/notify-runtime.ts + src/notify-delivery.ts —— 订阅驱动、前台抑制、开关未开时基线仍推进、dispose;
 *   D. 构建产物 lib/client.js —— 以 window.__ModuleLoader__ 桩载入,校验包名 / inject / 外部依赖只有 react、
 *      槽位注册参数、设置开关行三态渲染,以及「后台回合结束 → 真发一条系统通知」的端到端装配。
 * 直接以 Node Type Stripping 载入 src/*.ts(不加载 notify-settings.ts:它 require('react'))。
 * 用法:node test-notify.mjs(需先 npm run build)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createNotifyPolicy } from './src/notify-policy.ts'
import { createNotifyStore } from './src/notify-store.ts'
import { startNotifyRuntime } from './src/notify-runtime.ts'
import { createBrowserDelivery } from './src/notify-delivery.ts'

const here = dirname(fileURLToPath(import.meta.url))

let failures = 0
/** 断言并按仓库脚本惯例记账。 */
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

/** 断言布尔条件(用于含对象引用的判定)。 */
function checkTrue(label, actual) {
  const ok = actual === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 true,实得 ${JSON.stringify(actual)}`}`)
}

/** 造一帧输入:statuses 用 [[id, status]] 数组,rows 用对象。 */
function frame(entries, rows) {
  return { statuses: new Map(entries), rows: rows ?? {} }
}

const ROWS = {
  's-1': { id: 's-1', displayTitle: '修复登录 bug' },
  's-2': { id: 's-2', displayTitle: '子会话', origin: 'subagent' },
}

console.log('--- A. 判定器(notify-policy)---')

{
  const policy = createNotifyPolicy()
  // 首帧:已经跑着的回合 + 已经等着的卡片都不补发
  const first = policy.observe(frame([['s-1', { running: true, pendingInteraction: { key: 'q0', kind: 'question' } }]], ROWS))
  check('首帧只建基线', first, [])

  const done = policy.observe(frame([['s-1', { running: false }]], ROWS))
  check('running true → false 发回合完成', done.length, 1)
  check('回合完成原因', done[0]?.reason, 'turn-complete')
  check('回合完成标题', done[0]?.title, 'DSH · 回合完成')
  check('回合完成正文取 displayTitle', done[0]?.body, '修复登录 bug')
  check('回合完成 tag 带会话与原因', done[0]?.tag, 'dsh-notify:s-1:turn-complete')

  check('同帧重放无差异 → 不发', policy.observe(frame([['s-1', { running: false }]], ROWS)), [])
  check('running false → true 不发', policy.observe(frame([['s-1', { running: true }]], ROWS)), [])
}

{
  const policy = createNotifyPolicy()
  policy.observe(frame([['s-2', { running: true }]], ROWS))
  check('子代理会话不发', policy.observe(frame([['s-2', { running: false }]], ROWS)), [])
}

{
  const policy = createNotifyPolicy()
  policy.observe(frame([['ghost', { running: true }]], ROWS))
  check('列表里查不到的行不发', policy.observe(frame([['ghost', { running: false }]], ROWS)), [])
}

{
  const policy = createNotifyPolicy()
  policy.observe(frame([['s-1', { running: true }]], ROWS))
  const plans = policy.observe(
    frame([['s-1', { running: true, pendingInteraction: { key: 'q1', kind: 'question', sessionId: 's-1', questions: [{ question: '要用哪个数据库?' }] } }]], ROWS),
  )
  check('待回答出现 → 发一条', plans.length, 1)
  check('待回答原因', plans[0]?.reason, 'question')
  check('待回答标题', plans[0]?.title, 'DSH · 需要你回答')
  check('待回答正文 = 标题 + 首题', plans[0]?.body, '修复登录 bug · 要用哪个数据库?')

  const same = policy.observe(
    frame([['s-1', { running: true, pendingInteraction: { key: 'q1', kind: 'question', questions: [{ question: '要用哪个数据库?' }] } }]], ROWS),
  )
  check('同一 key 不重复发', same, [])

  const replaced = policy.observe(
    frame([['s-1', { running: true, pendingInteraction: { key: 'q2', kind: 'question', questions: [{ header: '第二个问题' }] } }]], ROWS),
  )
  check('换新 key → 再发', replaced.length, 1)
  check('题面回退到 header', replaced[0]?.body, '修复登录 bug · 第二个问题')

  const cleared = policy.observe(frame([['s-1', { running: true }]], ROWS))
  check('交互消失不发', cleared, [])
  const again = policy.observe(
    frame([['s-1', { running: true, pendingInteraction: { key: 'q2', kind: 'question', questions: [{ question: '又来了' }] } }]], ROWS),
  )
  check('消失后又出现同一 key → 再发', again.length, 1)
}

{
  const policy = createNotifyPolicy()
  policy.observe(frame([['s-1', {}]], ROWS))
  const approval = policy.observe(
    frame([['s-1', { running: true, pendingInteraction: { key: 'a1', kind: 'approval', toolName: 'git push', reason: '推送到远程' } }]], ROWS),
  )
  check('审批原因', approval[0]?.reason, 'approval')
  check('审批标题', approval[0]?.title, 'DSH · 需要你审批')
  check('审批正文取工具 + 理由', approval[0]?.body, '修复登录 bug · git push · 推送到远程')

  const bare = createNotifyPolicy()
  bare.observe(frame([['s-1', {}]], ROWS))
  const noTool = bare.observe(frame([['s-1', { pendingInteraction: { key: 'a2', kind: 'approval' } }]], ROWS))
  check('审批缺工具名时的兜底正文', noTool[0]?.body, '修复登录 bug · 有一条工具调用等你决定')

  const plan = createNotifyPolicy()
  plan.observe(frame([['s-1', {}]], ROWS))
  const review = plan.observe(frame([['s-1', { pendingInteraction: { key: 'p1', kind: 'plan-review', questions: [{ detail: '计划正文' }] } }]], ROWS))
  check('计划评审原因', review[0]?.reason, 'plan-review')
  check('计划评审标题', review[0]?.title, 'DSH · 计划待确认')
  check('计划评审正文取 detail', review[0]?.body, '修复登录 bug · 计划正文')
}

{
  const long = 'x'.repeat(200)
  const policy = createNotifyPolicy()
  policy.observe(frame([['s-1', { running: true }]], { 's-1': { id: 's-1', displayTitle: long } }))
  const plans = policy.observe(frame([['s-1', { running: false }]], { 's-1': { id: 's-1', displayTitle: long } }))
  checkTrue('超长正文被截断到 96 字', plans[0].body.length === 96 && plans[0].body.endsWith('…'))

  const fallback = createNotifyPolicy()
  fallback.observe(frame([['s-x', { running: true }]], { 's-x': {} }))
  const noTitle = fallback.observe(frame([['s-x', { running: false }]], { 's-x': {} }))
  check('无标题时回退到会话 id', noTitle[0]?.body, 's-x')
}

{
  const policy = createNotifyPolicy()
  check('空状态表首帧安全', policy.observe(frame([])), [])
  check('空状态表后续帧安全', policy.observe(frame([])), [])
}

console.log('--- B. 开关 store(notify-store)---')

/** 造一个可断言的假环境。 */
function fakeEnv(options = {}) {
  const state = {
    supported: options.supported ?? true,
    permission: options.permission ?? 'default',
    requestResult: options.requestResult ?? 'granted',
    requests: 0,
    writes: [],
    stored: options.stored,
    listeners: 0,
  }
  const env = {
    get supported() {
      return state.supported
    },
    permission: () => state.permission,
    requestPermission: async () => {
      state.requests += 1
      state.permission = state.requestResult === 'granted' ? 'granted' : state.permission
      return state.requestResult
    },
    readEnabled: () => state.stored,
    writeEnabled: (enabled) => {
      state.stored = enabled
      state.writes.push(enabled)
    },
  }
  return { env, state }
}

{
  const { env, state } = fakeEnv({ supported: false, permission: 'granted' })
  const store = createNotifyStore(env)
  check('无 Notification API → unsupported', store.getSnapshot(), { permission: 'unsupported', enabled: true })
  checkTrue('unsupported 时 isActive 为 false', store.isActive() === false)
  await store.activate()
  check('unsupported 时点击不发请求', state.requests, 0)
}

{
  const { env, state } = fakeEnv({ permission: 'default' })
  const store = createNotifyStore(env)
  check('初始未授权', store.getSnapshot(), { permission: 'default', enabled: true })
  checkTrue('未授权时 isActive 为 false', store.isActive() === false)

  let notified = 0
  const unsubscribe = store.subscribe(() => {
    notified += 1
  })
  await store.activate()
  check('点击后授权', store.getSnapshot(), { permission: 'granted', enabled: true })
  check('授权走了一次 requestPermission', state.requests, 1)
  check('授权即开启并落盘', state.writes, [true])
  check('授权即时生效', notified, 1)
  checkTrue('授权后 isActive 为 true', store.isActive() === true)
  checkTrue('订阅函数形态正确', typeof unsubscribe === 'function')

  await store.activate()
  check('已授权后点击 = 关闭', store.getSnapshot(), { permission: 'granted', enabled: false })
  check('关闭落盘', state.writes, [true, false])
  checkTrue('关闭后 isActive 为 false', store.isActive() === false)

  await store.activate()
  check('再点一次 = 开启', store.getSnapshot(), { permission: 'granted', enabled: true })
  unsubscribe()
  await store.activate()
  check('退订后不再收到通知', notified, 3)
}

{
  const { env, state } = fakeEnv({ permission: 'denied' })
  const store = createNotifyStore(env)
  await store.activate()
  check('被拒绝后点击不重试', state.requests, 0)
  check('被拒绝保持 denied', store.getSnapshot().permission, 'denied')
  checkTrue('denied 时 isActive 为 false', store.isActive() === false)
}

{
  const { env } = fakeEnv({ permission: 'granted', stored: false })
  const store = createNotifyStore(env)
  check('上次关过 → 初始关闭', store.getSnapshot(), { permission: 'granted', enabled: false })
  checkTrue('持久化的关闭状态压过已授权', store.isActive() === false)
}

{
  const { env, state } = fakeEnv({ permission: 'default' })
  const store = createNotifyStore(env)
  state.permission = 'granted'
  store.refresh()
  check('refresh 读到外部授权', store.getSnapshot(), { permission: 'granted', enabled: true })
  checkTrue('refresh 后 isActive 为 true', store.isActive() === true)
  store.refresh()
  check('refresh 幂等', store.getSnapshot(), { permission: 'granted', enabled: true })
}

{
  const { env } = fakeEnv({ permission: 'granted' })
  env.requestPermission = async () => {
    throw new Error('boom')
  }
  const store = createNotifyStore({ ...env, permission: () => 'default' })
  await store.activate()
  check('requestPermission 抛错 → 保持未授权', store.getSnapshot().permission, 'default')
}

console.log('--- C. 运行时与发送(notify-runtime / notify-delivery)---')

/** 造一个可驱动的假状态源 + services。 */
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
  // 开关未开时基线仍要推进:开启后不该补发历史状态
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

  // 构造抛错:不冒泡
  const throwing = createBrowserDelivery({ Notification: class { constructor() { throw new Error('denied') } }, focus: () => {} }, doc)
  throwing.deliver({ sessionId: 's-1', reason: 'question', title: 't', body: 'b', tag: 'tag-2' })
  console.log('ok   构造抛错时静默(已记账到 console.warn)')

  const missing = createBrowserDelivery({ focus: () => {} }, doc)
  missing.deliver({ sessionId: 's-1', reason: 'question', title: 't', body: 'b', tag: 'tag-3' })
  console.log('ok   环境无 Notification 时 no-op')
}

console.log('--- D. 构建产物装配(lib/client.js + ModuleLoader 桩)---')

/** 最小 react 桩:只覆盖 createElement / useState / useEffect(与 src/react.d.ts 同面)。 */
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
}

/** 造一套 window / document / ctx 桩,并以 ModuleLoader 桩载入构建产物。 */
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

  const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
  const required = []
  // 产物顶层直接调用 window.__ModuleLoader__.load,故以参数遮蔽全局 window / document
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
    /** 驱动一帧状态表变化。 */
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

{
  const bundle = loadBundle({ permission: 'granted' })
  check('产物 id', bundle.loaded.id, 'dsh-desktop-notify')
  check('客服入口包名', bundle.module.name, 'dsh-desktop-notify')
  check('inject 声明', bundle.module.inject, ['sessions', 'uiSession', 'slots'])
  check('react 是唯一外部依赖', bundle.required, ['react'])
  check('挂到设置-通用条目区', bundle.calls.inject, ['settings.general.item'])
  check('注册项 id', bundle.calls.register[0]?.options.id, 'desktop-notify')
  check('注册项 name', bundle.calls.register[0]?.options.name, 'settings.general.item')
  // 30 = 聊天/回车行为(20)之后、当前版本(100)之前,见 src/client.ts 的 SETTINGS_ITEM_ORDER
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

  // 页面在后台:回合完成 → 真发一条系统通知
  bundle.push([['s-1', { running: true }]])
  bundle.push([['s-1', { running: false }]])
  check('后台时发出系统通知', bundle.notifications.length, 1)
  check('通知标题', bundle.notifications[0].title, 'DSH · 回合完成')
  check('通知正文', bundle.notifications[0].options.body, '修复登录 bug')
  checkTrue('通知 onclick 已挂', typeof bundle.notifications[0].onclick === 'function')

  // 待答卡片
  bundle.push([['s-1', { running: false, pendingInteraction: { key: 'q1', kind: 'question', questions: [{ question: '选哪个?' }] } }]])
  check('待答也发系统通知', bundle.notifications.length, 2)
  check('待答通知标题', bundle.notifications[1].title, 'DSH · 需要你回答')

  // 状态表变 undefined:不抛
  bundle.pushUndefined()
  check('状态表变 undefined 不抛', bundle.notifications.length, 2)

  // 语义化 disposer:退订 + 撤 focus 监听
  check('订阅已登记', bundle.listenerCount(), 1)
  bundle.calls.effects[0]()
  check('disposer 退订', bundle.listenerCount(), 0)
  check('disposer 撤销 focus 监听', bundle.calls.removedFocus, 1)
}

{
  // 未授权:switch 关着 + 提示先授权,且不发通知
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
  // 已拒绝:switch 禁用 + 指向 Chrome 设置的提示
  const bundle = loadBundle({ permission: 'denied' })
  const element = bundle.calls.register[0].component()
  const control = element.children[1]
  check('已拒绝 → aria-checked false', control.props['aria-checked'], false)
  check('已拒绝 disabled', control.props.disabled, true)
  checkTrue('已拒绝提示去站点设置', control.props.title.includes('网站设置'))
  checkTrue('已拒绝行描述指向站点设置', element.children[0].children[1].children[0].includes('站点设置'))
}

{
  // 已授权但用户关过开关:不发通知
  const bundle = loadBundle({ permission: 'granted', stored: false })
  const element = bundle.calls.register[0].component()
  check('开关关着 → aria-checked false', element.children[1].props['aria-checked'], false)
  bundle.push([['s-1', { running: true }]])
  bundle.push([['s-1', { running: false }]])
  check('开关关着不发通知', bundle.notifications, [])
}

{
  // 环境没有 Notification API:apply 仍装配成功,开关行渲染为空
  const bundle = loadBundle({ supported: false })
  checkTrue('无 Notification API 时开关行渲染空', bundle.calls.register[0].component() === null)
  bundle.push([['s-1', { running: true }]])
  bundle.push([['s-1', { running: false }]])
  check('无 Notification API 时不发通知', bundle.notifications, [])
}

{
  // 子代理会话:后台结束也不打扰
  const bundle = loadBundle({ permission: 'granted' })
  bundle.push([['s-2', { running: true }]])
  bundle.push([['s-2', { running: false }]])
  check('子代理结束不发通知', bundle.notifications, [])
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exitCode = failures === 0 ? 0 : 1
