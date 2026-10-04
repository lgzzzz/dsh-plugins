/**
 * 会话循环纯决策:固定行同时预约 `Ctrl+Alt+↑` / `Ctrl+Alt+↓`、准入、候选口径(左侧栏前三个
 * 工作区里当前渲染出来的会话行)、归档行与「未分组」桶的取舍、活跃优先的池子与环状步进。
 */
import {
  SESSION_CYCLE_COMMAND,
  SESSION_CYCLE_ID,
  SESSION_NEXT_BINDING,
  SESSION_PREVIOUS_BINDING,
  WORKSPACE_LIMIT,
  activeAmong,
  displayedSessionIds,
  displayedSidebar,
  sessionActive,
  sessionCycleEligible,
  sessionCyclePool,
  sessionCycleTarget,
  sessionStepFor,
  steppedSessionId,
} from '../src/session-cycle.ts'
import { check, checkTrue, fakeDocument, fakeSessions, FakeElement, finish, gesture, shortcutContext, sidebarTree, statusTable, SESSION_CYCLE_FIXED_ROWS, SESSION_NEXT_PRESS, SESSION_PREVIOUS_PRESS } from './helpers.mjs'

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

console.log('--- P① 固定行本身:一行预约两个方向,归 application 组 ---')
{
  check('固定行 id', SESSION_CYCLE_COMMAND.id, SESSION_CYCLE_ID)
  check('↑ 绑定', SESSION_CYCLE_COMMAND.bindings[0], SESSION_PREVIOUS_BINDING)
  check('↓ 绑定', SESSION_CYCLE_COMMAND.bindings[1], SESSION_NEXT_BINDING)
  check('固定行显示键', SESSION_CYCLE_COMMAND.keys, ['Ctrl', 'Alt', '↑/↓'])
  check('固定行分组', SESSION_CYCLE_COMMAND.group, 'application')
  check('前三个工作区', WORKSPACE_LIMIT, 3)
}

console.log('--- P② 固定行归属与方向:只有本键对命中,且方向由命中的 code 决定 ---')
{
  check('↑ 命中为 previous', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, SESSION_PREVIOUS_PRESS), 'previous')
  check('↓ 命中为 next', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, SESSION_NEXT_PRESS), 'next')
  check('裸 ↑ 不命中', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, gesture('ArrowUp')), undefined)
  check('Ctrl+↑ 不命中', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, gesture('ArrowUp', { control: true })), undefined)
  check('Alt+↓ 不命中', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, gesture('ArrowDown', { alt: true })), undefined)
  check('Ctrl+Alt+Shift+↓ 不命中', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, gesture('ArrowDown', { control: true, alt: true, shift: true })), undefined)
  check('左右方向键不命中(那是右栏页面循环的键)', sessionStepFor(SESSION_CYCLE_FIXED_ROWS, SESSION_CYCLE_ID, gesture('ArrowLeft', { control: true, alt: true })), undefined)
  check('行未挂载不命中', sessionStepFor([], SESSION_CYCLE_ID, SESSION_NEXT_PRESS), undefined)
}

console.log('--- P③ 准入:页 / 文本控件 / 终端 / 已被消费都准入,模态 / repeat / 组字否决 ---')
{
  checkTrue('page 上准入', sessionCycleEligible(SESSION_NEXT_PRESS, shortcutContext()))
  checkTrue('文本控件内准入(要离开的正是控件自己)', sessionCycleEligible(SESSION_NEXT_PRESS, shortcutContext({ region: 'editable' })))
  checkTrue('终端内准入(核心:焦点在终端里依然能切会话)', sessionCycleEligible(SESSION_NEXT_PRESS, shortcutContext({ region: 'terminal' })))
  checkTrue('已被消费仍准入(终端等本地控件先处理也不算数)', sessionCycleEligible(gesture('ArrowDown', { control: true, alt: true, defaultPrevented: true }), shortcutContext()))
  check('模态层之上否决', sessionCycleEligible(SESSION_NEXT_PRESS, shortcutContext({ modal: 'settings' })), false)
  check('repeat 否决', sessionCycleEligible(gesture('ArrowDown', { control: true, alt: true, repeat: true }), shortcutContext()), false)
  check('组字中否决', sessionCycleEligible(gesture('ArrowDown', { control: true, alt: true, composing: true }), shortcutContext()), false)
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

console.log('--- P⑤ 活跃判定:待答交互即活跃,运行状态以状态表为准 ---')
{
  const snapshot = list({ s1: { running: true }, s2: { running: false }, s3: {} })
  checkTrue('目录说在运行即活跃', sessionActive('s1', undefined, snapshot))
  check('不运行且无待答交互即不活跃', sessionActive('s2', undefined, snapshot), false)
  check('目录没有读数(undefined)不算活跃', sessionActive('s3', undefined, snapshot), false)

  const pending = statusTable({ s2: { pendingInteraction: { key: 'q1', kind: 'question', sessionId: 's2' } } })
  checkTrue('有待答交互即活跃(哪怕没在运行)', sessionActive('s2', pending, snapshot))
  const running = statusTable({ s2: { running: true } })
  checkTrue('状态表说在运行即活跃', sessionActive('s2', running, snapshot))
  const stopped = statusTable({ s1: { running: false } })
  check('状态表说没在跑就以它为准', sessionActive('s1', stopped, snapshot), false)
  check('活跃候选保持候选顺序', activeAmong(['s3', 's1', 's2'], undefined, snapshot), ['s1'])
}

console.log('--- P⑥ 池子:活跃候选优先,唯一的活跃会话已在屏上时改用全部候选 ---')
{
  check('没有活跃候选:全部候选', sessionCyclePool(facts(['s1', 's2', 's3'], 's1', [])), ['s1', 's2', 's3'])
  check('两个活跃候选:只在活跃里跳', sessionCyclePool(facts(['s1', 's2', 's3'], 's1', ['s2', 's3'])), ['s2', 's3'])
  check('唯一活跃候选不是当前会话:就跳它', sessionCyclePool(facts(['s1', 's2', 's3'], 's1', ['s2'])), ['s2'])
  check('唯一活跃候选正是当前会话:改用全部候选', sessionCyclePool(facts(['s1', 's2', 's3'], 's2', ['s2'])), ['s1', 's2', 's3'])
  check('当前会话不在候选里、也没有活跃候选:全部候选', sessionCyclePool(facts(['s1', 's2'], 'ghost', [])), ['s1', 's2'])
}

console.log('--- P⑥ 环状步进:回头绕到末尾,到头绕回开头 ---')
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

console.log('--- P⑦ 目标判定:目标就是当前会话或没有候选时不动 ---')
{
  check('向前切到下一个', sessionCycleTarget(facts(['s1', 's2', 's3'], 's1', []), 'next'), 's2')
  check('向后切到上一个', sessionCycleTarget(facts(['s1', 's2', 's3'], 's1', []), 'previous'), 's3')
  check('当前会话不在候选里:前进落候选首', sessionCycleTarget(facts(['s1', 's2'], 'ghost', []), 'next'), 's1')
  check('只有一个候选且就是当前会话:不动', sessionCycleTarget(facts(['s1'], 's1', []), 'next'), undefined)
  check('没有候选:不动', sessionCycleTarget(facts([], 's1', []), 'next'), undefined)
  check('当前会话不在候选里且只有一个候选:跳进去', sessionCycleTarget(facts(['s1'], 'ghost', []), 'next'), 's1')
  check('唯一活跃会话不是当前会话:↑/↓ 都先跳到它', [
    sessionCycleTarget(facts(['s1', 's2', 's3'], 's1', ['s2']), 'next'),
    sessionCycleTarget(facts(['s1', 's2', 's3'], 's1', ['s2']), 'previous'),
  ], ['s2', 's2'])
  check('唯一活跃会话正是当前会话:在全部候选里往前走', sessionCycleTarget(facts(['s1', 's2', 's3'], 's2', ['s2']), 'next'), 's3')
  check('唯一活跃会话正是当前会话:在全部候选里往回走', sessionCycleTarget(facts(['s1', 's2', 's3'], 's2', ['s2']), 'previous'), 's1')
  check('两个活跃会话:只在活跃之间环状走', [
    sessionCycleTarget(facts(['s1', 's2', 's3', 's4'], 's2', ['s2', 's4']), 'next'),
    sessionCycleTarget(facts(['s1', 's2', 's3', 's4'], 's4', ['s2', 's4']), 'next'),
  ], ['s4', 's2'])
}

finish()
