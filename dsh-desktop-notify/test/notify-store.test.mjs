/**
 * B 开关 store:核对 `src/notify-store.ts` 的授权与开关状态 —— 点击开关时如何
 * 申请权限、何时落盘、refresh 如何读外部授权,以及异常兜底。
 *
 * 运行:`node test/notify-store.test.mjs`(或 pnpm test 跑全部)。
 */
import { createNotifyStore } from '../src/notify-store.ts'
import { check, checkTrue, finish } from './helpers.mjs'

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

console.log('--- B. 开关 store(notify-store)---')

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

finish()
