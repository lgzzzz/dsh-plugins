/**
 * `⌘⌥Y` / `Ctrl+Alt+Y` 变更请求桥：命中即打开「变更请求」面板，不读 git。
 *
 * 只装配本桥，不跑整个 client，便于精确断言固定行、消费与两条投递路径的行为。
 *
 * 运行：`node test/changes-open.test.mjs`（或 pnpm test 跑全部）。
 */
import { installChangesOpenBridge as apply } from '../src/changes-open.ts'
import { presentSidebarFullscreen } from '../src/fullscreen-present.ts'
import {
  captureWarnings,
  check,
  checkTrue,
  fakeKeyEvent,
  fakeShortcuts,
  finish,
  gesture,
  keydown,
  shortcutContext,
  FakeElement,
  withWindowDom,
} from './focus-helpers.mjs'

/** 打开变更请求要用的右栏假面。`sessionId: null` 表示没有屏幕会话。 */
function fakeSidebar({
  sessionId = 's1',
  activeKind = 'forge-panel',
  expanded = true,
  target = { host: 'dock' },
  current = true,
} = {}) {
  let mounted = sessionId === null ? undefined : sessionId
  const sidebar = {
    mounted: { getSnapshot: () => mounted },
    setSessionId(next) {
      mounted = next
    },
    kinds: [],
    calls: [],
    targets: [],
    openTab(kind) {
      sidebar.kinds.push(kind)
    },
    active: () => (activeKind === null ? undefined : { kind: activeKind }),
    isExpanded: () => expanded,
    commandTarget: (element) => {
      sidebar.targets.push(element)
      return target
    },
    isTargetCurrent: () => current,
    toggleFullscreen: (value) => sidebar.calls.push(['fullscreen', value]),
  }
  return sidebar
}

/** 置入一个带呈现方式标记的假右栏文档；`mode` 是 `push` / `fullscreen` / `none`。 */
function withSidebarPanel(mode) {
  const app = new FakeElement('div', { 'data-app': '' })
  if (mode !== 'none') app.append(new FakeElement('div', { 'data-sidebar-right-panel': mode }))
  return withWindowDom({ root: app })
}

/**
 * 最小 Cordis 上下文：effect 立即执行并记录清理，inject 只在依赖齐全时同步回调。
 * `get` 记录每一次服务读取，用来证明本桥不再碰 `remote.forgePanel`。
 */
function fakeCtx({ shortcuts, sidebarRight }) {
  const services = { shortcuts, sidebarRight }
  const effects = []
  const reads = []
  const effect = (execute, label) => {
    const dispose = execute()
    effects.push({ label, dispose })
    return { dispose }
  }
  const ctx = {
    effects,
    reads,
    get(serviceName) {
      reads.push(serviceName)
      return services[serviceName]
    },
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
function harness({ sessionId = 's1', platform = 'windows', runtime = 'web', ...sidebarOptions } = {}) {
  const shortcuts = fakeShortcuts({ runtime, platform, rows: [], fixedRows: [] })
  const sidebarRight = fakeSidebar({ sessionId, ...sidebarOptions })
  const ctx = fakeCtx({ shortcuts, sidebarRight })
  const warnings = captureWarnings(() => { apply(ctx) })
  return { ctx, shortcuts, sidebarRight, warnings }
}

const PRESS = gesture('KeyY', { control: true, alt: true })

console.log('--- C① 固定行:占用 Ctrl+Alt+Y,命中即消费,打开「变更请求」面板 ---')
{
  const { ctx, shortcuts, sidebarRight } = harness()
  check('固定行 id', shortcuts.fixedCatalog.getSnapshot().map((entry) => entry.id), ['dsh-keyboard-shortcuts.changes-open'])
  check('固定行键帽', shortcuts.fixedCatalog.getSnapshot()[0].keys, ['Ctrl', 'Alt', 'Y'])
  check('固定行分组', shortcuts.fixedCatalog.getSnapshot()[0].group, 'application')
  check('动作名称', shortcuts.fixedCatalog.getSnapshot()[0].label, '打开变更请求')

  const press = keydown(PRESS, shortcutContext({ target: null }))
  shortcuts.emit(press.input)
  check('消费这一按', press.consumed.count, 1)
  check('打开变更请求面板', sidebarRight.kinds, ['forge-panel'])
  check('不读任何远程服务', ctx.reads, [])
}

console.log('--- C② 让位:没有会话 / 模态 / 长按 / 组字 / 已消费 / 别的键 ---')
{
  const cases = [
    ['没有会话', { sessionId: null }, PRESS, shortcutContext({ target: null })],
    ['模态打开', {}, PRESS, shortcutContext({ modal: 'settings', target: null })],
    ['长按', {}, gesture('KeyY', { control: true, alt: true, repeat: true }), shortcutContext({ target: null })],
    ['组字中', {}, gesture('KeyY', { control: true, alt: true, composing: true }), shortcutContext({ target: null })],
    ['已被消费', {}, gesture('KeyY', { control: true, alt: true, defaultPrevented: true }), shortcutContext({ target: null })],
    ['别的键', {}, gesture('KeyU', { control: true, alt: true }), shortcutContext({ target: null })],
  ]
  for (const [label, options, pressGesture, context] of cases) {
    const { shortcuts, sidebarRight } = harness(options)
    const press = keydown(pressGesture, context)
    shortcuts.emit(press.input)
    check(`${label}:不消费`, press.consumed.count, 0)
    check(`${label}:不动作`, sidebarRight.kinds, [])
  }
}

console.log('--- C③ macOS:键帽为 ⌘⌥Y,命中 meta+alt ---')
{
  const { shortcuts, sidebarRight } = harness({ platform: 'macos' })
  check('macOS 键帽', shortcuts.fixedCatalog.getSnapshot()[0].keys, ['⌘', '⌥', 'Y'])
  const press = keydown(gesture('KeyY', { meta: true, alt: true }), shortcutContext({ target: null }))
  shortcuts.emit(press.input)
  check('消费', press.consumed.count, 1)
  check('开变更请求面板', sidebarRight.kinds, ['forge-panel'])
}

console.log('--- C④ 终端内:捕获阶段吞键,不送进 shell ---')
{
  const app = new FakeElement('div', { 'data-app': '' })
  const terminal = app.append(new FakeElement('div', { class: 'xterm' }))
  const textarea = terminal.append(new FakeElement('textarea'))
  const dom = withWindowDom({ root: app })
  try {
    const { sidebarRight } = harness()
    const event = fakeKeyEvent({ path: [textarea, terminal, app], code: 'KeyY', ctrlKey: true, altKey: true })
    dom.window.emit(event)
    check('preventDefault + stopPropagation', [event.prevented, event.stopped], [1, 1])
    check('开变更请求面板', sidebarRight.kinds, ['forge-panel'])
  } finally {
    dom.restore()
  }
}

console.log('--- C⑤ 卸载:固定行与观察者移除,再按不动作 ---')
{
  const { ctx, shortcuts, sidebarRight } = harness()
  ctx.disposeAll()
  check('固定行已移除', shortcuts.fixedCatalog.getSnapshot(), [])
  check('观察者已移除', shortcuts.listenerCount(), 0)
  const press = keydown(PRESS, shortcutContext({ target: null }))
  shortcuts.emit(press.input)
  check('卸载后不消费', press.consumed.count, 0)
  check('卸载后不打开', sidebarRight.kinds, [])
}

console.log('--- C⑥ 每次命中都消费并打开,不会漏按 ---')
{
  const { shortcuts, sidebarRight } = harness()
  const first = keydown(PRESS, shortcutContext({ target: null }))
  const second = keydown(PRESS, shortcutContext({ target: null }))
  shortcuts.emit(first.input)
  shortcuts.emit(second.input)
  check('两次都消费', [first.consumed.count, second.consumed.count], [1, 1])
  check('两次都打开面板', sidebarRight.kinds, ['forge-panel', 'forge-panel'])
}

console.log('--- C⑦ 打开失败:openTab 抛错时告警,按键仍已消费 ---')
{
  const { shortcuts, sidebarRight } = harness()
  sidebarRight.openTab = () => { throw new Error('no panel type') }
  const press = keydown(PRESS, shortcutContext({ target: null }))
  const warnings = captureWarnings(() => { shortcuts.emit(press.input) })
  check('消费', press.consumed.count, 1)
  checkTrue('有失败告警', warnings.some((line) => line.includes('打开变更请求面板失败')))
  check('打开失败不切全屏', sidebarRight.calls, [])
}

console.log('--- C⑧ 面板原本是 push:打开后切成全屏 ---')
{
  const dom = withSidebarPanel('push')
  try {
    const { shortcuts, sidebarRight } = harness()
    const press = keydown(PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('消费', press.consumed.count, 1)
    check('打开变更请求面板', sidebarRight.kinds, ['forge-panel'])
    check('切全屏', sidebarRight.calls, [['fullscreen', { host: 'dock' }]])
    check('按活动 dock 面板解析（传 null）', sidebarRight.targets, [null])
  } finally {
    dom.restore()
  }
}

console.log('--- C⑨ 已经是全屏 / 没有面板 / 活动页不是变更请求 / 目标陈旧:不切 ---')
{
  const cases = [
    ['窄窗口自动全屏或手动全屏', 'fullscreen', {}, 0],
    ['读不到面板', 'none', {}, 0],
    ['活动页不是变更请求', 'push', { activeKind: 'changes-review' }, 0],
    ['没有活动页', 'push', { activeKind: null }, 0],
    ['目标已陈旧', 'push', { current: false }, 0],
    ['右栏折叠', 'push', { expanded: false }, 0],
  ]
  for (const [label, mode, options, expected] of cases) {
    const dom = withSidebarPanel(mode)
    try {
      const { shortcuts, sidebarRight } = harness(options)
      const press = keydown(PRESS, shortcutContext({ target: null }))
      shortcuts.emit(press.input)
      check(`${label}:打开面板`, sidebarRight.kinds, ['forge-panel'])
      check(`${label}:不切全屏`, sidebarRight.calls.length, expected)
    } finally {
      dom.restore()
    }
  }

  const dom = withSidebarPanel('push')
  try {
    const { shortcuts, sidebarRight } = harness()
    sidebarRight.commandTarget = () => undefined
    const press = keydown(PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('解析不出目标:不切全屏', sidebarRight.calls, [])
  } finally {
    dom.restore()
  }
}

console.log('--- C⑩ 呈现方式读数只看当前会话视图 ---')
{
  const previous = globalThis.document
  const installDocument = (query) => { globalThis.document = { querySelector: query } }
  try {
    // 当前会话是 push，另一个保留的会话视图是全屏：仍按 push 切一次。
    installDocument((selector) => {
      if (selector.includes(':not([hidden])')) return selector.includes('"fullscreen"') ? null : { tag: 'push' }
      return selector.includes('"fullscreen"') ? { tag: 'hidden-fullscreen' } : null
    })
    const pushing = fakeSidebar()
    check('当前 push：切全屏', presentSidebarFullscreen(pushing, 'forge-panel'), true)
    check('调用一次', pushing.calls, [['fullscreen', { host: 'dock' }]])

    // 当前会话已经是全屏，另一个保留的会话视图是 push：不切。
    installDocument((selector) => {
      if (selector.includes(':not([hidden])')) return selector.includes('"fullscreen"') ? { tag: 'fullscreen' } : null
      return selector.includes('"push"') ? { tag: 'hidden-push' } : null
    })
    const fullscreen = fakeSidebar()
    check('当前全屏：不切', presentSidebarFullscreen(fullscreen, 'forge-panel'), false)
    check('不调用', fullscreen.calls, [])
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

finish()
