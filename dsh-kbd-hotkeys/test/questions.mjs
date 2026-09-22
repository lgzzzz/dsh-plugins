/**
 * 诊断脚本(非插件产物):卡片(待处理交互)的服务级路径:审批 Enter/Esc、计划评审 1/2/3/Enter、通用问答的选答与
 * ← / → 切题、card 态三态放行、`bindings` 覆盖与固定单键分发,以及「权威来源不可用 → no-op
 * (无降级)」;末尾附带仅私有字段 `uiSession.pendingSnapshot` 的兼容回退。
 * 问答断言落在卡片草稿 store 上(单一真源)。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/questions.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, check, composerSlots, isMain, loadPlugin, makeDraftStore, report, same, sessions, snapshot, storage } from './harness.mjs'

// ---- 阶段 1:公开面 uiSession.pendingInteractions(服务级路径) ----
const pending = new Map()
const draft = makeDraftStore()
const services = {
  sessions,
  uiSession: {
    pendingInteractions: { getSnapshot: () => pending },
  },
  sidebarRight: { toggleExpanded() {} },
  workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  slots: composerSlots(draft),
}
const press = loadPlugin(services)

/** 装一个待处理载体并返回结算记录。 */
function mount(interaction) {
  const log = { answer: [], cancel: 0 }
  pending.set('sess-b', {
    sessionId: 'sess-b',
    ...interaction,
    answer: (payload) => { log.answer.push(payload); pending.delete('sess-b') },
    cancel: () => { log.cancel += 1; pending.delete('sess-b') },
  })
  return log
}

console.log('--- 审批(服务级:Enter 同意 / Esc 拒绝) ---')
{
  let log = mount({ kind: 'approval', key: 'approval:1' })
  let event = press({ key: 'Enter', code: 'Enter' })
  check('Enter → answer(allowed-once)', same(log.answer, ['allowed-once']), JSON.stringify(log.answer))
  check('Enter 被吞', event.propagationStopped === true)

  log = mount({ kind: 'approval', key: 'approval:2' })
  event = press({ key: 'Escape', code: 'Escape' })
  check('Esc → answer(rejected)', same(log.answer, ['rejected']), JSON.stringify(log.answer))
  check('Esc 被吞', event.propagationStopped === true)

  // 审批是固定单键分发:组合键形式的审批键位不应答、不吞键
  log = mount({ kind: 'approval', key: 'approval:3' })
  event = press({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true })
  check('Ctrl+Alt+Enter 不应答(审批只认固定单键)', log.answer.length === 0, JSON.stringify(log.answer))
  check('Ctrl+Alt+Enter 不吞键', event.propagationStopped !== true)
  event = press({ key: 'Backspace', code: 'Backspace', ctrlKey: true, altKey: true })
  check('Ctrl+Alt+Backspace 不应答(审批只认固定单键)', log.answer.length === 0, JSON.stringify(log.answer))
  check('Ctrl+Alt+Backspace 不吞键', event.propagationStopped !== true)
  pending.delete('sess-b')

  // 审批卡片自身没有输入框:焦点在对话输入框时同样应答(不受焦点位置影响)
  log = mount({ kind: 'approval', key: 'approval:4' })
  event = press({ key: 'Enter', code: 'Enter', target: new FakeHTMLElement('TEXTAREA') })
  check('焦点在输入框时 Enter 仍同意', same(log.answer, ['allowed-once']), JSON.stringify(log.answer))
  check('焦点在输入框时 Enter 被吞', event.propagationStopped === true)

  log = mount({ kind: 'approval', key: 'approval:5' })
  event = press({ key: 'Escape', code: 'Escape', target: new FakeHTMLElement('TEXTAREA') })
  check('焦点在输入框时 Esc 仍拒绝', same(log.answer, ['rejected']), JSON.stringify(log.answer))
  check('焦点在输入框时 Esc 被吞', event.propagationStopped === true)
}

console.log('\n--- 无审批卡片时 Esc 仍停止当前会话(不吞键) ---')
{
  pending.delete('sess-b')
  const cancelled = []
  const stopSessions = {
    list: { getSnapshot: () => snapshot },
    binding: (id) => ({
      session: {
        getSnapshot: () => ({ running: id === 'sess-b' }),
        cancel: () => { cancelled.push(id) },
      },
    }),
  }
  const pressStop = loadPlugin({ ...services, sessions: stopSessions })
  const event = pressStop({ key: 'Escape', code: 'Escape' })
  check('无审批卡片时 Esc → cancel(sess-b)', same(cancelled, ['sess-b']), JSON.stringify(cancelled))
  check('无审批卡片时 Esc 不吞键', event.propagationStopped !== true)
}

console.log('\n--- 固定分发动作不可经 bindings 覆盖 ---')
{
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({
    bindings: { 'approval.allow': 'mod+alt+enter', 'approval.reject': 'mod+alt+backspace' },
  }))
  const pressStale = loadPlugin(services)
  const log = mount({ kind: 'approval', key: 'approval:6' })
  let event = pressStale({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true })
  check('自定义组合键不应答', log.answer.length === 0 && event.propagationStopped !== true, JSON.stringify(log.answer))
  event = pressStale({ key: 'Enter', code: 'Enter' })
  check('固定单键 Enter 仍同意', same(log.answer, ['allowed-once']), JSON.stringify(log.answer))
  storage.delete('dsh-kbd-hotkeys:v1')
}

const planQuestions = [{
  id: 'p1',
  question: 'Plan?',
  detail: 'plan body',
  options: [{ label: '确认执行' }, { label: '拒绝' }],
  intent: { kind: 'plan-review', approve: '确认执行' },
}]

console.log('\n--- 计划评审(服务级,按键语义按 intent.approve 判定) ---')
{
  let log = mount({ kind: 'plan-review', key: 'question:1', questions: planQuestions })
  let event = press({ key: '1', code: 'Digit1' })
  check('1 → answer(确认执行)', same(log.answer, [{ answers: [{ id: 'p1', selected: ['确认执行'] }] }]), JSON.stringify(log.answer))
  check('1 被吞', event.propagationStopped === true)

  log = mount({ kind: 'plan-review', key: 'question:2', questions: planQuestions })
  press({ key: '2', code: 'Digit2' })
  check('2 → answer(拒绝)', same(log.answer, [{ answers: [{ id: 'p1', selected: ['拒绝'] }] }]), JSON.stringify(log.answer))

  log = mount({ kind: 'plan-review', key: 'question:3', questions: planQuestions })
  press({ key: '3', code: 'Digit3' })
  check('3 → cancel(去聊天里说)', log.cancel === 1, `cancel=${String(log.cancel)}`)

  log = mount({ kind: 'plan-review', key: 'question:4', questions: planQuestions })
  event = press({ key: 'Enter', code: 'Enter' })
  check('Enter → answer(确认执行)', same(log.answer, [{ answers: [{ id: 'p1', selected: ['确认执行'] }] }]), JSON.stringify(log.answer))
  check('Enter 被吞', event.propagationStopped === true)

  log = mount({ kind: 'plan-review', key: 'question:5', questions: planQuestions })
  press({ key: '4', code: 'Digit4' })
  check('4 → no-op(计划评审仅 1/2/3)', log.answer.length === 0 && log.cancel === 0)
}

console.log('\n--- 通用问答:数字键不翻题、Enter 非末题推进、末题结算 ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:6',
    questions: [
      { id: 'g1', question: 'Q1?', options: [{ label: 'A' }, { label: 'B' }] },
      { id: 'g2', question: 'Q2?', options: [{ label: 'C' }, { label: 'D' }] },
      { id: 'g3', question: 'Q3?', options: [{ label: 'E' }] },
    ],
  })
  let event = press({ key: '2', code: 'Digit2' })
  check('第 1 题按 2 → store 记录 B 且停在第 1 题', same(draft.read(), {
    requestKey: 'question:6',
    progress: {
      index: 0,
      drafts: [
        { selected: ['B'], custom: '', skipped: false },
        { selected: [], custom: '', skipped: false },
        { selected: [], custom: '', skipped: false },
      ],
    },
  }), JSON.stringify(draft.read()))
  check('第 1 题按 2 被吞', event.propagationStopped === true)
  check('第 1 题按 2 未结算', log.answer.length === 0)

  // Enter:当前题已作答且非末题 → 翻到下一题(保留上游 continueFlow 的推进)
  event = press({ key: 'Enter', code: 'Enter' })
  check('已作答非末题 Enter → 翻到第 2 题', draft.read().progress.index === 1, `index=${String(draft.read().progress.index)}`)
  check('已作答非末题 Enter 被吞', event.propagationStopped === true)
  check('翻题不结算', log.answer.length === 0)

  // 当前题未作答 → 不吞键、不翻题
  event = press({ key: 'Enter', code: 'Enter' })
  check('未作答 Enter 不翻题(仍在第 2 题)', draft.read().progress.index === 1, `index=${String(draft.read().progress.index)}`)
  check('未作答 Enter 不吞键', event.propagationStopped !== true)
  check('未作答 Enter 不结算', log.answer.length === 0)

  press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('→ 到第 3 题(末题)', draft.read().progress.index === 2, `index=${String(draft.read().progress.index)}`)
  press({ key: '1', code: 'Digit1' })
  check('第 3 题按 1 → store 记录 E 且停在第 3 题', draft.read().progress.index === 2 && same(draft.read().progress.drafts[2].selected, ['E']), JSON.stringify(draft.read().progress.drafts[2]))

  // 末题仍有未完成题 → 不结算、不吞键、不跳回未完成题
  event = press({ key: 'Enter', code: 'Enter' })
  check('末题仍有未完成题 Enter 不结算', log.answer.length === 0, JSON.stringify(log.answer))
  check('末题仍有未完成题 Enter 不吞键', event.propagationStopped !== true)
  check('末题仍有未完成题 Enter 不跳回(仍在第 3 题)', draft.read().progress.index === 2, `index=${String(draft.read().progress.index)}`)

  // 回到第 2 题补答,再回到末题结算
  press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('← 回到第 2 题', draft.read().progress.index === 1, `index=${String(draft.read().progress.index)}`)
  press({ key: '1', code: 'Digit1' })
  press({ key: 'ArrowRight', code: 'ArrowRight' })
  event = press({ key: 'Enter', code: 'Enter' })
  check(
    '全部完成后末题 Enter → answer(三题批量)',
    same(log.answer, [{
      answers: [
        { id: 'g1', selected: ['B'] },
        { id: 'g2', selected: ['C'] },
        { id: 'g3', selected: ['E'] },
      ],
    }]),
    JSON.stringify(log.answer),
  )
  check('Enter 被吞', event.propagationStopped === true)
  check('结算后草稿被清理', same(draft.read(), { progress: { index: 0, drafts: [] } }), JSON.stringify(draft.read()))
}

console.log('\n--- 通用问答:多选切换(store 为唯一真源) ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:7',
    questions: [{
      id: 's1',
      question: 'Multi?',
      multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    }],
  })
  press({ key: '1', code: 'Digit1' })
  press({ key: '3', code: 'Digit3' })
  press({ key: '1', code: 'Digit1' }) // 再按 1 取消 A
  check('多选切换后 store 只留 C', same(draft.read().progress.drafts[0].selected, ['C']), JSON.stringify(draft.read()))
  press({ key: 'Enter', code: 'Enter' })
  check('多选 Enter → answer([C])', same(log.answer, [{ answers: [{ id: 's1', selected: ['C'] }] }]), JSON.stringify(log.answer))
}

console.log('\n--- 通用问答:鼠标/输入框写过的草稿被热键沿用(单一真源) ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:8',
    questions: [{ id: 'c1', question: 'Q?', options: [{ label: 'A' }, { label: 'B' }] }],
  })
  // 模拟用户先在卡片里点了 A 又敲了自定义文本(上游 draftCustom 会清空 selected)
  draft.seed({
    requestKey: 'question:8',
    progress: { index: 0, drafts: [{ selected: [], custom: '手写答案', skipped: false }] },
  })
  press({ key: 'Enter', code: 'Enter' })
  check(
    'Enter → answer(沿用 store 里的 custom)',
    same(log.answer, [{ answers: [{ id: 'c1', selected: [], custom: '手写答案' }] }]),
    JSON.stringify(log.answer),
  )
}

console.log('\n--- 通用问答:← / → 切题(只改题号,草稿保留,首末题不循环) ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:11',
    questions: [
      { id: 'a1', question: 'Q1?', options: [{ label: 'A' }, { label: 'B' }] },
      { id: 'a2', question: 'Q2?', options: [{ label: 'C' }] },
      { id: 'a3', question: 'Q3?', options: [{ label: 'D' }] },
    ],
  })
  // 第 1 题单选作答 → 数字键只改选中态,题号不动
  press({ key: '1', code: 'Digit1' })
  check('按 1 后仍停在第 1 题(数字键不翻题)', draft.read().progress.index === 0, `index=${String(draft.read().progress.index)}`)

  let event = press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('→ 到第 2 题', draft.read().progress.index === 1, `index=${String(draft.read().progress.index)}`)
  check('→ 被吞', event.propagationStopped === true)

  event = press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('← 回到第 1 题', draft.read().progress.index === 0, `index=${String(draft.read().progress.index)}`)
  check('← 保留已选草稿', same(draft.read().progress.drafts[0].selected, ['A']), JSON.stringify(draft.read().progress.drafts[0]))

  event = press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('首题按 ← 不循环(仍第 1 题)', draft.read().progress.index === 0, `index=${String(draft.read().progress.index)}`)
  check('首题按 ← 不吞键', event.propagationStopped !== true)

  press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('→ 到第 2 题', draft.read().progress.index === 1, `index=${String(draft.read().progress.index)}`)
  event = press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('→ 到第 3 题(末题)', draft.read().progress.index === 2, `index=${String(draft.read().progress.index)}`)
  check('→ 被吞', event.propagationStopped === true)

  event = press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('末题按 → 不循环(仍第 3 题)', draft.read().progress.index === 2, `index=${String(draft.read().progress.index)}`)
  check('末题按 → 不吞键', event.propagationStopped !== true)
  check('切题全程不结算', log.answer.length === 0, JSON.stringify(log.answer))

  // 焦点在可编辑元素时方向键必须交回输入框(光标移动),不得切题
  event = press({ key: 'ArrowLeft', code: 'ArrowLeft', target: new FakeHTMLElement('INPUT') })
  check('焦点在输入框时 ← 不吞键(交回输入框)', event.propagationStopped !== true)
  check('焦点在输入框时 ← 不切题', draft.read().progress.index === 2, `index=${String(draft.read().progress.index)}`)
  pending.delete('sess-b')
}

console.log('\n--- 计划评审:← / → no-op(单题一次决策) ---')
{
  const log = mount({ kind: 'plan-review', key: 'question:12', questions: planQuestions })
  let event = press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('计划评审 ← 不吞键', event.propagationStopped !== true)
  event = press({ key: 'ArrowRight', code: 'ArrowRight' })
  check('计划评审 → 不吞键', event.propagationStopped !== true)
  check('计划评审方向键不结算', log.answer.length === 0 && log.cancel === 0)
}

console.log('\n--- 无待处理卡片时 ← / → 放行(浏览态) ---')
{
  const event = press({ key: 'ArrowLeft', code: 'ArrowLeft' })
  check('无卡片时 ← 不吞键', event.propagationStopped !== true)
}

console.log('\n--- 未作答 / 无待处理时的放行 ---')
{
  const log = mount({
    kind: 'question',
    key: 'question:9',
    questions: [{ id: 'u1', question: 'Q?', options: [{ label: 'A' }] }],
  })
  const event = press({ key: 'Enter', code: 'Enter' })
  check('未作答 Enter 不结算', log.answer.length === 0)
  check('未作答 Enter 不吞键', event.propagationStopped !== true)
  pending.delete('sess-b')
  const idle = press({ key: 'Enter', code: 'Enter' })
  check('无待处理审批时 Enter 不吞键', idle.propagationStopped !== true)
  const idleEsc = press({ key: 'Escape', code: 'Escape' })
  check('无待处理审批时 Esc 不吞键', idleEsc.propagationStopped !== true)
  const digit = press({ key: '1', code: 'Digit1' })
  check('无待处理问答时不吞键', digit.propagationStopped !== true)
}

console.log('\n--- 权威来源不可用 → no-op(无降级) ---')
{
  const cases = [
    ['slots 服务缺失', { slots: undefined }],
    ['slots 无 resolveStore', { slots: { entries: () => [{ store: {} }] } }],
    ['uiSession 无 bindingSource', { uiSession: { pendingInteractions: { getSnapshot: () => pending }, bindingSource: undefined } }],
    ['注册项 select 不匹配', {
      slots: {
        entries: () => [{ store: {}, select: () => null }],
        resolveStore: () => { throw new Error('must not resolve') },
      },
    }],
    ['活实例缺 actions.replace', {
      slots: {
        entries: () => [{ store: {}, select: () => ({}) }],
        resolveStore: () => ({ getSnapshot: () => ({}) }),
      },
    }],
  ]
  for (const [label, extra] of cases) {
    const isolated = new Map()
    isolated.set('sess-b', {
      kind: 'question',
      key: 'question:10',
      sessionId: 'sess-b',
      questions: [{ id: 'n1', question: 'Q?', options: [{ label: 'A' }] }],
      answer: () => { throw new Error('must not answer') },
    })
    const env = loadPlugin({
      sessions,
      uiSession: {
        pendingInteractions: { getSnapshot: () => isolated },
      },
      sidebarRight: { toggleExpanded() {} },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      ...extra,
    })
    const digitEvent = env({ key: '1', code: 'Digit1' })
    const enterEvent = env({ key: 'Enter', code: 'Enter' })
    const arrowEvent = env({ key: 'ArrowRight', code: 'ArrowRight' })
    check(`${label} → 数字键不吞键`, digitEvent.propagationStopped !== true)
    check(`${label} → Enter 不吞键`, enterEvent.propagationStopped !== true)
    check(`${label} → → 不吞键`, arrowEvent.propagationStopped !== true)
  }
}

// ---- 阶段 2:仅私有字段 pendingSnapshot(兼容回退) ----
console.log('\n--- 兼容回退:仅 pendingSnapshot ---')
{
  const legacy = new Map()
  const legacyServices = {
    sessions,
    uiSession: { pendingSnapshot: legacy },
    sidebarRight: { toggleExpanded() {} },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  }
  const pressLegacy = loadPlugin(legacyServices)
  const log = { answer: [] }
  legacy.set('sess-b', {
    kind: 'approval',
    key: 'approval:9',
    answer: (payload) => { log.answer.push(payload); legacy.delete('sess-b') },
  })
  const event = pressLegacy({ key: 'Enter', code: 'Enter' })
  check('pendingSnapshot 回退仍可应答', same(log.answer, ['allowed-once']), JSON.stringify(log.answer))
  check('回退路径吞键', event.propagationStopped === true)
}

if (isMain(import.meta.url)) report()
