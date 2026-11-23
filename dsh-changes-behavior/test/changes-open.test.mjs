/**
 * `⌘⌥Y` / `Ctrl+Alt+Y` 变更请求键：命中即打开变更页 —— 会话绑定了变更请求时打开第一张
 * 卡片的变更请求页，没有绑定时打开本地变更页；打开后由 `presentFullscreen` 按面板现值
 * 决定是否切全屏。
 *
 * 绑定关系来自 forge 面板流，所以命中的动作是异步的（先消费、再读一帧、再打开）；没有
 * forge Remote 时直接同步打开本地变更页。
 *
 * 只装配本桥，不跑整个 client，便于精确断言固定行、消费与两条投递路径的行为。
 *
 * 运行：`node test/changes-open.test.mjs`（或 pnpm test 跑全部）。
 */
import { installChangesOpenBridge } from '../src/changes-open.ts'
import { installOpenPolicy, withFullscreenIntent } from '../src/presentation.ts'
import {
  BOUND_URL,
  FakeElement,
  captureWarnings,
  captureWarningsAsync,
  check,
  checkTrue,
  fakeForgePanel,
  fakeKeyEvent,
  fakeSidebar,
  finish,
  gesture,
  harness,
  keydown,
  settle,
  shortcutContext,
  withWindowDom,
} from './shortcut-helpers.mjs'

const PRESS = gesture('KeyY', { control: true, alt: true })
const LOCAL = 'dsh-resource://forge-changes/s1/local'
const CHANGE = `dsh-resource://forge-changes/s1/change/${encodeURIComponent(BOUND_URL)}`

/** 置入一个带呈现方式标记的假右栏文档；`mode` 是 `push` / `fullscreen` / `none`。 */
function withSidebarPanel(mode) {
  const app = new FakeElement('div', { 'data-app': '' })
  if (mode !== 'none') app.append(new FakeElement('div', { 'data-sidebar-right-session': 's1', 'data-sidebar-right-panel': mode }))
  return withWindowDom({ root: app })
}

console.log('--- C① 固定行：占用 Ctrl+Alt+Y，命中即消费，打开绑定变更请求的变更页 ---')
{
  const { shortcuts, sidebarRight } = harness()
  check('固定行 id', shortcuts.fixedCatalog.getSnapshot().map((entry) => entry.id), ['dsh-changes-behavior.changes-open'])
  check('固定行键帽', shortcuts.fixedCatalog.getSnapshot()[0].keys, ['Ctrl', 'Alt', 'Y'])
  check('固定行分组', shortcuts.fixedCatalog.getSnapshot()[0].group, 'application')
  check('动作名称', shortcuts.fixedCatalog.getSnapshot()[0].label, '打开变更请求')

  const press = keydown(PRESS, shortcutContext({ target: null }))
  shortcuts.emit(press.input)
  check('消费这一按', press.consumed.count, 1)
  await settle()
  check('打开变更请求页', sidebarRight.addresses, [CHANGE])
}

console.log('--- C② 让位：没有会话 / 模态 / 长按 / 组字 / 已消费 / 别的键 ---')
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
    await settle()
    check(`${label}：不消费`, press.consumed.count, 0)
    check(`${label}：不动作`, sidebarRight.addresses, [])
  }
}

console.log('--- C③ macOS：键帽为 ⌘⌥Y，命中 meta+alt ---')
{
  const { shortcuts, sidebarRight } = harness({ platform: 'macos' })
  check('macOS 键帽', shortcuts.fixedCatalog.getSnapshot()[0].keys, ['⌘', '⌥', 'Y'])
  const press = keydown(gesture('KeyY', { meta: true, alt: true }), shortcutContext({ target: null }))
  shortcuts.emit(press.input)
  check('消费', press.consumed.count, 1)
  await settle()
  check('开变更请求页', sidebarRight.addresses, [CHANGE])
}

console.log('--- C④ 终端内：捕获阶段吞键，不送进 shell ---')
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
    await settle()
    check('开变更请求页', sidebarRight.addresses, [CHANGE])
  } finally {
    dom.restore()
  }
}

console.log('--- C⑤ 卸载：固定行与观察者移除，再按不动作 ---')
{
  const { ctx, shortcuts, sidebarRight } = harness()
  ctx.disposeAll()
  check('固定行已移除', shortcuts.fixedCatalog.getSnapshot(), [])
  check('观察者已移除', shortcuts.listenerCount(), 0)
  const press = keydown(PRESS, shortcutContext({ target: null }))
  shortcuts.emit(press.input)
  await settle()
  check('卸载后不消费', press.consumed.count, 0)
  check('卸载后不打开', sidebarRight.addresses, [])
}

console.log('--- C⑥ 每次命中都消费并打开，不会漏按 ---')
{
  const { shortcuts, sidebarRight } = harness()
  const first = keydown(PRESS, shortcutContext({ target: null }))
  const second = keydown(PRESS, shortcutContext({ target: null }))
  shortcuts.emit(first.input)
  await settle()
  shortcuts.emit(second.input)
  await settle()
  check('两次都消费', [first.consumed.count, second.consumed.count], [1, 1])
  check('两次都打开变更页', sidebarRight.addresses, [CHANGE, CHANGE])
}

console.log('--- C⑦ 没有绑定 / 读流抛错 / 没有 forge Remote：回落到本地变更页 ---')
{
  const empty = harness({ forgePanel: fakeForgePanel({ urls: [] }) })
  empty.shortcuts.emit(keydown(PRESS, shortcutContext({ target: null })).input)
  await settle()
  check('没有绑定 → 本地变更页', empty.sidebarRight.addresses, [LOCAL])

  const broken = harness({ forgePanel: fakeForgePanel({ failure: new Error('stream failed') }) })
  broken.shortcuts.emit(keydown(PRESS, shortcutContext({ target: null })).input)
  await settle()
  check('读流抛错 → 本地变更页', broken.sidebarRight.addresses, [LOCAL])

  const noForge = harness({ forgePanel: null })
  const press = keydown(PRESS, shortcutContext({ target: null }))
  noForge.shortcuts.emit(press.input)
  check('没有 Remote：同步打开', noForge.sidebarRight.addresses, [LOCAL])
  check('没有 Remote：仍消费', press.consumed.count, 1)
}

console.log('--- C⑧ 打开失败：openResource 抛错时告警，按键仍已消费 ---')
{
  const { shortcuts, sidebarRight } = harness()
  sidebarRight.openResource = () => { throw new Error('no page type') }
  const press = keydown(PRESS, shortcutContext({ target: null }))
  const warnings = await captureWarningsAsync(async () => {
    shortcuts.emit(press.input)
    await settle()
  })
  check('消费', press.consumed.count, 1)
  checkTrue('有失败告警', warnings.some((line) => line.includes('打开变更页失败')))
  check('打开失败不切全屏', sidebarRight.calls, [])
}

console.log('--- C⑨ 面板原本是 push：打开后切成全屏 ---')
{
  const dom = withSidebarPanel('push')
  try {
    const { shortcuts, sidebarRight } = harness()
    const press = keydown(PRESS, shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('消费', press.consumed.count, 1)
    await settle()
    check('打开变更请求页', sidebarRight.addresses, [CHANGE])
    check('切全屏', sidebarRight.calls, [['fullscreen', { host: 'dock' }]])
    check('按活动 dock 面板解析（传 null）', sidebarRight.targets, [null])
  } finally {
    dom.restore()
  }
}

console.log('--- C⑩ 已经是全屏 / 没有面板 / 活动页不是变更页 / 目标陈旧：不切 ---')
{
  const cases = [
    ['窄窗口自动全屏或手动全屏', 'fullscreen', {}, 0],
    ['读不到面板', 'none', {}, 0],
    ['活动页不是变更页', 'push', { activeKind: 'changes-review' }, 0],
    ['没有活动页', 'push', { activeKind: null }, 0],
    ['目标已陈旧', 'push', { current: false }, 0],
    ['右栏折叠', 'push', { expanded: false }, 0],
    ['没有页类型注册表', 'push', { tabs: null }, 1],
  ]
  for (const [label, mode, options, expected] of cases) {
    const dom = withSidebarPanel(mode)
    try {
      const { shortcuts, sidebarRight } = harness(options)
      const press = keydown(PRESS, shortcutContext({ target: null }))
      shortcuts.emit(press.input)
      await settle()
      check(`${label}：打开变更页`, sidebarRight.addresses, [CHANGE])
      check(`${label}：全屏切换次数`, sidebarRight.calls.length, expected)
    } finally {
      dom.restore()
    }
  }
}

console.log('--- C⑪ 读流期间切走：不属于当前会话的页面不打开 ---')
{
  const { shortcuts, sidebarRight } = harness()
  let mounted = 's1'
  sidebarRight.mounted = { getSnapshot: () => mounted }
  shortcuts.emit(keydown(PRESS, shortcutContext({ target: null })).input)
  mounted = 's2'
  await settle()
  check('切走后不打开', sidebarRight.addresses, [])
}

console.log('--- C⑫ 全屏意图：包装层不把指定入口拉回推挤 ---')
{
  const sidebar = fakeSidebar()
  const panel = {
    getAttribute: (name) => (
      name === 'data-sidebar-right-panel' ? 'fullscreen'
        : name === 'data-sidebar-right-session' ? 's1' : null
    ),
    closest: () => null,
  }
  const doc = {
    querySelectorAll: () => [panel],
    defaultView: { innerWidth: 1440 },
  }
  const dispose = installOpenPolicy(sidebar, doc)
  withFullscreenIntent(() => sidebar.openResource(LOCAL))
  check('打开变更页', sidebar.addresses, [LOCAL])
  check('有意图时不切回推挤', sidebar.calls, [])
  sidebar.openResource(LOCAL)
  check('没有意图时切回推挤', sidebar.calls, [['fullscreen', { host: 'dock' }]])
  dispose()
}

finish()
