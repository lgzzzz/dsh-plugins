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
  installDom,
  pluginRoot,
  renderSlotEntry,
  workspace,
} from './helpers.mjs'

const dom = installDom()
const { paletteAction } = await import('../src/client.ts')

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
  check('固定行 id', shortcuts.commands.map((command) => command.id), ['dsh-workspace-quick-switch.quick-switch'])
  check('注册进 shell.overlay', slots.registered.map((entry) => entry.options.id), ['dsh-workspace-quick-switch'])
  check('交出去的是组件本体(不是元素)', typeof slots.registered[0].component, 'function')
  check('业务 props 由 inject 提供', Object.keys(slots.registered[0].options.inject()), ['store'])

  check('未打开时渲染为空', renderSlotEntry(slots.registered[0]), '')
  shortcuts.fire(fixedKeydown())
  check('候选顺序', parseRows(slots).map((row) => row.title), ['Alpha', 'Beta'])
  check('当前工作区被选中', parseRows(slots).map((row) => row.selected), ['false', 'true'])

  // 产物导出的按键解码与源码一致。
  check('产物导出了 paletteAction', typeof plugin.paletteAction, 'function')
  check('Escape → close', plugin.paletteAction({ key: 'Escape' }), 'close')
  check('源码与产物的解码一致', paletteAction({ key: 'Enter' }) === plugin.paletteAction({ key: 'Enter' }), true)
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
  check('macOS 固定行键帽', shortcuts.commands[0].keys, ['⌘', '⌥', 'M'])
  check('macOS 固定行落成 ⌘⌥M', shortcuts.fixedCatalog.getSnapshot()[0].bindings, [{ code: 'KeyM', modifiers: ['alt', 'meta'] }])
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

finish()
dom.uninstall()
