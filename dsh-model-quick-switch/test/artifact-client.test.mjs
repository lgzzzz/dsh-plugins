/**
 * 产物装配：`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名 / inject 声明，并且只向
 * 模块表要 `react`；装配后固定行、浮层与设置页都生效，`Ctrl+Alt+U`（macOS 是 `⌃⌥U`）能打开候选、`Enter` 会走
 * `session.selectModel`。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部），需要先构建 `lib/client.js`。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as reactNamespace from 'react'

import {
  catalogOf,
  check,
  checkTrue,
  fakeConfigForm,
  fakeConfigForms,
  fakeCtx,
  fakeRemote,
  fakeSessions,
  fakeShortcuts,
  fakeSlots,
  finish,
  fixedKeydown,
  installDom,
  pluginRoot,
  renderSlotEntry,
  tick,
} from './helpers.mjs'

const { installPaletteKeys } = await import('../src/palette.ts')

const reactModule = reactNamespace.default ?? reactNamespace

/** 加载产物，返回它注册进模块表的内容与它要过的模块。 */
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
    if (specifier !== 'react') throw new Error(`产物要求了未提供的模块：${specifier}`)
    return reactModule
  })
  return { registration, plugin, requested }
}

const CATALOG = catalogOf([
  { provider: 'deepseek', model: 'deepseek-chat', name: 'DeepSeek Chat' },
  { provider: 'opencode-go', model: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
])

/** 起一份装着假服务的上下文。 */
function setup(plugin, { platform = 'windows' } = {}) {
  const dom = installDom()
  const slots = fakeSlots()
  const shortcuts = fakeShortcuts({ platform })
  const form = fakeConfigForm({
    value: {
      models: [
        { provider: 'deepseek', model: 'deepseek-chat' },
        { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
      ],
    },
  })
  const remote = fakeRemote({ catalog: CATALOG })
  const ctx = fakeCtx({
    slots,
    shortcuts,
    configForms: fakeConfigForms(form),
    sessions: fakeSessions({
      current: 's1',
      byId: { s1: { id: 's1', title: '会话 1', updatedAt: 1 } },
      modelSelection: { next: { provider: 'deepseek', model: 'deepseek-chat' } },
    }),
    remote,
  })
  plugin.apply(ctx)
  const overlay = slots.registered.find((entry) => entry.options?.name === 'shell.overlay')
  const section = slots.registered.find((entry) => entry.options?.name === 'settings.section')
  return {
    dom,
    slots,
    shortcuts,
    form,
    remote,
    ctx,
    overlay,
    section,
    props: overlay?.options.inject?.(),
    html: () => renderSlotEntry(overlay),
    settingsHtml: () => renderSlotEntry(section),
  }
}

/** 从浮层 HTML 里读候选行标题。 */
function rowTitles(html) {
  return [...html.matchAll(/dsh-model-quick-switch-name">([^<]*)</g)].map(([, title]) => title)
}

console.log('--- D① 模块表注册与声明 ---')
const { registration, plugin, requested } = loadArtifact()
{
  checkTrue('有注册项', registration !== null)
  check('模块 id', registration.id, 'dsh-model-quick-switch')
  check('只向模块表要 react', requested, ['react'])
  check('插件名', plugin.name, 'dsh-model-quick-switch')
  check('inject 声明', plugin.inject, ['slots', 'shortcuts'])
  check('导出了浮层文案', plugin.MODEL_VIEW.title, '快捷菜单')
  check('导出了按键解码', plugin.paletteAction({ key: 'Enter' }), 'confirm')
}

console.log('--- D② 产物装配:固定行、浮层、设置页、候选与切换 ---')
{
  const fixture = setup(plugin)
  check('固定行', fixture.shortcuts.commands.map((command) => command.id), ['dsh-model-quick-switch.model-switch'])
  check('固定行键帽', fixture.shortcuts.commands[0].keys, ['Ctrl', 'Alt', 'U'])
  check('浮层与设置页注册', fixture.slots.registered.map((entry) => entry.options.name), ['shell.overlay', 'settings.section'])
  check('未打开时为空', fixture.html(), '')
  check('设置页有标题', fixture.settingsHtml().includes('模型快速切换'), true)

  fixture.shortcuts.fire(fixedKeydown())
  await tick()
  check('这一次按键被消费', fixture.shortcuts.consumeCalls(), 1)
  check('候选来自设置 + 目录名', rowTitles(fixture.html()), ['新建工作树', '团队协作', 'DeepSeek Chat', 'DeepSeek V4.1 Flash'])

  const off = installPaletteKeys(fixture.props.store, fixture.dom.document)
  fixture.dom.pressKey('ArrowDown')
  fixture.dom.pressKey('Enter')
  await tick()
  check('Enter 走 session.selectModel', fixture.remote.selectCalls, [{
    sessionId: 's1',
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
  }])
  check('成功后关闭', fixture.props.store.getSnapshot().open, false)
  off()
  fixture.ctx.dispose()
  check('卸载撤掉终端捕获', fixture.dom.windowListenerCount(), 0)
}

console.log('--- D③ 设置页写入也随产物发布 ---')
{
  const fixture = setup(plugin)
  await fixture.section.options.inject().actions.add({ provider: 'deepseek', model: 'deepseek-chat' })
  check('已存在时不写入', fixture.form.calls.length, 0)
  await fixture.section.options.inject().actions.remove({ provider: 'deepseek', model: 'deepseek-chat' })
  check('删除写回 models', fixture.form.calls[0].ops, [{
    op: 'set',
    path: ['models'],
    value: [{ provider: 'opencode-go', model: 'deepseek-v4.1-flash' }],
  }])
  fixture.ctx.dispose()
}

console.log('--- D④ 依赖缺失时产物只是不安装,不抛 ---')
{
  const slots = fakeSlots()
  const ctx = fakeCtx({ slots })
  plugin.apply(ctx)
  check('缺 shortcuts 时没有注册任何槽位', slots.registered, [])
  check('ctx.inject 报出缺失项', ctx.missing, ['shortcuts'])
}

finish()
