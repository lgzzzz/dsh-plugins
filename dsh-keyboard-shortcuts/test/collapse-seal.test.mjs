/**
 * 封口：目标轮次判定、组头显示、组体恢复、幂等与清理。
 *
 * 只构造假 DOM；不装桥、不发按键。封口的 CSS 语义由 `SEAL_CSS` 文本断言，真实几何
 * 由 docs/dsh-keyboard-shortcuts/09-collapse-steps.md 里的 CDP 验证覆盖。
 */
import {
  clearSeals,
  FLAT_ATTRIBUTE,
  installCollapseSeal,
  LOCK_ATTRIBUTE,
  SEAL_ATTRIBUTE,
  SEAL_CSS,
  sealableGroups,
  sealGroups,
  STYLE_ID,
  supportsSeal,
} from '../src/collapse-seal.ts'
import { check, checkTrue, FakeElement, finish } from './focus-helpers.mjs'

/** 一个过程组：组头容器 + 组体；`activity=false` 时没有组标题按钮。 */
function group({ turn = '1', flat = true, sealed = false, hidden = true, activity = true, expanded = 'false' } = {}) {
  const root = new FakeElement('div', {
    'data-step-process': '',
    'data-chat-turn': turn,
    ...(flat ? { [FLAT_ATTRIBUTE]: 'true' } : {}),
    ...(sealed ? { [SEAL_ATTRIBUTE]: '' } : {}),
  })
  const header = root.append(new FakeElement('div', hidden ? { hidden: '' } : {}))
  if (activity) header.append(new FakeElement('button', { 'data-process-activity': 'commands', 'aria-expanded': expanded }))
  const body = root.append(new FakeElement('div', { 'data-step-process-body': '' }))
  body.append(new FakeElement('div', { 'data-chat-flow-key': `${turn}:body` }))
  return { root, header, body }
}

/** 一个带锁 / 不带锁的轮次过程标题行。 */
function turnHeader(scroll, { turn = '1', locked = true, expanded = true } = {}) {
  const row = scroll.append(new FakeElement('div', { 'data-chat-turn': turn, 'data-chat-flow-kind': 'turn-process' }))
  return row.append(new FakeElement('button', {
    'data-turn-process': turn,
    'aria-expanded': String(expanded),
    ...(locked ? { [LOCK_ATTRIBUTE]: '' } : {}),
  }))
}

/** 一个主会话滚动口。 */
function scroll() {
  return new FakeElement('div', { 'data-conversation-scroll': '' })
}

console.log('--- S① 目标：最新一个带锁轮次的平铺组 ---')
{
  const root = scroll()
  turnHeader(root, { turn: '1' })
  turnHeader(root, { turn: '2' })
  const oldGroup = group({ turn: '1' })
  const latest = group({ turn: '2' })
  const grouped = group({ turn: '2', flat: false })
  const sealed = group({ turn: '2', sealed: true })
  const noActivity = group({ turn: '2', activity: false })
  const otherTurn = group({ turn: '3' })
  for (const item of [oldGroup, latest, grouped, sealed, noActivity, otherTurn]) root.append(item.root)
  const groups = sealableGroups(root)
  checkTrue('只封最新锁轮次的平铺组', groups.length === 1 && groups[0] === latest.root)
}

console.log('--- S② 没有锁 / 锁标题折叠 / 没有轮次 ---')
{
  const unlocked = scroll()
  turnHeader(unlocked, { turn: '1', locked: false })
  unlocked.append(group({ turn: '1' }).root)
  check('无锁不封', sealableGroups(unlocked), [])

  const folded = scroll()
  turnHeader(folded, { turn: '1', expanded: false })
  folded.append(group({ turn: '1' }).root)
  check('锁标题折叠时不封（锁定器会在下一拍重开）', sealableGroups(folded), [])

  const empty = scroll()
  check('没有轮次标题', sealableGroups(empty), [])
}

console.log('--- S③ 同一轮多个组：全部封口 ---')
{
  const root = scroll()
  turnHeader(root, { turn: '1' })
  const a = group({ turn: '1' })
  const b = group({ turn: '1' })
  root.append(a.root)
  root.append(b.root)
  check('两个组', sealableGroups(root).length, 2)
}

console.log('--- S④ 应用：写标记、移除组头 hidden、幂等 ---')
{
  const root = scroll()
  turnHeader(root, { turn: '1' })
  const first = group({ turn: '1' })
  const second = group({ turn: '1' })
  root.append(first.root)
  root.append(second.root)
  check('封口两个', sealGroups(sealableGroups(root)), 2)
  check('组根有标记', [first.root.hasAttribute(SEAL_ATTRIBUTE), second.root.hasAttribute(SEAL_ATTRIBUTE)], [true, true])
  check('组头 hidden 被移除', [first.header.hasAttribute('hidden'), second.header.hasAttribute('hidden')], [false, false])
  check('组体未被改动', first.body.hasAttribute('hidden'), false)
  check('再次封口不再计数', sealGroups(sealableGroups(root)), 0)
  check('直接重复调用也幂等', sealGroups([first.root, second.root]), 0)
}

console.log('--- S⑤ 组头不可用时整组跳过（不藏内容） ---')
{
  const root = scroll()
  turnHeader(root, { turn: '1' })
  const noActivity = group({ turn: '1', activity: false })
  root.append(noActivity.root)
  check('不进入目标', sealableGroups(root), [])
  check('直接调用也不写标记', sealGroups([noActivity.root]), 0)
  check('组体没有被 CSS 误藏（标记不存在）', noActivity.root.hasAttribute(SEAL_ATTRIBUTE), false)
}

console.log('--- S⑥ 清理：仍平铺的写回 hidden，已分组的只移标记 ---')
{
  const root = scroll()
  turnHeader(root, { turn: '1' })
  const flat = group({ turn: '1' })
  const nowGrouped = group({ turn: '1', flat: false, hidden: false })
  root.append(flat.root)
  root.append(nowGrouped.root)
  sealGroups([flat.root, nowGrouped.root])
  check('清理两个', clearSeals(root), 2)
  check('平铺组恢复 hidden', flat.header.hasAttribute('hidden'), true)
  check('平铺组移除标记', flat.root.hasAttribute(SEAL_ATTRIBUTE), false)
  check('已分组组不写回 hidden', nowGrouped.header.hasAttribute('hidden'), false)
  check('已分组组移除标记', nowGrouped.root.hasAttribute(SEAL_ATTRIBUTE), false)
  check('再次清理为空', clearSeals(root), 0)
}

console.log('--- S⑦ CSS 契约：三段规则都要求平铺 + 封口 ---')
{
  check('规则条数', SEAL_CSS.split('\n').length, 3)
  checkTrue('隐藏组体要求组头存在', SEAL_CSS.includes(':has(> div > [data-process-activity]) > [data-step-process-body]'))
  checkTrue('组头展开时放回组体', SEAL_CSS.includes('[aria-expanded="true"]) > [data-step-process-body]'))
  checkTrue('组头 hidden 兜底显示', SEAL_CSS.includes('> div[hidden]:has([data-process-activity])'))
  checkTrue('全部带平铺标记', SEAL_CSS.split('\n').every((line) => line.includes(`[${FLAT_ATTRIBUTE}]`)))
  checkTrue('全部带封口标记', SEAL_CSS.split('\n').every((line) => line.includes(`[${SEAL_ATTRIBUTE}]`)))
  checkTrue('支持 :has 时启用', supportsSeal())
}

console.log('--- S⑧ 样式：只插一条、共用、卸载移除并清封口 ---')
{
  const makeDocument = () => {
    const doc = {
      head: {
        nodes: [],
        append(node) {
          doc.head.nodes.push(node)
          node.parent = doc.head
        },
      },
      createElement(tag) {
        return {
          tag,
          dataset: {},
          textContent: '',
          removed: false,
          remove() { this.removed = true },
        }
      },
      querySelector() { return null },
      querySelectorAll() { return [] },
    }
    return doc
  }
  const previous = globalThis.document
  const doc = makeDocument()
  globalThis.document = doc
  try {
    const effects = []
    const ctx = {
      effect(callback, label) {
        effects.push({ disposer: callback(), label })
      },
    }
    installCollapseSeal(ctx)
    installCollapseSeal(ctx)
    check('两个作用域共用一条样式', doc.head.nodes.length, 1)
    check('样式标识', doc.head.nodes[0]?.dataset?.pluginCss, STYLE_ID)
    check('样式内容', doc.head.nodes[0]?.textContent, SEAL_CSS)
    check('effect 标签', effects.map((item) => item.label), [
      'dsh-keyboard-shortcuts: collapse seal style',
      'dsh-keyboard-shortcuts: collapse seal style',
    ])

    effects[0].disposer()
    check('还有一个持有者时不移除', doc.head.nodes[0]?.removed, false)
    effects[1].disposer()
    check('最后一个持有者移除样式', doc.head.nodes[0]?.removed, true)
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

finish()
