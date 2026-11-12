/**
 * `⌘⌥Y` / `Ctrl+Alt+Y` 变更页桥：有本地变更打开「本地变更」，否则打开「变更请求」。
 *
 * 只装配本桥，不跑整个 client，便于精确断言固定行、消费与两条投递路径的行为。
 *
 * 运行：`node test/changes-open.test.mjs`（或 pnpm test 跑全部）。
 */
import { installChangesOpenBridge as apply } from '../src/changes-open.ts'
import {
  fakeDocument,
  fakeKeyEvent,
  fakeShortcuts,
  fakeWindow,
  gesture,
  keydown,
  shortcutContext,
  sleep,
  FakeElement,
} from './focus-helpers.mjs'

let failures = 0
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}
function checkTrue(label, actual) {
  check(label, actual, true)
}
function checkFalse(label, actual) {
  check(label, actual, false)
}
function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/** 变更页桥要用的右栏假面。`sessionId: null` 表示没有屏幕会话。 */
function fakeSidebar({ sessionId = 's1' } = {}) {
  const sidebar = {
    mounted: { getSnapshot: () => (sessionId === null ? undefined : sessionId) },
    setSessionId(next) {
      sessionId = next
    },
    addresses: [],
    kinds: [],
    openResource(address) {
      sidebar.addresses.push(address)
    },
    openTab(kind) {
      sidebar.kinds.push(kind)
    },
  }
  return sidebar
}

/** forge Remote 假面；`localDiff` 可注入实现（同步抛错、延迟、结果）。 */
function fakeRemote({ files = [], ok = true, localDiff } = {}) {
  const calls = []
  return {
    calls,
    localDiff(sessionId, scope, signal) {
      calls.push({ sessionId, scope, signal })
      if (localDiff !== undefined) return localDiff(sessionId, scope, signal)
      return Promise.resolve({ ok, value: { files } })
    },
  }
}

/** 最小 Cordis 上下文：effect 立即执行并记录清理，inject 只在依赖齐全时同步回调。 */
function fakeCtx({ shortcuts, sidebarRight, remote }) {
  const services = { shortcuts, sidebarRight }
  if (remote !== undefined) services['remote.forgePanel'] = remote
  const effects = []
  const effect = (execute, label) => {
    const dispose = execute()
    effects.push({ label, dispose })
    return { dispose }
  }
  const ctx = {
    effects,
    get: (serviceName) => services[serviceName],
    effect,
    inject(deps, callback) {
      if (deps.some((serviceName) => services[serviceName] === undefined)) return undefined
      const scope = {
        get: ctx.get,
        effect,
        shortcuts,
        sidebarRight,
      }
      callback(scope)
      return scope
    },
    disposeAll() {
      for (const entry of [...effects].reverse()) {
        if (typeof entry.dispose === 'function') entry.dispose()
      }
      effects.length = 0
    },
  }
  return ctx
}

/** 装配一次本桥，返回部件。 */
function harness({ sessionId = 's1', remote, platform = 'windows', runtime = 'web' } = {}) {
  const shortcuts = fakeShortcuts({ runtime, platform, rows: [], fixedRows: [] })
  const sidebarRight = fakeSidebar({ sessionId })
  const ctx = fakeCtx({ shortcuts, sidebarRight, remote })
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  try {
    apply(ctx)
  } finally {
    console.warn = originalWarn
  }
  return { ctx, shortcuts, sidebarRight, warnings }
}

/** 让 `localDiff` 之后的微任务跑完。 */
async function settle() {
  for (let index = 0; index < 5; index += 1) await sleep(0)
}

const PRESS = gesture('KeyY', { control: true, alt: true })

console.log('--- C① 固定行:占用 Ctrl+Alt+Y,命中即消费,有本地变更开「本地变更」页 ---')
{
  const remote = fakeRemote({ files: [{ path: 'a.ts' }] })
  const { shortcuts, sidebarRight } = harness({ remote })
  check('固定行 id', shortcuts.fixedCatalog.getSnapshot().map((entry) => entry.id), ['dsh-keyboard-shortcuts.changes-open'])
  check('固定行键帽', shortcuts.fixedCatalog.getSnapshot()[0].keys, ['Ctrl', 'Alt', 'Y'])
  check('固定行分组', shortcuts.fixedCatalog.getSnapshot()[0].group, 'application')

  const press = keydown(PRESS, shortcutContext({ target: null }))
  shortcuts.emit(press.input)
  check('先消费这一按', press.consumed.count, 1)
  await settle()
  check('读的是 branch 范围（自动 fork point）', remote.calls.map((call) => call.scope), [
    { kind: 'branch', base: null, commits: null },
  ])
  check('开「本地变更」页而不是面板', sidebarRight.kinds, [])
  check('资源地址', sidebarRight.addresses, ['dsh-resource://forge-changes/s1/local'])
}

console.log('--- C② 没有本地变更时退回「变更请求」面板 ---')
{
  for (const [label, remote] of [
    ['空 files', fakeRemote({ files: [] })],
    ['Remote 出错', fakeRemote({ localDiff: () => Promise.reject(new Error('no git')) })],
    ['Remote 返回失败', fakeRemote({ ok: false })],
    ['Remote 缺席', undefined],
  ]) {
    const { shortcuts, sidebarRight } = harness({ remote })
    const press = keydown(PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check(`${label}:消费`, press.consumed.count, 1)
    await settle()
    check(`${label}:不打开变更页`, sidebarRight.addresses, [])
    check(`${label}:打开变更请求面板`, sidebarRight.kinds, ['forge-panel'])
  }
}

console.log('--- C③ 让位:没有会话 / 模态 / 长按 / 组字 / 已消费 / 别的键 ---')
{
  const cases = [
    ['没有会话', { sessionId: null }, gesture('KeyY', { control: true, alt: true }), shortcutContext({ target: null })],
    ['模态打开', {}, PRESS, shortcutContext({ modal: 'settings', target: null })],
    ['长按', {}, gesture('KeyY', { control: true, alt: true, repeat: true }), shortcutContext({ target: null })],
    ['组字中', {}, gesture('KeyY', { control: true, alt: true, composing: true }), shortcutContext({ target: null })],
    ['已被消费', {}, gesture('KeyY', { control: true, alt: true, defaultPrevented: true }), shortcutContext({ target: null })],
    ['别的键', {}, gesture('KeyU', { control: true, alt: true }), shortcutContext({ target: null })],
  ]
  for (const [label, options, pressGesture, context] of cases) {
    const remote = fakeRemote({ files: [{ path: 'a.ts' }] })
    const { shortcuts, sidebarRight } = harness({ ...options, remote })
    const press = keydown(pressGesture, context)
    shortcuts.emit(press.input)
    check(`${label}:不消费`, press.consumed.count, 0)
    await settle()
    check(`${label}:不动作`, [sidebarRight.addresses, sidebarRight.kinds], [[], []])
    check(`${label}:不读 git`, remote.calls.length, 0)
  }
}

console.log('--- C④ macOS:键帽为 ⌘⌥Y,命中 meta+alt ---')
{
  const remote = fakeRemote({ files: [] })
  const { shortcuts, sidebarRight } = harness({ remote, platform: 'macos' })
  check('macOS 键帽', shortcuts.fixedCatalog.getSnapshot()[0].keys, ['⌘', '⌥', 'Y'])
  const press = keydown(gesture('KeyY', { meta: true, alt: true }), shortcutContext({ target: null }))
  shortcuts.emit(press.input)
  check('消费', press.consumed.count, 1)
  await settle()
  check('开变更请求面板', sidebarRight.kinds, ['forge-panel'])
}

console.log('--- C⑤ 终端内:捕获阶段吞键,不送进 shell ---')
{
  const app = new FakeElement('div', { 'data-app': '' })
  const terminal = app.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea'))
  const window = fakeWindow()
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  globalThis.document = fakeDocument({ root: app })
  globalThis.window = window
  try {
    const remote = fakeRemote({ files: [{ path: 'a.ts' }] })
    const { sidebarRight } = harness({ remote })
    const event = fakeKeyEvent({ path: [textarea, terminal, app], code: 'KeyY', ctrlKey: true, altKey: true })
    window.emit(event)
    check('preventDefault + stopPropagation', [event.prevented, event.stopped], [1, 1])
    await settle()
    check('开「本地变更」页', sidebarRight.addresses, ['dsh-resource://forge-changes/s1/local'])
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
  }
}

console.log('--- C⑥ 卸载:固定行移除,迟到的 git 结果不再打开任何页 ---')
{
  let resolveDiff
  const remote = fakeRemote({
    localDiff: () => new Promise((resolve) => { resolveDiff = resolve }),
  })
  const { ctx, shortcuts, sidebarRight } = harness({ remote })
  const press = keydown(PRESS, shortcutContext({ target: null }))
  shortcuts.emit(press.input)
  check('消费', press.consumed.count, 1)
  ctx.disposeAll()
  check('固定行已移除', shortcuts.fixedCatalog.getSnapshot(), [])
  resolveDiff({ ok: true, value: { files: [{ path: 'a.ts' }] } })
  await settle()
  check('卸载后不打开', [sidebarRight.addresses, sidebarRight.kinds], [[], []])
}

console.log('--- C⑦ 再次按键在读取期间:每次命中都消费,不会漏按 ---')
{
  const remote = fakeRemote({ files: [] })
  const { shortcuts, sidebarRight } = harness({ remote })
  const first = keydown(PRESS, shortcutContext({ target: null }))
  const second = keydown(PRESS, shortcutContext({ target: null }))
  shortcuts.emit(first.input)
  shortcuts.emit(second.input)
  check('两次都消费', [first.consumed.count, second.consumed.count], [1, 1])
  await settle()
  check('激活已开的面板两次仍是同一次 openTab', sidebarRight.kinds, ['forge-panel', 'forge-panel'])
}

console.log('--- C⑧ 变更页类型缺席:openResource 抛错时退回变更请求面板 ---')
{
  const remote = fakeRemote({ files: [{ path: 'a.ts' }] })
  const { shortcuts, sidebarRight } = harness({ remote })
  sidebarRight.openResource = () => { throw new Error('no type for address') }
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  try {
    shortcuts.emit(keydown(PRESS, shortcutContext({ target: null })).input)
    await settle()
  } finally {
    console.warn = originalWarn
  }
  check('退回变更请求面板', sidebarRight.kinds, ['forge-panel'])
  checkTrue('有失败告警', warnings.some((line) => line.includes('打开本地变更页失败')))
}

console.log('--- C⑨ 读 git 期间切了会话:不在新会话里打开原会话的本地变更 ---')
{
  let resolveDiff
  const remote = fakeRemote({
    localDiff: () => new Promise((resolve) => { resolveDiff = resolve }),
  })
  const { shortcuts, sidebarRight } = harness({ remote })
  shortcuts.emit(keydown(PRESS, shortcutContext({ target: null })).input)
  sidebarRight.setSessionId('s2')
  resolveDiff({ ok: true, value: { files: [{ path: 'a.ts' }] } })
  await settle()
  check('不打开原会话的变更页', sidebarRight.addresses, [])
  check('也不改开变更请求面板', sidebarRight.kinds, [])
}

finish()
