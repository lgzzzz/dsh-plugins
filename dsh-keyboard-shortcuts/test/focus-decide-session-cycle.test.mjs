/**
 * 会话循环纯决策:两条固定行(`primary+↑/↓` 走全部候选,`primary+alt+↑/↓` 只走活跃会话;
 * macOS 落成 `⌘↑/↓` 与 `⌘⌥↑/↓`,Windows/Linux 落成 `Ctrl+↑/↓` 与 `Ctrl+Alt+↑/↓`)、准入、
 * 消费判定(归本行就消费,与有没有可切目标无关)、候选口径(左侧栏前三个工作区里当前渲染
 * 出来的会话行)、归档行与「未分组」桶的取舍、活跃判定与环状步进。
 */
import {
  SESSION_ACTIVE_CYCLE_ID,
  SESSION_ACTIVE_NEXT_BINDING,
  SESSION_ACTIVE_PREVIOUS_BINDING,
  SESSION_CYCLE_ID,
  SESSION_NEXT_BINDING,
  SESSION_PREVIOUS_BINDING,
  WORKSPACE_LIMIT,
  activeAmong,
  displayedSessionIds,
  displayedSidebar,
  sessionActive,
  sessionActiveCycleCommand,
  sessionCycleCommand,
  sessionCycleDecision,
  sessionCycleEligible,
  sessionCycleRequest,
  sessionCycleTarget,
  sessionPool,
  sessionStepFor,
  steppedSessionId,
} from '../src/session-cycle.ts'
import { check, checkTrue, fakeDocument, fakeSessions, fakeShortcuts, fakeUiSession, FakeElement, finish, gesture, session, shortcutContext, sidebarTree, statusTable, SESSION_ACTIVE_NEXT_MAC_PRESS, SESSION_ACTIVE_NEXT_PRESS, SESSION_ACTIVE_PREVIOUS_MAC_PRESS, SESSION_ACTIVE_PREVIOUS_PRESS, SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_MAC_FIXED_ROWS, SESSION_NEXT_MAC_PRESS, SESSION_NEXT_PRESS, SESSION_PREVIOUS_MAC_PRESS, SESSION_PREVIOUS_PRESS, UNUSED_PRESS } from './focus-helpers.mjs'

/** 把一段假树当成整份 document,返回还原函数。 */
function asDocument(tree) {
  const previous = globalThis.document
  globalThis.document = fakeDocument({ root: tree })
  return () => {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

/** 一份会话目录快照:`id → { running, mainView }`。 */
function list(entries) {
  const summary = {}
  for (const [id, { running = false, mainView = 0 } = {}] of Object.entries(entries)) {
    summary[id] = { id, running, retainedBy: mainView > 0 ? { mainView } : {} }
  }
  return fakeSessions({ summary }).list.getSnapshot()
}

/** 一次按键的候选事实。 */
function facts(candidates, current, active) {
  return { candidates, current, active }
}

/** 一次按键的意图:池子 + 方向。 */
function request(pool, step) {
  return { pool, step }
}

console.log('--- P① 两条固定行:各自预约一对方向键,键帽按平台落成,都归 application 组 ---')
{
  const macosCycle = sessionCycleCommand('macos')
  const windowsCycle = sessionCycleCommand('windows')
  check('全部候选行 id', macosCycle.id, SESSION_CYCLE_ID)
  check('全部候选行 ↑ 绑定', macosCycle.bindings[0], SESSION_PREVIOUS_BINDING)
  check('全部候选行 ↓ 绑定', macosCycle.bindings[1], SESSION_NEXT_BINDING)
  check('全部候选行 macOS 显示键', macosCycle.keys, ['⌘', '↑/↓'])
  check('全部候选行 Windows 显示键', windowsCycle.keys, ['Ctrl', '↑/↓'])
  check('全部候选行标签', macosCycle.label(), '切换会话')
  check('全部候选行分组', macosCycle.group, 'application')

  const macosActive = sessionActiveCycleCommand('macos')
  const windowsActive = sessionActiveCycleCommand('windows')
  check('活跃行 id', macosActive.id, SESSION_ACTIVE_CYCLE_ID)
  check('活跃行 ↑ 绑定', macosActive.bindings[0], SESSION_ACTIVE_PREVIOUS_BINDING)
  check('活跃行 ↓ 绑定', macosActive.bindings[1], SESSION_ACTIVE_NEXT_BINDING)
  check('活跃行 macOS 显示键', macosActive.keys, ['⌘', '⌥', '↑/↓'])
  check('活跃行 Windows 显示键', windowsActive.keys, ['Ctrl', 'Alt', '↑/↓'])
  check('活跃行标签', macosActive.label(), '切换到活跃会话')
  check('活跃行分组', macosActive.group, 'application')

  check('前三个工作区', WORKSPACE_LIMIT, 3)
}

console.log('--- P② 归属:行各自认自己那对键,方向由命中的 code 决定;平台各认各的物理键 ---')
{
  check('全部候选行 ↑ 命中为 previous', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, SESSION_PREVIOUS_PRESS), 'previous')
  check('全部候选行 ↓ 命中为 next', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, SESSION_NEXT_PRESS), 'next')
  check('全部候选行不认带 Alt 的那一对', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, SESSION_ACTIVE_NEXT_PRESS), undefined)
  check('活跃行 ↑ 命中为 previous', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_ACTIVE_CYCLE_ID, SESSION_ACTIVE_PREVIOUS_PRESS), 'previous')
  check('活跃行 ↓ 命中为 next', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_ACTIVE_CYCLE_ID, SESSION_ACTIVE_NEXT_PRESS), 'next')
  check('活跃行不认不带 Alt 的那一对', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_ACTIVE_CYCLE_ID, SESSION_NEXT_PRESS), undefined)

  check('macOS:全部候选行 ↑ 命中为 previous', sessionStepFor(SESSION_CYCLE_MAC_FIXED_ROWS, SESSION_CYCLE_ID, SESSION_PREVIOUS_MAC_PRESS), 'previous')
  check('macOS:全部候选行 ↓ 命中为 next', sessionStepFor(SESSION_CYCLE_MAC_FIXED_ROWS, SESSION_CYCLE_ID, SESSION_NEXT_MAC_PRESS), 'next')
  check('macOS:活跃行 ↓ 命中为 next', sessionStepFor(SESSION_CYCLE_MAC_FIXED_ROWS, SESSION_ACTIVE_CYCLE_ID, SESSION_ACTIVE_NEXT_MAC_PRESS), 'next')
  check('macOS:不带 Alt 的那一对不认带 Alt 的键', sessionStepFor(SESSION_CYCLE_MAC_FIXED_ROWS, SESSION_CYCLE_ID, SESSION_ACTIVE_NEXT_MAC_PRESS), undefined)
  check('macOS:Ctrl+↓ 不命中(那是 Windows 的键)', sessionStepFor(SESSION_CYCLE_MAC_FIXED_ROWS, SESSION_CYCLE_ID, SESSION_NEXT_PRESS), undefined)
  check('macOS:⌘↓ 走全部候选', sessionCycleRequest(SESSION_CYCLE_MAC_FIXED_ROWS, SESSION_NEXT_MAC_PRESS), request('all', 'next'))
  check('macOS:⌘⌥↓ 只走活跃', sessionCycleRequest(SESSION_CYCLE_MAC_FIXED_ROWS, SESSION_ACTIVE_NEXT_MAC_PRESS), request('active', 'next'))

  check('裸 ↑ 不命中', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, gesture('ArrowUp')), undefined)
  check('Alt+↓ 不命中', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, gesture('ArrowDown', { alt: true })), undefined)
  check('Ctrl+Shift+↓ 不命中', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, gesture('ArrowDown', { control: true, shift: true })), undefined)
  check('Ctrl+Alt+Shift+↓ 不命中', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_ACTIVE_CYCLE_ID, gesture('ArrowDown', { control: true, alt: true, shift: true })), undefined)
  check('左右方向键不命中(那是右栏页面循环的键)', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, gesture('ArrowLeft', { control: true, alt: true })), undefined)
  check('行未挂载不命中', sessionStepFor([], SESSION_CYCLE_ID, SESSION_NEXT_PRESS), undefined)

  check('不带 Alt 的 ↓ 走全部候选', sessionCycleRequest(SESSION_CYCLE_FIXED_ROWS, SESSION_NEXT_PRESS), request('all', 'next'))
  check('不带 Alt 的 ↑ 走全部候选', sessionCycleRequest(SESSION_CYCLE_FIXED_ROWS, SESSION_PREVIOUS_PRESS), request('all', 'previous'))
  check('带 Alt 的 ↓ 只走活跃', sessionCycleRequest(SESSION_CYCLE_FIXED_ROWS, SESSION_ACTIVE_NEXT_PRESS), request('active', 'next'))
  check('带 Alt 的 ↑ 只走活跃', sessionCycleRequest(SESSION_CYCLE_FIXED_ROWS, SESSION_ACTIVE_PREVIOUS_PRESS), request('active', 'previous'))
  check('别的键两组都不认', sessionCycleRequest(SESSION_CYCLE_FIXED_ROWS, gesture('ArrowDown', { control: true, shift: true })), undefined)
  check('行都没挂载时没有请求', sessionCycleRequest([], SESSION_ACTIVE_NEXT_PRESS), undefined)
}

console.log('--- P③ 动作准入:页 / 文本控件 / 终端 / 已被消费都准入,模态 / repeat / 组字否决(消费口径见 P⑨) ---')
{
  for (const [label, press] of [['全部候选', SESSION_NEXT_PRESS], ['活跃池', SESSION_ACTIVE_NEXT_PRESS]]) {
    checkTrue(`${label}:page 上准入`, sessionCycleEligible(press, shortcutContext()))
    checkTrue(`${label}:文本控件内准入(要离开的正是控件自己)`, sessionCycleEligible(press, shortcutContext({ region: 'editable' })))
    checkTrue(`${label}:终端内准入(核心:焦点在终端里依然能切会话)`, sessionCycleEligible(press, shortcutContext({ region: 'terminal' })))
    checkTrue(`${label}:已被消费仍准入(终端等本地控件先处理也不算数)`, sessionCycleEligible({ ...press, defaultPrevented: true }, shortcutContext()))
    check(`${label}:模态层之上否决`, sessionCycleEligible(press, shortcutContext({ modal: 'settings' })), false)
    check(`${label}:repeat 否决`, sessionCycleEligible({ ...press, repeat: true }, shortcutContext()), false)
    check(`${label}:组字中否决`, sessionCycleEligible({ ...press, composing: true }, shortcutContext()), false)
  }
}

console.log('--- P④ 候选口径:前三个工作区里此刻渲染出来的会话行 ---')
{
  const tree = sidebarTree([
    { key: 'w1', sessions: ['s1', 's2'] },
    { key: 'w2', sessions: ['s3'], overflow: true },
    { key: 'w3', sessions: ['s4', 's5'], archived: ['s5'] },
    { key: 'w4', sessions: ['s6'] },
  ])
  const restore = asDocument(tree)
  try {
    check('分组按显示顺序', displayedSidebar().groups, ['w1', 'w2', 'w3', 'w4'])
    check('前三个工作区的会话行按显示顺序', displayedSessionIds(), ['s1', 's2', 's3', 's4'])
    check('归档行被标出', displayedSidebar().rows.filter((row) => row.archived).map((row) => row.session), ['s5'])
    check('归档行不进候选', displayedSessionIds().includes('s5'), false)
    check('第四个工作区不进候选', displayedSessionIds().includes('s6'), false)
  } finally {
    restore()
  }
}

{
  // 「未分组」桶不是工作区:不占前三个名额,自己的会话也不进候选。
  const tree = sidebarTree([
    { key: '', sessions: ['u1'] },
    { key: 'w1', sessions: ['s1'] },
    { key: 'w2', sessions: ['s2'] },
    { key: 'w3', sessions: ['s3'] },
  ])
  const restore = asDocument(tree)
  try {
    check('未分组桶仍是一个分组', displayedSidebar().groups, ['', 'w1', 'w2', 'w3'])
    check('未分组桶不占名额、自己也不进候选', displayedSessionIds(), ['s1', 's2', 's3'])
  } finally {
    restore()
  }
}

{
  // 折叠的分组不渲染会话行,但仍占一个「工作区」名额。
  const tree = sidebarTree([
    { key: 'w1' },
    { key: 'w2', sessions: ['s2', 's3'] },
    { key: 'w3', sessions: ['s4'] },
    { key: 'w4', sessions: ['s5'] },
  ])
  const restore = asDocument(tree)
  try {
    check('折叠的分组没有会话行但仍占名额', displayedSessionIds(), ['s2', 's3', 's4'])
  } finally {
    restore()
  }
}

{
  // 工作区树模式:父分组自己的会话行排在自己的嵌套子分组之后,仍归父分组;
  // 候选顺序跟随 DOM(也就是眼睛看到的)顺序。
  const tree = sidebarTree([
    { key: 'p', sessions: ['p1'], children: [{ key: 'c1', sessions: ['c1s'] }, { key: 'c2', sessions: ['c2s'] }] },
    { key: 'w2', sessions: ['w2s'] },
    { key: 'w3', sessions: ['w3s'] },
    { key: 'w4', sessions: ['w4s'] },
  ])
  const restore = asDocument(tree)
  try {
    check('前三个分组是父与它的两个子', displayedSidebar().groups, ['p', 'c1', 'c2', 'w2', 'w3', 'w4'])
    check('父分组自己的会话不被算进子分组', displayedSessionIds(), ['c1s', 'c2s', 'p1'])
  } finally {
    restore()
  }
}

{
  // 单列表模式:没有工作区分组行,因此没有候选。
  const flat = new FakeElement('div', { role: 'tree' })
  flat.append(new FakeElement('span')).append(new FakeElement('div', { 'data-row-key': 'session:s1' }))
  const restore = asDocument(flat)
  try {
    check('没有分组行时没有候选', displayedSessionIds(), [])
    check('会话行仍在,但认不出归属', displayedSidebar().rows, [])
  } finally {
    restore()
  }
}

{
  // 搜索过滤生效 / 窄侧栏:列表区根本不渲染行标记。
  const empty = new FakeElement('div', { role: 'tree' })
  const restore = asDocument(empty)
  try {
    check('没有行标记时没有候选', displayedSessionIds(), [])
    check('没有行标记时也没有分组', displayedSidebar(), { groups: [], rows: [] })
  } finally {
    restore()
  }
}

{
  check('没有 document 时没有候选', displayedSessionIds(), [])
}

console.log('--- P⑤ 活跃判定:行上有状态点就算 —— 待答 / 运行中 / 已完成未读 ---')
{
  const snapshot = list({ s1: { running: true }, s2: { running: false }, s3: {} })
  checkTrue('目录说在运行即活跃', sessionActive('s1', undefined, snapshot))
  check('不运行且无状态点即不活跃', sessionActive('s2', undefined, snapshot), false)
  check('目录没有读数(undefined)不算活跃', sessionActive('s3', undefined, snapshot), false)

  const pending = statusTable({ s2: { pendingInteraction: { key: 'q1', kind: 'question', sessionId: 's2' } } })
  checkTrue('有待答交互即活跃(哪怕没在运行)', sessionActive('s2', pending, snapshot))
  const running = statusTable({ s2: { running: true } })
  checkTrue('状态表说在运行即活跃', sessionActive('s2', running, snapshot))
  const completed = statusTable({ s2: { completionUnread: true } })
  checkTrue('已完成未读(绿点)即活跃(回合出错同样是它)', sessionActive('s2', completed, snapshot))
  const stopped = statusTable({ s1: { running: false } })
  check('状态表说没在跑就以它为准', sessionActive('s1', stopped, snapshot), false)
  check('活跃候选保持候选顺序', activeAmong(['s3', 's1', 's2'], undefined, snapshot), ['s1'])
  check('活跃候选按三项状态事实取并集', activeAmong(['s1', 's2', 's3'], statusTable({ s2: { completionUnread: true }, s3: { running: true } }), snapshot), ['s1', 's2', 's3'])
}

console.log('--- P⑥ 池子:全部候选 / 只活跃,活跃池空就是空池(不退回全部候选) ---')
{
  check('全部候选池就是候选', sessionPool(facts(['s1', 's2', 's3'], 's1', ['s2']), 'all'), ['s1', 's2', 's3'])
  check('活跃池就是活跃候选', sessionPool(facts(['s1', 's2', 's3'], 's1', ['s2', 's3']), 'active'), ['s2', 's3'])
  check('没有活跃候选时活跃池是空池', sessionPool(facts(['s1', 's2', 's3'], 's1', []), 'active'), [])
  check('当前会话不在候选里也照样给池子', sessionPool(facts(['s1', 's2'], 'ghost', []), 'all'), ['s1', 's2'])
}

console.log('--- P⑦ 环状步进:回头绕到末尾,到头绕回开头 ---')
{
  const pool = ['s1', 's2', 's3']
  check('向前一步', steppedSessionId(pool, 's1', 'next'), 's2')
  check('向后一步', steppedSessionId(pool, 's2', 'previous'), 's1')
  check('末尾向前绕回开头', steppedSessionId(pool, 's3', 'next'), 's1')
  check('开头向后绕到末尾', steppedSessionId(pool, 's1', 'previous'), 's3')
  check('两个成员双向同目标', steppedSessionId(['a', 'b'], 'a', 'previous'), 'b')
  check('当前不在池里:前进落池首', steppedSessionId(pool, 'ghost', 'next'), 's1')
  check('当前不在池里:后退落池尾', steppedSessionId(pool, 'ghost', 'previous'), 's3')
  check('没有当前会话:前进落池首', steppedSessionId(pool, undefined, 'next'), 's1')
  check('没有当前会话:后退落池尾', steppedSessionId(pool, undefined, 'previous'), 's3')
  check('只有一个成员:返回它自己', steppedSessionId(['s1'], 's1', 'next'), 's1')
  check('空池无可切', steppedSessionId([], 's1', 'next'), undefined)
}

console.log('--- P⑧ 目标判定:全部候选只要不等于当前就走,活跃池只认活跃 ---')
{
  check('全部候选:向前切到下一个', sessionCycleTarget(facts(['s1', 's2', 's3'], 's1', []), request('all', 'next')), 's2')
  check('全部候选:向后切到上一个', sessionCycleTarget(facts(['s1', 's2', 's3'], 's1', []), request('all', 'previous')), 's3')
  check('全部候选:当前会话不在候选里时前进落候选首', sessionCycleTarget(facts(['s1', 's2'], 'ghost', []), request('all', 'next')), 's1')
  check('全部候选:只有一个候选且就是当前会话时不动', sessionCycleTarget(facts(['s1'], 's1', []), request('all', 'next')), undefined)
  check('全部候选:没有候选时不动', sessionCycleTarget(facts([], 's1', []), request('all', 'next')), undefined)
  check('全部候选:当前会话不在候选里且只有一个候选时跳进去', sessionCycleTarget(facts(['s1'], 'ghost', []), request('all', 'next')), 's1')

  check('活跃池:唯一活跃不是当前会话时 ↑ / ↓ 都先跳它', [
    sessionCycleTarget(facts(['s1', 's2', 's3'], 's1', ['s2']), request('active', 'next')),
    sessionCycleTarget(facts(['s1', 's2', 's3'], 's1', ['s2']), request('active', 'previous')),
  ], ['s2', 's2'])
  check('活跃池:两个活跃只在它们之间环状走', [
    sessionCycleTarget(facts(['s1', 's2', 's3', 's4'], 's2', ['s2', 's4']), request('active', 'next')),
    sessionCycleTarget(facts(['s1', 's2', 's3', 's4'], 's4', ['s2', 's4']), request('active', 'next')),
    sessionCycleTarget(facts(['s1', 's2', 's3', 's4'], 's2', ['s2', 's4']), request('active', 'previous')),
  ], ['s4', 's2', 's4'])
  check('活跃池:没有活跃候选时不动', sessionCycleTarget(facts(['s1', 's2'], 's1', []), request('active', 'next')), undefined)
  check('活跃池:唯一的活跃会话正是当前会话时不动(不退回全部候选)', [
    sessionCycleTarget(facts(['s1', 's2', 's3'], 's2', ['s2']), request('active', 'next')),
    sessionCycleTarget(facts(['s1', 's2', 's3'], 's2', ['s2']), request('active', 'previous')),
  ], [undefined, undefined])
  check('活跃池:当前会话不在候选里时落池首 / 池尾', [
    sessionCycleTarget(facts(['s1', 's2'], 'ghost', ['s2']), request('active', 'next')),
    sessionCycleTarget(facts(['s1', 's2'], 'ghost', ['s2']), request('active', 'previous')),
  ], ['s2', 's2'])
}

console.log('--- P⑨ 消费判定:归本行就消费,没有可切目标也照常吞掉;组字中与不归本行的键都放行 ---')
{
  /** 一个默认场景:s1 是当前会话且空闲,s2 在运行,s3 空闲;树就是这三行的侧栏。 */
  const TREE = sidebarTree([{ key: 'w1', sessions: ['s1', 's2', 's3'] }])
  const SUMMARY = {
    s1: session('s1', { running: false }),
    s2: session('s2', { mainView: 0, running: true }),
    s3: session('s3', { mainView: 0, running: false }),
  }

  /** 一份判定输入:行表 / 会话目录 / 状态表。 */
  function scenario({ fixedRows = SESSION_CYCLE_FIXED_ROWS, summary = SUMMARY, status = new Map() } = {}) {
    return {
      shortcuts: fakeShortcuts({ fixedRows }),
      sessions: fakeSessions({ summary }),
      uiSession: fakeUiSession({ status }),
    }
  }

  /** 让整份 document 缺席,返回还原函数。 */
  function withoutDocument() {
    const previous = globalThis.document
    delete globalThis.document
    return () => {
      if (previous !== undefined) globalThis.document = previous
    }
  }

  /** 在给定假侧栏树上跑一次判定;`tree: null` 表示整份 document 缺席。 */
  function decide(env, press, { tree = TREE, context = shortcutContext() } = {}) {
    const restore = tree === null ? withoutDocument() : asDocument(tree)
    try {
      return sessionCycleDecision(env.shortcuts, env.sessions, env.uiSession, press, context)
    } finally {
      restore()
    }
  }

  const env = scenario()
  check('活跃行有可切目标:切换并消费', decide(env, SESSION_ACTIVE_NEXT_PRESS), { target: 's2', consume: true })
  check('活跃行反向同样有目标', decide(env, SESSION_ACTIVE_PREVIOUS_PRESS), { target: 's2', consume: true })
  check('全部候选行有目标:切换并消费', decide(env, SESSION_NEXT_PRESS), { target: 's2', consume: true })

  // 没有候选(侧栏没渲染行)/ 只有一个候选且就是当前会话:不动作,但照样消费。
  const noRows = decide(env, SESSION_ACTIVE_NEXT_PRESS, { tree: sidebarTree([]) })
  check('侧栏没有任何行:不动作', noRows.target, undefined)
  check('侧栏没有任何行:仍消费', noRows.consume, true)
  const onlyCurrent = decide(env, SESSION_NEXT_PRESS, { tree: sidebarTree([{ key: 'w1', sessions: ['s1'] }]) })
  check('唯一候选就是当前会话:不动作', onlyCurrent.target, undefined)
  check('唯一候选就是当前会话:仍消费', onlyCurrent.consume, true)
  const noDocument = decide(env, SESSION_ACTIVE_NEXT_PRESS, { tree: null })
  check('没有 document:没有候选', noDocument.target, undefined)
  check('没有 document:仍消费', noDocument.consume, true)

  // 活跃池为空(所有行都空闲)/ 活跃池里只剩当前会话:不动作,但照样消费。
  const idle = scenario({ summary: {
    s1: session('s1', { running: false }),
    s2: session('s2', { mainView: 0, running: false }),
    s3: session('s3', { mainView: 0, running: false }),
  } })
  check('活跃池为空:不动作', decide(idle, SESSION_ACTIVE_NEXT_PRESS).target, undefined)
  check('活跃池为空:仍消费', decide(idle, SESSION_ACTIVE_NEXT_PRESS).consume, true)
  const alone = scenario({ summary: {
    s1: session('s1', { running: true }),
    s2: session('s2', { mainView: 0, running: false }),
    s3: session('s3', { mainView: 0, running: false }),
  } })
  check('活跃池里只剩当前会话:不动作', decide(alone, SESSION_ACTIVE_NEXT_PRESS).target, undefined)
  check('活跃池里只剩当前会话:仍消费', decide(alone, SESSION_ACTIVE_NEXT_PRESS).consume, true)

  // 长按重复与模态层:不动作,但都消费 —— 这一按不再漏给浏览器 / 终端。
  const repeated = decide(env, { ...SESSION_ACTIVE_NEXT_PRESS, repeat: true })
  check('长按重复:不动作', repeated.target, undefined)
  check('长按重复:消费', repeated.consume, true)
  const modal = decide(env, SESSION_ACTIVE_NEXT_PRESS, { context: shortcutContext({ modal: 'settings' }) })
  check('模态层之上:不动作', modal.target, undefined)
  check('模态层之上:消费', modal.consume, true)

  // 输入法组字中:这一按归输入法,既不消费也不动作。
  check('组字中:不消费也不动作', decide(env, { ...SESSION_ACTIVE_NEXT_PRESS, composing: true }), { target: undefined, consume: false })
  // 键位不归本桥:别的键、别的修饰键集合、行未挂载,一律放行。
  check('别的键放行', decide(env, UNUSED_PRESS), { target: undefined, consume: false })
  check('多按一个修饰键放行', decide(env, gesture('ArrowDown', { control: true, alt: true, shift: true })), { target: undefined, consume: false })
  check('左右方向键放行(那是右栏页面循环的键)', decide(env, gesture('ArrowLeft', { control: true, alt: true })), { target: undefined, consume: false })
  const unmounted = scenario({ fixedRows: [] })
  check('两条行都没挂载时放行', decide(unmounted, SESSION_ACTIVE_NEXT_PRESS), { target: undefined, consume: false })

  // 平台各认各的物理键:macOS 的键表下 Ctrl+Alt+↓ 不归本桥。
  const macos = scenario({ fixedRows: SESSION_CYCLE_MAC_FIXED_ROWS })
  check('macOS:⌘⌥↓ 归活跃行并消费', decide(macos, SESSION_ACTIVE_NEXT_MAC_PRESS), { target: 's2', consume: true })
  check('macOS:Ctrl+Alt+↓ 不归本桥', decide(macos, SESSION_ACTIVE_NEXT_PRESS), { target: undefined, consume: false })
  check('macOS:⌘↓ 归全部候选行并消费', decide(macos, SESSION_NEXT_MAC_PRESS), { target: 's2', consume: true })
}

finish()
