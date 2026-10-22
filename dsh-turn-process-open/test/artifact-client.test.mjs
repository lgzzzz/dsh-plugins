/**
 * 产物装配：`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名，装配后真的写入
 * 展开记录、加锁、拦可信点击、挂上折叠固定行，并在卸载时清理全部副作用。
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
import {
  fakeShortcuts,
  FakeCtx,
  gesture,
  keydown,
  shortcutContext,
} from './collapse-helpers.mjs'
import { PIN_ATTRIBUTE, PIN_CSS, STYLE_ID } from '../src/pin.ts'
import { COLLAPSE_STEPS_ID, collapseStepsCommand } from '../src/collapse-steps.ts'
import { SEAL_CSS, STYLE_ID as SEAL_STYLE_ID } from '../src/collapse-seal.ts'

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
  return { app, main, session, scroll, header }
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

console.log('--- A② 装配后的锁定行为 + 折叠固定行 ---')
{
  const registration = loadClientArtifact()
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块')
  })
  const record = []
  const { app, scroll, header } = page(record)
  const groupRoot = scroll.append(new FakeElement('div', { 'data-step-process': '' }))
  const group = groupRoot.append(new FakeElement('button', {
    'data-process-activity': 'commands',
    'aria-expanded': 'true',
  }))
  group.clicks = 0
  group.click = () => {
    group.clicks += 1
    group.setAttribute('aria-expanded', 'false')
  }
  const doc = new FakeDocument({ root: app })
  const shortcuts = fakeShortcuts({ platform: 'windows' })
  const ctx = new FakeCtx({ shortcuts })
  const previous = globalThis.document
  globalThis.document = doc
  try {
    plugin.apply(ctx)
    checkTrue('锁定 effect 已注册', ctx.effects.some((effect) => effect.label === EFFECT_LABEL))
    check('写入展开记录', record, [[1, 0, true]])
    checkTrue('标题带锁标记', header.hasAttribute(PIN_ATTRIBUTE))
    check('锁标记的值是实例 id', typeof header.getAttribute(PIN_ATTRIBUTE), 'string')
    check('样式标签数（锁 + 封口）', doc.head.nodes.length, 2)
    check('锁定样式内容', doc.head.nodes.find((node) => node.dataset?.pluginCss === STYLE_ID)?.textContent, PIN_CSS)
    check('封口样式内容', doc.head.nodes.find((node) => node.dataset?.pluginCss === SEAL_STYLE_ID)?.textContent, SEAL_CSS)

    checkTrue('折叠固定行已注册', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === COLLAPSE_STEPS_ID))
    check('折叠固定行键帽', shortcuts.fixedCatalog.getSnapshot().find((entry) => entry.id === COLLAPSE_STEPS_ID)?.keys,
      collapseStepsCommand('windows').keys)

    const press = keydown(gesture('Period', { control: true, alt: true }), shortcutContext({ target: null }))
    shortcuts.emit(press.input)
    check('折叠键点击过程组', group.clicks, 1)
    check('折叠键被消费', press.consumed.count, 1)
    check('锁定标题不被折叠', header.getAttribute('aria-expanded'), 'true')
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }

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

  for (const effect of ctx.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  check('卸载移除锁标记', header.hasAttribute(PIN_ATTRIBUTE), false)
  check('卸载移除样式', doc.head.nodes.every((node) => node.removed === true), true)
  check('卸载移除点击监听', doc.listeners.length, 0)
  check('卸载移除固定行', shortcuts.fixedCatalog.getSnapshot().some((entry) => entry.id === COLLAPSE_STEPS_ID), false)
}

console.log('--- A③ 产物里的稳定契约 ---')
{
  const text = readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8')
  checkTrue('产物含标题锚点', text.includes('[data-turn-process]'))
  checkTrue('产物含锁标记', text.includes(PIN_ATTRIBUTE))
  // 箭头隐藏规则的两条锚点都要进产物：`> svg` 是纯文本，`class*="_chevron"` 里的引号
  // 会被打包器按外层字符串的引号风格转义（当前产物是 `class*=\"_chevron\"`），故按可选引号匹配。
  checkTrue('产物含箭头锚点（直接子 svg）', text.includes('[data-turn-process-locked] > svg'))
  checkTrue('产物含箭头锚点（chevron 局部类名）', /class\*=\\?"?_chevron/.test(text))
  checkTrue('产物含锁定样式标识', text.includes(STYLE_ID))
  checkTrue('产物含 fiber 前缀', text.includes('__reactFiber$'))
  checkTrue('产物含 store 动作名', text.includes('setTurnProcessOpen'))
  checkTrue('产物含 MutationObserver', text.includes('MutationObserver'))
  checkTrue('产物含折叠固定行 id', text.includes(COLLAPSE_STEPS_ID))
  checkTrue('产物含封口标记', text.includes('data-dsh-collapse-sealed'))
  checkTrue('产物含阅读行锚点', text.includes('data-chat-flow-key'))
}

finish()
