/**
 * 产物装配：`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名，装配后点击改动文件卡片
 * 真的把活动审查标签页切成全屏，并在卸载时移除监听与标记。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CARD_SELECTOR,
  FakeDocument,
  FakeElement,
  MARKER_ATTRIBUTE,
  check,
  checkTrue,
  clickEvent,
  fakeSidebar,
  finish,
  loadClientArtifact,
  pluginRoot,
} from './helpers.mjs'

const EFFECT_LABEL = 'dsh-changes-review-fullscreen: review fullscreen on open'

/** 一张带可点击文件行的改动文件卡片。 */
function reviewedCard() {
  const root = new FakeElement('div', { 'data-changed-files': '' })
  const row = root.append(new FakeElement('button'))
  const text = row.append(new FakeElement('span'))
  return { root, row, text }
}

console.log('--- V① lib/client.js 注册与声明 ---')
{
  const registration = loadClientArtifact()
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-changes-review-fullscreen')

  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块：本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-changes-review-fullscreen')
  checkTrue('apply 为函数', typeof plugin.apply === 'function')
}

console.log('--- V② 装配后点击卡片，默认全屏打开审查页 ---')
{
  const registration = loadClientArtifact()
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块')
  })

  const doc = new FakeDocument({ mode: 'push' })
  const sidebar = fakeSidebar()
  const previous = globalThis.document
  globalThis.document = doc
  const effects = []
  try {
    plugin.apply({
      inject: (deps, callback) => {
        check('依赖右栏服务', deps, ['sidebarRight'])
        callback({
          sidebarRight: sidebar,
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

  check('effect 注册一次', effects.length, 1)
  check('effect 标签', effects[0]?.label, EFFECT_LABEL)
  check('注册 click 捕获监听', [...doc.types], ['click'])
  check('装上后写入生效标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), '')

  const { text } = reviewedCard()
  doc.dispatch('click', clickEvent(text))
  await Promise.resolve()
  check('点击后切全屏', sidebar.calls, [['fullscreen', { host: 'dock' }]])

  effects[0].disposer()
  check('卸载后无监听', doc.types, [])
  check('卸载后移除标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
}

console.log('--- V③ 产物里的稳定契约 ---')
{
  const text = readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8')
  for (const token of [CARD_SELECTOR, 'data-sidebar-right-panel', 'push', 'fullscreen', 'changes-review', 'toggleFullscreen', MARKER_ATTRIBUTE]) {
    checkTrue(`产物含 ${token}`, text.includes(token))
  }
  checkTrue('产物在 document 捕获阶段监听 click', text.includes('click') && text.includes('true'))
}

finish()
