/**
 * G 产物:`lib/client.js` 的模块 id / 插件名 / `inject` 声明,以及用真产物
 * 装配一遍的端到端走线(产物零 external,不应要求任何外部模块)。
 *
 * 运行:`node test/artifact-client.test.mjs`(或 pnpm test 跑全部)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { captureWarnings, check, checkTrue, domBody, domComposer, fakeSessions, fakeShortcuts, fakeSidebar, FakeCtx, finish, FULLSCREEN_BINDING, FULLSCREEN_PRESS, gesture, keydown, pluginRoot, row, session, shortcutContext } from './helpers.mjs'

console.log('--- G① lib/client.js 注册、声明与端到端装配 ---')
{
  let registration = null
  globalThis.window = {
    __ModuleLoader__: {
      load: (reg) => {
        registration = reg
      },
    },
  }
  try {
    // eslint-disable-next-line no-eval
    ;(0, eval)(readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8'))
  } finally {
    delete globalThis.window
  }
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-focus-free-shortcuts')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-focus-free-shortcuts')
  check('inject 声明', plugin.inject, ['shortcuts'])

  let cancelled = 0
  const shortcuts = fakeShortcuts({
    rows: [row('pane.fullscreen.toggle', FULLSCREEN_BINDING)],
  })
  const sidebar = fakeSidebar()
  sidebar.command = { paneId: 'p1' }
  const ctx = new FakeCtx({
    shortcuts,
    sidebarRight: sidebar,
    sessions: fakeSessions({ summary: { s1: session('s1') }, scope: () => ({ get: () => ({ cancel: () => { cancelled += 1; return Promise.resolve() } }) }) }),
  })
  const warnings = captureWarnings(() => plugin.apply(ctx))
  check('产物装配无告警', warnings, [])
  shortcuts.emit(keydown(FULLSCREEN_PRESS, shortcutContext({ target: domComposer })).input)
  check('产物里全屏桥接生效', sidebar.calls, [['fullscreen', { paneId: 'p1' }]])
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  shortcuts.emit(keydown(gesture('Escape'), shortcutContext({ target: domBody })).input)
  check('产物里停止桥接生效', cancelled, 1)
}

finish()
