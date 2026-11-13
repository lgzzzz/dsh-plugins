/**
 * 产物装配：`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名，装配后点标题真的打开
 * 「本地变更」标签页、右键真的用宿主菜单回到上游，并在卸载时移除监听与标记。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CARD_SELECTOR,
  LOCAL_CHANGES_PREFIX,
  MARKER_ATTRIBUTE,
  MENU_TARGET,
} from '../src/install.ts'
import {
  FakeDocument,
  FakeElement,
  attachClickHandler,
  check,
  checkTrue,
  fakeLocale,
  fakeMenus,
  fakeSidebar,
  fakeTabs,
  finish,
  loadClientArtifact,
  pluginRoot,
  pointerEvent,
} from './helpers.mjs'

const EFFECT_LABEL = 'dsh-changes-card-local: card title opens local changes'

/** 多文件卡片：标题 + 一行文件。 */
function multiCard() {
  const card = new FakeElement('div', { 'data-changed-files': '' })
  const header = card.append(new FakeElement('button'))
  const list = card.append(new FakeElement('ul'))
  const row = list.append(new FakeElement('li'))
  const rowButton = row.append(new FakeElement('button', { 'aria-describedby': 'p-0' }))
  return { card, header, rowButton }
}

/** 装配产物：假 Context 只提供 `inject` 与子作用域的 `get` / `effect`。 */
function assemble({ doc, services }) {
  const registration = loadClientArtifact()
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块：本插件不应有任何 external')
  })
  const effects = []
  const injects = []
  const previous = globalThis.document
  globalThis.document = doc
  try {
    plugin.apply({
      inject: (deps, callback) => {
        injects.push(deps)
        callback({
          get: (name) => services[name],
          effect: (execute, label) => {
            effects.push({ disposer: execute(), label })
          },
        })
      },
    })
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
  return { registration, plugin, effects, injects }
}

console.log('--- V① lib/client.js 注册与声明 ---')
{
  const registration = loadClientArtifact()
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-changes-card-local')

  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块')
  })
  check('插件名', plugin.name, 'dsh-changes-card-local')
  checkTrue('apply 为函数', typeof plugin.apply === 'function')
}

console.log('--- V② 装配后点标题打开本地变更，右键弹出快照菜单 ---')
{
  const doc = new FakeDocument()
  const sidebar = fakeSidebar({ sessionId: 'session-9' })
  const tabs = fakeTabs()
  const menus = fakeMenus()
  const locale = fakeLocale()
  const { effects, injects } = assemble({
    doc,
    services: { sidebarRight: sidebar, sidebarRightTabs: tabs, contextMenus: menus, locale },
  })

  check('依赖右栏服务', injects, [['sidebarRight']])
  check('effect 注册一次', effects.length, 1)
  check('effect 标签', effects[0]?.label, EFFECT_LABEL)
  check('装上后写入生效标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), '')
  check('装了三个捕获监听', doc.types.sort(), ['click', 'contextmenu', 'keydown'])

  const { header, rowButton } = multiCard()
  const click = pointerEvent(header)
  doc.dispatch('click', click)
  check('标题打开本地变更', sidebar.opened, ['dsh-resource://forge-changes/session-9/local'])
  check('标题点击阻止冒泡', click.stopped, 1)

  let upstream = 0
  attachClickHandler(rowButton, () => { upstream += 1 })
  const menu = pointerEvent(rowButton, { clientX: 5, clientY: 6 })
  doc.dispatch('contextmenu', menu)
  check('右键弹出宿主菜单', menus.opened.length, 1)
  check('菜单目标种类', menus.opened[0]?.target.kind, MENU_TARGET)
  check('右键阻止原生菜单', menu.prevented, 1)
  menus.registered[0].resolve({}, new AbortController().signal)[0].run()
  check('菜单执行回到上游', upstream, 1)

  effects[0].disposer()
  check('卸载后无监听', doc.types, [])
  check('卸载后移除标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
}

console.log('--- V③ 产物里的稳定契约 ---')
{
  const text = readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8')
  for (const token of [CARD_SELECTOR, LOCAL_CHANGES_PREFIX, 'aria-expanded', 'li', 'contextmenu', 'click', 'true', MARKER_ATTRIBUTE, MENU_TARGET, '__reactFiber$']) {
    checkTrue(`产物含 ${token}`, text.includes(token))
  }
}

finish()
