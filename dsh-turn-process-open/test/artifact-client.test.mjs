/**
 * 产物装配：`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名，装配后真的写入
 * 展开记录、加锁、拦可信点击，并在卸载时清理全部副作用。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部），需要先构建。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  actionsProps,
  attachFiber,
  check,
  checkTrue,
  FakeDocument,
  FakeElement,
  finish,
  loadClientArtifact,
  pluginRoot,
  turnProcessProps,
} from './helpers.mjs'
import { PIN_ATTRIBUTE, PIN_CSS, STYLE_ID } from '../src/pin.ts'

const EFFECT_LABEL = 'dsh-turn-process-open: turn process lock'

/** 主会话页面与一个展开的可折标题。 */
function page(record) {
  const app = new FakeElement('div')
  const main = app.append(new FakeElement('div', { 'data-slot': 'main.conversation' }))
  const session = main.append(new FakeElement('div', { 'data-conversation-session': 's1' }))
  const scroll = session.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  const header = scroll.append(new FakeElement('button', {
    'data-turn-process': '1',
    'aria-expanded': 'true',
  }))
  attachFiber(
    header,
    turnProcessProps({ turn: 1, answerStep: 0 }),
    actionsProps((...args) => record.push(args)),
  )
  return { app, header }
}

console.log('--- A① lib/client.js 注册与声明 ---')
{
  const registration = loadClientArtifact()
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-turn-process-open')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块：本插件不应有 external')
  })
  check('插件名', plugin.name, 'dsh-turn-process-open')
  checkTrue('apply 为函数', typeof plugin.apply === 'function')
}

console.log('--- A② 装配后的锁定行为 ---')
{
  const registration = loadClientArtifact()
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块')
  })
  const record = []
  const { app, header } = page(record)
  const doc = new FakeDocument({ root: app })
  const effects = []
  const previous = globalThis.document
  globalThis.document = doc
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
  check('写入展开记录', record, [[1, 0, true]])
  check('标题带锁标记', header.getAttribute(PIN_ATTRIBUTE), '')
  check('样式标签', doc.head.nodes.length, 1)
  check('样式内容', doc.head.nodes[0]?.textContent, PIN_CSS)

  const trusted = {
    isTrusted: true,
    target: header,
    prevented: 0,
    stopped: 0,
    preventDefault() { this.prevented += 1 },
    stopPropagation() { this.stopped += 1 },
  }
  doc.dispatch('click', trusted)
  check('可信点击被拦', [trusted.prevented, trusted.stopped], [1, 1])

  const untrusted = {
    isTrusted: false,
    target: header,
    prevented: 0,
    stopped: 0,
    preventDefault() { this.prevented += 1 },
    stopPropagation() { this.stopped += 1 },
  }
  doc.dispatch('click', untrusted)
  check('不可信点击放行', [untrusted.prevented, untrusted.stopped], [0, 0])

  effects[0].disposer()
  check('卸载移除锁标记', header.hasAttribute(PIN_ATTRIBUTE), false)
  check('卸载移除样式', doc.head.nodes[0]?.removed, true)
  check('卸载移除点击监听', doc.listeners.length, 0)
}

console.log('--- A③ 产物里的稳定契约 ---')
{
  const text = readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8')
  checkTrue('产物含标题锚点', text.includes('[data-turn-process]'))
  checkTrue('产物含锁标记', text.includes(PIN_ATTRIBUTE))
  checkTrue('产物含样式标识', text.includes(STYLE_ID))
  checkTrue('产物含 fiber 前缀', text.includes('__reactFiber$'))
  checkTrue('产物含 store 动作名', text.includes('setTurnProcessOpen'))
  checkTrue('产物含 MutationObserver', text.includes('MutationObserver'))
}

finish()
