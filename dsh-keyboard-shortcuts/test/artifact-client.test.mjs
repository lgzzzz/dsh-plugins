/**
 * 产物装配：`lib/client.js` 注册正确的模块 id / 插件名 / inject 声明，不请求任何模块；
 * 装配后固定行生效，按键调用官方命令注册表。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部），需要先构建。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fakeCtx,
  fakeShortcuts,
  fakeWindow,
  finish,
  fixedKeydown,
  check,
  checkTrue,
} from './helpers.mjs'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 加载产物，返回注册项、插件导出与它请求过的模块。 */
function loadArtifact() {
  let registration = null
  const requested = []
  const previousWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load: (value) => {
        registration = value
      },
    },
  }
  try {
    ;(0, eval)(readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8'))
  } finally {
    globalThis.window = previousWindow
  }
  const plugin = registration.factory((specifier) => {
    requested.push(specifier)
    throw new Error(`产物请求了未提供的模块：${specifier}`)
  })
  return { registration, plugin, requested }
}

console.log('--- C① 模块表注册与声明 ---')
const { registration, plugin, requested } = loadArtifact()
{
  checkTrue('有注册项', registration !== null)
  check('模块 id', registration.id, 'dsh-keyboard-shortcuts')
  check('插件名', plugin.name, 'dsh-keyboard-shortcuts')
  check('inject 声明', plugin.inject, ['shortcuts'])
  check('不请求任何模块', requested, [])
}

console.log('--- C② 产物装配后调用官方命令 ---')
{
  const previousWindow = globalThis.window
  globalThis.window = fakeWindow()
  try {
    const shortcuts = fakeShortcuts()
    const ctx = fakeCtx({ shortcuts })
    plugin.apply(ctx)
    check('八条固定行', shortcuts.commands.length, 8)
    check(
      '固定行 id',
      shortcuts.commands.map((command) => command.id),
      [
        'dsh-keyboard-shortcuts.session.new',
        'dsh-keyboard-shortcuts.sidebar.left.toggle',
        'dsh-keyboard-shortcuts.workspace.openLocal',
        'dsh-keyboard-shortcuts.sidebar.right.toggle',
        'dsh-keyboard-shortcuts.workspace.files',
        'dsh-keyboard-shortcuts.terminal.new',
        'dsh-keyboard-shortcuts.pane.fullscreen.toggle',
        'dsh-keyboard-shortcuts.page.close',
      ],
    )
    shortcuts.fire(fixedKeydown('KeyN', { control: true, alt: true }))
    check('调用官方命令', shortcuts.invocations.map((entry) => entry.id), ['session.new'])
    check('命令上下文', shortcuts.invocations[0].context.region, 'page')
  } finally {
    globalThis.window = previousWindow
  }
}

finish()
