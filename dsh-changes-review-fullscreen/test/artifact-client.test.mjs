/**
 * 产物装配：`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名，装配后扫描已有审查标签页、
 * 观察新挂载与面板呈现方式变化，并在卸载时断开观察与移除标记。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  APPLIED_MARKER,
  INSTALL_MARKER,
  REVIEW_SELECTOR,
} from '../src/split-default.ts'
import {
  FakeDocument,
  FakeObserver,
  check,
  checkTrue,
  finish,
  loadClientArtifact,
  makeReview,
  makeScheduler,
  makeWarningSink,
  pluginRoot,
} from './helpers.mjs'

const EFFECT_LABEL = 'dsh-changes-review-fullscreen: review split follows panel mode'
const PLUGIN_NAME = 'dsh-changes-review-fullscreen'

console.log('--- V① lib/client.js 注册与声明 ---')
{
  const registration = loadClientArtifact()
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, PLUGIN_NAME)

  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块：本插件不应有任何 external')
  })
  check('插件名', plugin.name, PLUGIN_NAME)
  checkTrue('apply 为函数', typeof plugin.apply === 'function')
}

console.log('--- V② 装配后按面板呈现方式设默认分栏 ---')
{
  FakeObserver.reset()
  const registration = loadClientArtifact()
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块')
  })

  const initial = makeReview({ mode: 'push', pressed: true, occurrence: 'occ-artifact' })
  const doc = new FakeDocument({ roots: [initial.root] })
  const scheduler = makeScheduler()
  const warnings = makeWarningSink()
  const previous = globalThis.document
  globalThis.document = doc
  const effects = []
  try {
    plugin.apply({
      inject: () => {
        throw new Error('本插件不注入右栏服务')
      },
      effect: (execute, label) => {
        effects.push({ disposer: execute(), label })
      },
    })
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
  // 观察器里的重试走真实 rAF；本测试只看已 seed 的初始根，无需等重试。
  void scheduler
  void warnings

  check('effect 注册一次', effects.length, 1)
  check('effect 标签', effects[0]?.label, EFFECT_LABEL)
  check('装上后写入安装标记', doc.documentElement.getAttribute(INSTALL_MARKER), '')
  check('初始审查根已切成单栏', initial.calls, ['unified'])
  check('审查根留下呈现方式标记', initial.root.getAttribute(APPLIED_MARKER), 'push')
  check('观察器已装配', FakeObserver.last()?.observed.length, 1)

  effects[0].disposer()
  check('卸载断开观察', FakeObserver.last().disconnected, true)
  check('卸载移除安装标记', doc.documentElement.getAttribute(INSTALL_MARKER), null)
}

console.log('--- V③ 产物里的稳定契约 ---')
{
  const text = readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8')
  for (const token of [
    REVIEW_SELECTOR, 'data-review-tool', 'split', 'data-sidebar-right-panel',
    'push', 'fullscreen', 'toggledSplit', 'aria-pressed', APPLIED_MARKER, INSTALL_MARKER,
  ]) {
    checkTrue(`产物含 ${token}`, text.includes(token))
  }
  checkTrue('产物不再认改动文件卡片', text.includes('data-changed-files') === false)
  checkTrue('产物不再调用旧的全屏切换入口', text.includes('toggleFullscreen') === false)
}

finish()
