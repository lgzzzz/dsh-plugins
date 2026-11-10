/**
 * 产物装配:`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名 / inject 声明,并且
 * 只向模块表要 `react`;装配后固定行与浮层都生效,`Ctrl+Alt+M` 能打开候选列表,命中的那次
 * 按键还会被消费掉(`consume`)。
 *
 * 运行:`node test/artifact-client.test.mjs`(或 pnpm test 跑全部),需要先构建 `lib/client.js`。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as reactNamespace from 'react'

import {
  captureWarnings,
  check,
  checkTrue,
  fakeCtx,
  fakeSessions,
  fakeShortcuts,
  fakeSlots,
  fakeWorkspaces,
  finish,
  fixedKeydown,
  fixedMacKeydown,
  fixedSessionKeydown,
  installDom,
  pluginRoot,
  renderSlotEntry,
  workspace,
} from './helpers.mjs'

const dom = installDom()
const { installPaletteKeys, paletteAction } = await import('../src/client.ts')

/** 模块表里的 react:与源码测试用的是同一个实例。 */
const reactModule = reactNamespace.default ?? reactNamespace

/** 加载产物,返回它注册进模块表的内容与它要过的模块。 */
function loadArtifact() {
  let registration = null
  const requested = []
  globalThis.window = {
    __ModuleLoader__: {
      load: (value) => {
        registration = value
      },
    },
  }
  try {
    // eslint-disable-next-line no-eval
    ;(0, eval)(readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8'))
  } finally {
    delete globalThis.window
  }
  const plugin = registration.factory((specifier) => {
    requested.push(specifier)
    if (specifier !== 'react') throw new Error(`产物要求了未提供的模块:${specifier}`)
    return reactModule
  })
  return { registration, plugin, requested }
}

/** 渲染注册进槽位的浮层,并解析候选行。 */
function parseRows(slots) {
  const html = renderSlotEntry(slots.registered[0])
  const rows = [...html.matchAll(/<button[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/button>/gs)].map(
    ([, selected, body]) => ({
      selected,
      title: /dsh-workspace-quick-switch-name">([^<]*)</.exec(body)?.[1],
    }),
  )
  return rows
}

console.log('--- D① 模块表注册与声明 ---')
const { registration, plugin, requested } = loadArtifact()
{
  checkTrue('有注册项', registration !== null)
  check('模块 id', registration.id, 'dsh-workspace-quick-switch')
  check('只向模块表要 react', requested, ['react'])
  check('插件名', plugin.name, 'dsh-workspace-quick-switch')
  check('inject 声明', plugin.inject, ['slots', 'shortcuts'])
}

console.log('--- D② 产物装配后固定行与浮层生效 ---')
{
  const slots = fakeSlots()
  const shortcuts = fakeShortcuts()
  const startCalls = []
  const ctx = fakeCtx({
    slots,
    shortcuts,
    workspaces: {
      list: fakeWorkspaces([
        workspace('ws-1', 'Alpha', { sessionIds: ['ws-1'] }),
        workspace('ws-2', 'Beta', { sessionIds: ['ws-2'] }),
      ]),
    },
    sessions: fakeSessions({ current: 'ws-2' }),
    uiWorkspace: { startSession: (workspaceId) => startCalls.push(workspaceId) },
  })
  plugin.apply(ctx)
  check('两条固定行', shortcuts.commands.map((command) => command.id), [
    'dsh-workspace-quick-switch.quick-switch',
    'dsh-workspace-quick-switch.session-switch',
  ])
  check('两张浮层都注册进 shell.overlay', slots.registered.map((entry) => entry.options.id), [
    'dsh-workspace-quick-switch',
    'dsh-workspace-quick-switch.session-switch',
  ])
  check('交出去的是组件本体(不是元素)', slots.registered.map((entry) => typeof entry.component), ['function', 'function'])
  check('业务 props 由 inject 提供', Object.keys(slots.registered[0].options.inject()), ['store', 'view'])

  check('未打开时渲染为空', renderSlotEntry(slots.registered[0]), '')
  shortcuts.fire(fixedKeydown())
  check('候选顺序', parseRows(slots).map((row) => row.title), ['Alpha', 'Beta'])
  check('当前工作区被选中', parseRows(slots).map((row) => row.selected), ['false', 'true'])

  // 产物导出的按键解码与源码一致。
  check('产物导出了 paletteAction', typeof plugin.paletteAction, 'function')
  check('产物导出了会话浮层归属判定', typeof plugin.sessionSwitchOwns, 'function')
  check('Escape → close', plugin.paletteAction({ key: 'Escape' }), 'close')
  check('源码与产物的解码一致', paletteAction({ key: 'Enter' }) === plugin.paletteAction({ key: 'Enter' }), true)
  // 翻页键同样随产物发布:产物漏掉 ←/→ 时用户看到的仍是「10 个封顶」的旧行为。
  check('产物认 →', plugin.paletteAction({ key: 'ArrowRight' }), 'page-next')
  check('产物认 ←', plugin.paletteAction({ key: 'ArrowLeft' }), 'page-previous')
}

console.log('--- D②ᵇ 产物里一屏 10 行、← / → 翻页 ---')
{
  const many = Array.from({ length: 23 }, (_, index) => workspace(`ws-${index + 1}`, `W${index + 1}`))
  const slots = fakeSlots()
  const shortcuts = fakeShortcuts()
  const ctx = fakeCtx({
    slots,
    shortcuts,
    workspaces: { list: fakeWorkspaces(many) },
    sessions: fakeSessions({}),
    uiWorkspace: { startSession() {} },
  })
  plugin.apply(ctx)
  const overlay = slots.registered[0]
  const store = overlay.options.inject().store
  shortcuts.fire(fixedKeydown())
  check('第一页 10 行', parseRows(slots).length, 10)
  check('第一页首个是 W1', parseRows(slots)[0].title, 'W1')

  // 直接驱动产物里的 store 翻页(按键通路已在 C⑤ᵇ 端到端覆盖)。
  store.turn(1)
  check('第二页首个是 W11', parseRows(slots)[0].title, 'W11')
  store.turn(1)
  check('第三页只剩 3 个', parseRows(slots).map((row) => row.title), ['W21', 'W22', 'W23'])
  ctx.dispose()
}

console.log('--- D③ 依赖缺失时产物只是不安装,不抛 ---')
{
  const slots = fakeSlots()
  const ctx = fakeCtx({ slots })
  const warnings = captureWarnings(() => plugin.apply(ctx))
  check('缺 shortcuts 时注入回调不跑', warnings, [])
  check('没有注册任何槽位', slots.registered, [])
  check('ctx.inject 报出缺失项', ctx.missing, ['shortcuts'])
}

console.log('--- D④ 产物在 macOS 平台上占 ⌘⌥M,并只认这一组 ---')
{
  const slots = fakeSlots()
  const shortcuts = fakeShortcuts({ platform: 'macos' })
  const ctx = fakeCtx({
    slots,
    shortcuts,
    workspaces: { list: fakeWorkspaces([workspace('ws-1', 'Alpha')]) },
    sessions: fakeSessions({}),
    uiWorkspace: { startSession() {} },
  })
  plugin.apply(ctx)
  check('macOS 固定行键帽', shortcuts.commands.map((command) => command.keys), [['⌘', '⌥', 'M'], ['⌘', '⌥', 'I']])
  check('macOS 固定行落成 ⌘⌥M / ⌘⌥I', shortcuts.fixedCatalog.getSnapshot().map((row) => row.bindings), [
    [{ code: 'KeyM', modifiers: ['alt', 'meta'] }],
    [{ code: 'KeyI', modifiers: ['alt', 'meta'] }],
  ])
  shortcuts.fire(fixedKeydown())
  check('macOS 上 Ctrl+Alt+M 不打开', parseRows(slots).length, 0)
  shortcuts.fire(fixedMacKeydown())
  check('macOS 上 ⌘⌥M 打开', parseRows(slots).map((row) => row.title), ['Alpha'])
  check('产物只消费命中的那一次按键', shortcuts.consumeCalls(), 1)
}

console.log('--- D⑤ 产物里的终端捕获:`.xterm` 内的 ⌘⌥M 也开浮层 ---')
{
  /** 一段最小的终端 DOM:`.xterm` 容器 + 它里面的 helper textarea(按真实 closest 上溯)。 */
  function terminalPath() {
    const pane = { parent: null, xterm: false }
    const screen = { parent: pane, xterm: true }
    const textarea = { parent: screen, xterm: false }
    const closestOn = (node) => (selector) => {
      if (selector !== '.xterm') return null
      for (let current = node; current !== null; current = current.parent) {
        if (current.xterm) return current
      }
      return null
    }
    textarea.closest = closestOn(textarea)
    screen.closest = closestOn(screen)
    pane.closest = closestOn(pane)
    return [textarea, screen, pane]
  }

  const terminalDom = installDom()
  try {
    const slots = fakeSlots()
    const shortcuts = fakeShortcuts()
    const ctx = fakeCtx({
      slots,
      shortcuts,
      workspaces: {
        list: fakeWorkspaces([workspace('ws-1', 'Alpha'), workspace('ws-2', 'Beta')]),
      },
      sessions: fakeSessions({ current: 'ws-2' }),
      uiWorkspace: { startSession() {} },
    })
    plugin.apply(ctx)
    check('产物挂上了终端捕获监听', terminalDom.windowListenerCount(), 1)
    const event = terminalDom.pressWindowKey({ code: 'KeyM', key: 'm', ctrlKey: true, altKey: true, path: terminalPath() })
    check('产物里终端内 Ctrl+Alt+M 打开浮层', parseRows(slots).map((row) => row.title), ['Alpha', 'Beta'])
    check('产物里终端内这一按被吞', [event.defaultPrevented, event.stopped], [true, true])
    ctx.dispose()
    check('卸载后捕获监听撤掉', terminalDom.windowListenerCount(), 0)
  } finally {
    terminalDom.uninstall()
  }
}

// D⑤ 的终端用例收尾时卸掉了全局 document / window;后面几节要重新装一份。
const sessionDom = installDom()

console.log('--- D⑥ 产物里的会话浮层:Ctrl+Alt+I 打开、顺序照左侧栏、Enter 打开会话 ---')
{
  /** 渲染第二个注册项(会话浮层)并解析候选行。 */
  function sessionRows(slots) {
    const html = renderSlotEntry(slots.registered[1])
    return [...html.matchAll(/<button[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/button>/gs)].map(
      ([, selected, body]) => ({
        selected,
        title: /dsh-workspace-quick-switch-name">([^<]*)</.exec(body)?.[1],
      }),
    )
  }

  const slots = fakeSlots()
  const shortcuts = fakeShortcuts()
  const openCalls = []
  const ctx = fakeCtx({
    slots,
    shortcuts,
    workspaces: {
      list: fakeWorkspaces([
        workspace('ws-1', 'Alpha', { sessionIds: ['old', 'archived'] }),
        workspace('ws-2', 'Beta', { sessionIds: ['newest'] }),
      ], { archived: ['archived'], pinned: ['old'] }),
    },
    sessions: fakeSessions({
      current: 'newest',
      byId: {
        old: { id: 'old', title: '旧会话', updatedAt: 100 },
        archived: { id: 'archived', title: '已归档', updatedAt: 900 },
        newest: { id: 'newest', title: '新会话', updatedAt: 500 },
      },
    }),
    uiWorkspace: { startSession() {}, openSession: (id) => openCalls.push(id) },
  })
  plugin.apply(ctx)
  check('未打开时会话浮层渲染为空', renderSlotEntry(slots.registered[1]), '')
  shortcuts.fire(fixedSessionKeydown())
  check('Ctrl+Alt+I 打开会话浮层', sessionRows(slots).map((row) => row.title), ['旧会话', '新会话'])
  check('当前会话被选中', sessionRows(slots).map((row) => row.selected), ['false', 'true'])
  check('这一次按键被消费', shortcuts.consumeCalls(), 1)

  // ↑ 到置顶那一行再 Enter:走 openSession(而不是 startSession)。
  const overlay = slots.registered[1].options.inject()
  const offKeys = installPaletteKeys(overlay.store, sessionDom.document)
  sessionDom.pressKey('ArrowUp')
  check('↑ 移到置顶那一行', sessionRows(slots).map((row) => row.selected), ['true', 'false'])
  sessionDom.pressKey('Enter')
  check('Enter 打开选中的会话', openCalls, ['old'])
  check('会话浮层关闭', sessionRows(slots).length, 0)
  offKeys()
  ctx.dispose()
}

console.log('--- D⑦ 产物里的死键补偿:macOS 上 Dead 的 ⌘⌥I 也打开会话浮层 ---')
{
  const macDom = installDom()
  try {
    const slots = fakeSlots()
    const shortcuts = fakeShortcuts({ platform: 'macos' })
    const ctx = fakeCtx({
      slots,
      shortcuts,
      workspaces: { list: fakeWorkspaces([workspace('ws-1', 'Alpha')]) },
      sessions: fakeSessions({ current: undefined, byId: { s1: { id: 's1', title: 'A', updatedAt: 1 } } }),
      uiWorkspace: { startSession() {}, openSession() {} },
    })
    plugin.apply(ctx)
    check('终端捕获 + 死键补偿两条监听', macDom.windowListenerCount(), 2)
    const event = macDom.pressWindowKey({ code: 'KeyI', key: 'Dead', metaKey: true, altKey: true, path: [{ closest: () => null }] })
    const html = renderSlotEntry(slots.registered[1])
    checkTrue('死键打开会话浮层', html.includes('data-session-quick-switch=""'))
    check('这一按被吞', [event.defaultPrevented, event.stopped], [true, true])
    ctx.dispose()
  } finally {
    macDom.uninstall()
  }
}


finish()
dom.uninstall()
