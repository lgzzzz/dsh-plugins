/**
 * 封口：目标轮次判定、组头显示、组体恢复、幂等与清理。
 *
 * 只构造假 DOM；不装桥、不发按键。封口的 CSS 语义由 `SEAL_CSS` 文本断言，真实几何
 * 由 docs/dsh-turn-process-open/01-collapse-steps.md 里的 CDP 验证覆盖。
 */
import {
  clearSeals,
  FLAT_ATTRIBUTE,
  installCollapseSeal,
  LIVE_ATTRIBUTE,
  LOCK_ATTRIBUTE,
  SEAL_ATTRIBUTE,
  SEAL_CSS,
  sealableGroups,
  sealGroups,
  STYLE_ID,
  supportsSeal,
} from '../src/collapse-seal.ts'
import { check, checkTrue, FakeElement, finish } from './collapse-helpers.mjs'

/**
 * 一个过程组：组头容器 + 组体；`activity=false` 时没有组标题按钮。
 * `live=true` 复刻“这一组还在输出”：上游 `TextShimmer active={!closed}` 会在组标题里留
 * `data-shimmer`，跑完之后标记消失。
 */
function group({ turn = '1', flat = true, sealed = false, hidden = true, activity = true, expanded = 'false', live = false } = {}) {
  const root = new FakeElement('div', {
    'data-step-process': '',
    'data-chat-turn': turn,
    ...(flat ? { [FLAT_ATTRIBUTE]: 'true' } : {}),
    ...(sealed ? { [SEAL_ATTRIBUTE]: '' } : {}),
  })
  const header = root.append(new FakeElement('div', hidden ? { hidden: '' } : {}))
  if (live) header.append(new FakeElement('span', { [LIVE_ATTRIBUTE]: '' }))
  if (activity) header.append(new FakeElement('button', { 'data-process-activity': 'commands', 'aria-expanded': expanded }))
  const body = root.append(new FakeElement('div', { 'data-step-process-body': '' }))
  body.append(new FakeElement('div', { 'data-chat-flow-key': `${turn}:body` }))
  return { root, header, body }
}

/**
 * 一个轮次过程标题行。
 *
 * `unfoldable` 复刻穿插输入的轮次：上游 `hasContent=false`，按钮渲染成 disabled 且
 * 完全不写 `aria-expanded`（见 ChatNodeSeat `hasContent: !interleavedInput && …`）。
 */
function turnHeader(scroll, { turn = '1', locked = true, expanded = true, unfoldable = false } = {}) {
  const row = scroll.append(new FakeElement('div', { 'data-chat-turn': turn, 'data-chat-flow-kind': 'turn-process' }))
  const button = row.append(new FakeElement('button', {
    'data-turn-process': turn,
    ...(unfoldable ? {} : { 'aria-expanded': String(expanded) }),
    ...(locked ? { [LOCK_ATTRIBUTE]: '' } : {}),
  }))
  if (unfoldable) button.disabled = true
  return button
}

/** 标题自身没有轮次值、只能靠最近的 `[data-chat-turn]` 推断时用的标题行。 */
function turnHeaderWithoutOwnTurn(scroll, { turn = '1' } = {}) {
  const row = scroll.append(new FakeElement('div', { 'data-chat-turn': turn, 'data-chat-flow-kind': 'turn-process' }))
  return row.append(new FakeElement('button', { 'data-turn-process': '', 'aria-expanded': 'true' }))
}

/** 一个主会话滚动口。 */
function scroll() {
  return new FakeElement('div', { 'data-conversation-scroll': '' })
}

console.log('--- S① 目标：最新一轮的平铺组（别的轮次 / 非平铺 / 已封口 / 无组头都不算）---')
{
  const root = scroll()
  turnHeader(root, { turn: '1' })
  turnHeader(root, { turn: '2' })
  // 更早轮次的平铺组在真实页面上不会存在（上一轮早已分组），这里只验证兜底：按最新一轮过滤。
  const oldFlat = group({ turn: '1' })
  const oldGrouped = group({ turn: '1', flat: false })
  const latest = group({ turn: '2' })
  const grouped = group({ turn: '2', flat: false })
  const sealed = group({ turn: '2', sealed: true })
  const noActivity = group({ turn: '2', activity: false })
  for (const item of [oldFlat, oldGrouped, latest, grouped, sealed, noActivity]) root.append(item.root)
  const groups = sealableGroups(root)
  checkTrue('只封最新一轮的平铺组', groups.length === 1 && groups[0] === latest.root)
}

console.log('--- S② 目标不要求锁标记：穿插输入的轮次也能封口 ---')
{
  // 穿插输入：标题 disabled、上游不写 aria-expanded（hasContent=false），锁定器不接管。
  const interleaved = scroll()
  turnHeader(interleaved, { turn: '1', locked: false, unfoldable: true })
  const flat = group({ turn: '1' })
  interleaved.append(flat.root)
  check('穿插输入的轮次也封口', sealableGroups(interleaved).length, 1)

  // 锁定器这一代没写成功（没有锁标记，但标题仍展开）：同样封口。
  const unlocked = scroll()
  turnHeader(unlocked, { turn: '1', locked: false })
  unlocked.append(group({ turn: '1' }).root)
  check('没有锁也封口', sealableGroups(unlocked).length, 1)

  // 上游已经把整轮折起（aria-expanded=false）：正文不在屏上，不再封口。
  const folded = scroll()
  turnHeader(folded, { turn: '1', expanded: false })
  folded.append(group({ turn: '1' }).root)
  check('上游已折时不封', sealableGroups(folded).length, 0)

  // 标题自己没有轮次值时退回最近的 [data-chat-turn]。
  const inherited = scroll()
  turnHeaderWithoutOwnTurn(inherited, { turn: '1' })
  inherited.append(group({ turn: '1' }).root)
  check('轮次值退回祖先标记', sealableGroups(inherited).length, 1)

  check('没有轮次标题', sealableGroups(scroll()).length, 0)
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

console.log('--- S⑧ 运行中的轮次（还没有过程标题）：只收已跑完的组 ---')
{
  // 长回合运行中：没有 [data-turn-process] 标题，三组平铺，最后一组仍在输出。
  const running = scroll()
  const done1 = group({ turn: '1' })
  const done2 = group({ turn: '1' })
  const live = group({ turn: '1', live: true })
  for (const item of [done1, done2, live]) running.append(item.root)
  const targets = sealableGroups(running)
  check('已跑完的两组进入目标', [targets[0] === done1.root, targets[1] === done2.root], [true, true])
  check('正在输出的一组保留', targets.length, 2)

  // 最后一组也跑完了（回合还在跑、答案文字在组外流式输出）：整轮都可收。
  const settled = scroll()
  const first = group({ turn: '1' })
  const second = group({ turn: '1' })
  for (const item of [first, second]) settled.append(item.root)
  check('没有流式标记时全部可收', sealableGroups(settled).length, 2)

  // 只有一组且还在输出：没有可收的组。
  const onlyLive = scroll()
  onlyLive.append(group({ turn: '1', live: true }).root)
  check('唯一的组在输出时不收', sealableGroups(onlyLive).length, 0)

  // 回合结束后（有标题）：即使残留流式标记也按整轮全部收，避免永远收不起来。
  const closed = scroll()
  turnHeader(closed, { turn: '1' })
  const closedFirst = group({ turn: '1' })
  const closedLast = group({ turn: '1', live: true })
  closed.append(closedFirst.root)
  closed.append(closedLast.root)
  check('有标题时不看流式标记', sealableGroups(closed).length, 2)

  // 完全展开模式 / 已中止的轮次：标题 disabled 但仍是“已结束”，整轮封口。
  const disabledTurn = scroll()
  const disabledHeader = turnHeader(disabledTurn, { turn: '1' })
  disabledHeader.disabled = true
  disabledTurn.append(group({ turn: '1' }).root)
  check('disabled 标题仍按整轮封口', sealableGroups(disabledTurn).length, 1)
}

console.log('--- S⑨ 样式：只插一条、共用、卸载移除并清封口 ---')
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
      'dsh-turn-process-open: collapse seal style',
      'dsh-turn-process-open: collapse seal style',
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
