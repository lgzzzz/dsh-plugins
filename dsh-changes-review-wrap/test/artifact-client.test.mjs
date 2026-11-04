/**
 * 产物装配：`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名，装配后真的把
 * 打开中的审查标签页写成换行态，并在卸载时断开观察、移除安装标记。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  APPLIED_MARKER,
  INSTALL_MARKER,
  name,
} from '../src/wrap-default.ts'
import {
  FakeDocument,
  FakeObserver,
  check,
  checkTrue,
  finish,
  loadClientArtifact,
  makeReview,
  pluginRoot,
} from './helpers.mjs'

const EFFECT_LABEL = 'dsh-changes-review-wrap: review wrap default'

console.log('--- K① lib/client.js 注册与声明 ---')
{
  const registration = loadClientArtifact()
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, name)
  checkTrue('注册行是延迟工厂', typeof registration?.factory === 'function')
}

console.log('--- K② 装配后的默认换行 ---')
{
  const registration = loadClientArtifact()
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应要求 cordis 以外的 external')
  })
  check('插件名', plugin.name, name)
  checkTrue('apply 为函数', typeof plugin.apply === 'function')

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
  check('装上后写入安装标记', doc.documentElement.getAttribute(INSTALL_MARKER), '')

  const { root, calls } = makeReview({ wrap: false })
  FakeObserver.last().emit([{ addedNodes: [root] }])
  check('新增审查根时写入一次', calls.length, 1)
  check('根上留下生效标记', root.getAttribute(APPLIED_MARKER), '')

  effects[0].disposer()
  check('卸载后移除安装标记', doc.documentElement.getAttribute(INSTALL_MARKER), null)
  checkTrue('卸载后断开观察', FakeObserver.last()?.disconnected === true)
}

console.log('--- K③ 产物里的稳定契约 ---')
{
  const text = readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8')
  // 选择器在打包后的字符串里是转义形式（`[data-review-tool=\"wrap\"]`），按转义后的片段比对。
  for (const token of ['[data-changes-review]', '[data-review-tool=\\"wrap\\"]', '[data-review-view]', 'data-review-wrap', 'data-sidebar-right-occurrence']) {
    checkTrue(`产物含锚点 ${token}`, text.includes(token))
  }
  checkTrue('产物含安装标记', text.includes(INSTALL_MARKER))
  checkTrue('产物含生效标记', text.includes(APPLIED_MARKER))
  checkTrue('产物用 MutationObserver', text.includes('MutationObserver'))
  checkTrue('产物用 fiber 读取 onClick', text.includes('__reactFiber$'))
}

finish()

