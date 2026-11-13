/**
 * 产物装配：`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名，装配后六条行为
 * 同时生效，并在卸载时清理；同时校验产物里保留的上游锚点与行为 token。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MARKER_ATTRIBUTE } from '../src/install.ts'
import { MARKER_ATTRIBUTE as CARD_MARKER } from '../src/card.ts'
import { INSTALL_MARKER as SPLIT_MARKER } from '../src/split-default.ts'
import { INSTALL_MARKER as WRAP_MARKER } from '../src/wrap-default.ts'
import { MARKER_ATTRIBUTE as HOVER_MARKER } from '../src/hover-gate.ts'
import { MARKER_ATTRIBUTE as FONT_MARKER } from '../src/font-14.ts'
import { INSTALL_MARKER as TREE_MARKER, PANE_MARKER, STORAGE_KEY } from '../src/tree-width.ts'
import {
  attachSidebarPanel,
  check,
  checkTrue,
  fakeLocale,
  fakeMenus,
  fakeTabs,
  finish,
  loadClientArtifact,
  pluginRoot,
  pointerEvent,
} from './card-helpers.mjs'
import { FullDocument, fakePolicySidebar, multiCard } from './full-document.mjs'

const EFFECT_LABEL = 'dsh-changes-behavior: changes panel behavior'

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
        if (deps.some((name) => services[name] === undefined)) return
        callback({
          ...services,
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

console.log('--- A① lib/client.js 注册与声明 ---')
{
  const registration = loadClientArtifact()
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-changes-behavior')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块')
  })
  check('插件名', plugin.name, 'dsh-changes-behavior')
  checkTrue('apply 为函数', typeof plugin.apply === 'function')
}

console.log('--- A② 装配后六条行为同时生效 ---')
{
  const doc = new FullDocument()
  attachSidebarPanel(doc, { sessionId: 'session-9', mode: 'push' })
  const sidebar = fakePolicySidebar({ sessionId: 'session-9' })
  const tabs = fakeTabs()
  const menus = fakeMenus()
  const locale = fakeLocale()
  const { effects, injects } = assemble({
    doc,
    services: { sidebarRight: sidebar, sidebarRightTabs: tabs, contextMenus: menus, locale },
  })

  check('先注入右栏，再为空缺的快捷键让位', injects, [['sidebarRight'], ['shortcuts', 'sidebarRight']])
  check('effect 注册一次', effects.length, 1)
  check('effect 标签', effects[0]?.label, EFFECT_LABEL)
  for (const [label, marker] of [
    ['总装', MARKER_ATTRIBUTE], ['卡片', CARD_MARKER], ['分栏', SPLIT_MARKER],
    ['换行', WRAP_MARKER], ['悬停', HOVER_MARKER], ['字号', FONT_MARKER], ['文件树宽度', TREE_MARKER],
  ]) {
    check(`${label}标记`, doc.documentElement.getAttribute(marker), '')
  }
  checkTrue('注入 14px 样式', String(doc.head.child?.textContent).includes('[data-forge-changes]'))

  const { header } = multiCard()
  const event = pointerEvent(header)
  doc.dispatch('click', event)
  check('标题打开本地变更', sidebar.opened, ['dsh-resource://forge-changes/session-9/local'])
  check('标题点击切全屏一次', sidebar.toggles.length, 1)
  check('标题点击阻止冒泡', event.stopped, 1)

  effects[0].disposer()
  check('卸载后无捕获监听', doc.types, [])
  check('卸载后移除总装标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
}

console.log('--- A③ 产物里的稳定行为 token ---')
{
  const text = readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8')
  const tokens = [
    'data-changed-files', 'data-changes-review', 'data-sidebar-right-panel',
    'openResource', 'openTab', 'openResourceIn', 'openTabIn',
    'toggleFullscreen', 'isTargetCurrent', 'commandTarget', '768',
    'toggledSplit', 'toggledWrap', 'data-review-tool', 'data-review-wrap',
    'openDelayMs: 500', 'data-changes-hover-preview',
    'data-forge-changes', 'data-forge-panel', 'font-size: 14px !important',
    'dsh-resource://forge-changes/', '__reactFiber$',
    'aria-valuenow', 'role', 'separator', 'aria-controls',
    STORAGE_KEY, PANE_MARKER,
    MARKER_ATTRIBUTE, CARD_MARKER, SPLIT_MARKER, WRAP_MARKER, HOVER_MARKER, FONT_MARKER, TREE_MARKER,
  ]
  for (const token of tokens) checkTrue(`产物含 ${token}`, text.includes(token))
}

finish()
