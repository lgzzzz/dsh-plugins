/**
 * H 审批判定:`src/approval-keys.ts` 与 `src/binding.ts` 的纯审批决策 —— 已挂载的
 * 固定行是否仍预约这一次按键、这一次按键算哪个决定、无焦点准入、面板归属,
 * 以及"哪个待答审批可以答"。
 *
 * 运行:`node test/decide-approval.test.mjs`(或 pnpm test 跑全部)。
 */
import { approvalEligible, approvalOutcomeFor, approvalPanelOwnsTarget, asAnswerableApproval, presentedApproval } from '../src/approval-keys.ts'
import { fixedRowOwns } from '../src/binding.ts'
import { APPROVAL_FIXED_ROWS, APPROVAL_IDS, approvalPending, check, checkTrue, domApproval, domBody, domComposer, finish, fixedRow, gesture, shortcutContext, statusWith } from './helpers.mjs'

console.log('--- H① 已挂载的固定审批行与决定 ---')
{
  check('Enter → 允许一次', approvalOutcomeFor(APPROVAL_FIXED_ROWS, gesture('Enter'), APPROVAL_IDS), 'allowed-once')
  check('Escape → 拒绝', approvalOutcomeFor(APPROVAL_FIXED_ROWS, gesture('Escape'), APPROVAL_IDS), 'rejected')
  check('别的键 → 不是审批键', approvalOutcomeFor(APPROVAL_FIXED_ROWS, gesture('KeyK'), APPROVAL_IDS), undefined)
  check('带修饰键 → 不命中', approvalOutcomeFor(APPROVAL_FIXED_ROWS, gesture('Enter', { shift: true }), APPROVAL_IDS), undefined)
  check('只挂载 reject → Enter 落空', approvalOutcomeFor([APPROVAL_FIXED_ROWS[1]], gesture('Enter'), APPROVAL_IDS), undefined)
  check('固定目录为空(审批插件未装载)→ 落空', approvalOutcomeFor([], gesture('Enter'), APPROVAL_IDS), undefined)
  checkTrue('fixedRowOwns 命中已挂载行', fixedRowOwns(APPROVAL_FIXED_ROWS, 'approval.reject', gesture('Escape')))
  check('fixedRowOwns 未挂载行', fixedRowOwns(APPROVAL_FIXED_ROWS, 'approval.other', gesture('Escape')), false)

  // 固定行不可改键,但跟随属主:行换了物理组合,桥就跟着换。
  const rebound = [fixedRow('approval.allow', [{ code: 'KeyY', modifiers: ['meta'] }])]
  check('行改键后旧键落空', approvalOutcomeFor(rebound, gesture('Enter'), APPROVAL_IDS), undefined)
  check('行改键后新键命中', approvalOutcomeFor(rebound, gesture('KeyY', { meta: true }), APPROVAL_IDS), 'allowed-once')
}

console.log('--- H② 无焦点准入 ---')
{
  checkTrue('page 上的回车准入', approvalEligible(gesture('Enter'), shortcutContext()))
  checkTrue('page 上的 Esc 准入', approvalEligible(gesture('Escape'), shortcutContext()))
  check('repeat 否决', approvalEligible(gesture('Enter', { repeat: true }), shortcutContext()), false)
  check('composing 否决', approvalEligible(gesture('Enter', { composing: true }), shortcutContext()), false)
  check('已被消费否决', approvalEligible(gesture('Enter', { defaultPrevented: true }), shortcutContext()), false)
  check('模态层之上否决', approvalEligible(gesture('Enter'), shortcutContext({ modal: 'settings' })), false)
  check('文本控件内否决', approvalEligible(gesture('Enter'), shortcutContext({ region: 'editable' })), false)
  check('终端内否决', approvalEligible(gesture('Enter'), shortcutContext({ region: 'terminal' })), false)
}

console.log('--- H③ 面板归属:目标落在面板里就让位 ---')
{
  checkTrue('面板内 → 面板掌权', approvalPanelOwnsTarget(domApproval))
  check('composer → 不掌权', approvalPanelOwnsTarget(domComposer), false)
  check('body → 不掌权', approvalPanelOwnsTarget(domBody), false)
  check('null → 不掌权', approvalPanelOwnsTarget(null), false)
}

console.log('--- H④ 可作答的审批 ---')
{
  const pending = approvalPending()
  const statuses = statusWith('s1', pending)
  checkTrue('主视图的待答审批可答', presentedApproval('s1', statuses) === pending)
  check('已作答不再可答', presentedApproval('s1', statusWith('s1', approvalPending({ answerable: false }))), undefined)
  check('别的待答域不接(kind)', asAnswerableApproval({ kind: 'question', key: 'q1', answerable: true, answer() {} }), undefined)
  check('缺 answer 不接', asAnswerableApproval({ kind: 'approval', key: 'a', answerable: true }), undefined)
  check('缺 key 不接', asAnswerableApproval({ kind: 'approval', key: 7, answerable: true, answer() {} }), undefined)
  check('非对象不接', asAnswerableApproval(null), undefined)
  check('没有该会话的状态不接', presentedApproval('s2', statuses), undefined)
  check('主视图歧义(undefined)不接', presentedApproval(undefined, statuses), undefined)
  check('状态表为空不接', presentedApproval('s1', new Map()), undefined)
}

finish()
