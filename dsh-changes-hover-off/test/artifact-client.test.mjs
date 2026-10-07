/**
 * 产物装配:`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名,装配后真的拦下
 * 改动文件卡片内的悬停手势、放行卡片外的手势,并在卸载时移除监听。
 *
 * 运行:`node test/artifact-client.test.mjs`(或 pnpm test 跑全部)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CARD_SELECTOR,
  FakeDocument,
  FakeObserver,
  HOVER_GESTURES,
  MARKER_ATTRIBUTE,
  PREVIEW_ATTRIBUTE,
  cardTarget,
  check,
  checkTrue,
  finish,
  hoverEvent,
  loadClientArtifact,
  outsideTarget,
  pluginRoot,
  shellElement,
} from './helpers.mjs'

const EFFECT_LABEL = 'dsh-changes-hover-off: changed-files hover gate'

console.log('--- E① lib/client.js 注册与声明 ---')
{
  const registration = loadClientArtifact()
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-changes-hover-off')

  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-changes-hover-off')
  checkTrue('apply 为函数', typeof plugin.apply === 'function')
}

console.log('--- E② 装配后的拦停行为 ---')
{
  const registration = loadClientArtifact()
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块')
  })

  const doc = new FakeDocument()
  FakeObserver.reset()
  const previous = globalThis.document
  globalThis.document = doc
  const effects = []
  try {
    plugin.apply({
      effect: (callback, label) => {
        effects.push({ disposer: callback(), label })
      },
    })
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }

  check('effect 注册一次', effects.length, 1)
  check('effect 标签', effects[0]?.label, EFFECT_LABEL)
  check('注册的手势集合', [...doc.types].sort(), [...HOVER_GESTURES].sort())
  check('装上后写入生效标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), '')

  const inside = hoverEvent(cardTarget())
  doc.dispatch('pointerover', inside)
  checkTrue('卡片内 pointerover 被消费', inside.stopped === true)

  const outside = hoverEvent(outsideTarget())
  doc.dispatch('mouseover', outside)
  checkTrue('卡片外 mouseover 被放行', outside.stopped === false)

  const shell = shellElement('child')
  FakeObserver.last()?.emit([{ addedNodes: [shell] }])
  check('网兜隐藏了 portal 外壳', shell.style.display, 'none')

  effects[0].disposer()
  check('卸载后无监听', doc.types.length, 0)
  check('卸载后移除标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
  checkTrue('卸载后断开观察', FakeObserver.last()?.disconnected === true)
}

console.log('--- E③ 产物里的稳定契约 ---')
{
  const text = readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8')
  checkTrue('产物含卡片锚点', text.includes(CARD_SELECTOR))
  for (const gesture of HOVER_GESTURES) checkTrue(`产物含手势 ${gesture}`, text.includes(gesture))
  checkTrue('产物含生效标记', text.includes(MARKER_ATTRIBUTE))
  checkTrue('产物含浮层标记', text.includes(PREVIEW_ATTRIBUTE))
  checkTrue('产物用 MutationObserver', text.includes('MutationObserver'))
}

finish()
