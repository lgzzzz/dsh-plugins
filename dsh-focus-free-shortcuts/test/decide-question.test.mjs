/**
 * N 提问判定:`src/question-keys.ts` 的纯提问决策 —— `Esc` 的无焦点准入、
 * "这一按落在哪张卡片里"的归属判定,以及"哪个待答提问可以关"。
 *
 * 运行:`node test/decide-question.test.mjs`(或 pnpm test 跑全部)。
 */
import { asDismissableQuestion, presentedQuestion, questionCardOwnsTarget, questionEscapeEligible } from '../src/question-keys.ts'
import { approvalPending, check, checkTrue, domApproval, domBareQuestionCard, domBody, domComposer, domPlanReviewButton, domPlanReviewCard, domQuestionCard, domQuestionField, finish, gesture, PLAN_REVIEW_KEY, QUESTION_KEY, questionPending, shortcutContext, statusWith } from './helpers.mjs'

console.log('--- N① 无焦点准入:只有"裸 Esc 的第一下"才谈得上关卡片 ---')
{
  checkTrue('page 上的 Esc 准入', questionEscapeEligible(gesture('Escape'), shortcutContext()))
  check('别的键否决(Enter 不关卡片)', questionEscapeEligible(gesture('Enter'), shortcutContext()), false)
  check('Ctrl 否决', questionEscapeEligible(gesture('Escape', { control: true }), shortcutContext()), false)
  check('Alt 否决', questionEscapeEligible(gesture('Escape', { alt: true }), shortcutContext()), false)
  check('Shift 否决', questionEscapeEligible(gesture('Escape', { shift: true }), shortcutContext()), false)
  check('Meta 否决', questionEscapeEligible(gesture('Escape', { meta: true }), shortcutContext()), false)
  check('repeat 否决', questionEscapeEligible(gesture('Escape', { repeat: true }), shortcutContext()), false)
  check('composing 否决', questionEscapeEligible(gesture('Escape', { composing: true }), shortcutContext()), false)
  check('已被消费否决', questionEscapeEligible(gesture('Escape', { defaultPrevented: true }), shortcutContext()), false)
  check('模态层之上否决', questionEscapeEligible(gesture('Escape'), shortcutContext({ modal: 'settings' })), false)
  check('终端内否决(终端的 Esc 归终端)', questionEscapeEligible(gesture('Escape'), shortcutContext({ region: 'terminal' })), false)
  // `editable` 本身不否决:卡片自己的答案文本域就是 `editable`,它只绑 Enter。
  // 真正决定"这一按归谁"的是下面 N② 的归属判定(由桥组合成一条完整判定)。
  checkTrue('文本控件内仍准入(归属判定再收口)', questionEscapeEligible(gesture('Escape'), shortcutContext({ region: 'editable' })))
}

console.log('--- N② 卡片归属:落在"这一张"卡片里才算它的 ---')
{
  checkTrue('卡片自己的答案文本域 → 是这张卡片', questionCardOwnsTarget(domQuestionField, QUESTION_KEY))
  checkTrue('卡片根自身 → 是这张卡片', questionCardOwnsTarget(domQuestionCard, QUESTION_KEY))
  checkTrue('plan-review 卡片内 → 按自己的键命中', questionCardOwnsTarget(domPlanReviewButton, PLAN_REVIEW_KEY))
  check('键不同的卡片 → 不是这一张(过期卡片不接)', questionCardOwnsTarget(domQuestionField, PLAN_REVIEW_KEY), false)
  check('键不同的 plan-review → 不是这一张', questionCardOwnsTarget(domPlanReviewCard, QUESTION_KEY), false)
  check('composer → 不在卡片里', questionCardOwnsTarget(domComposer, QUESTION_KEY), false)
  check('审批面板 → 不在卡片里', questionCardOwnsTarget(domApproval, QUESTION_KEY), false)
  check('body → 不在卡片里', questionCardOwnsTarget(domBody, QUESTION_KEY), false)
  check('null → 不在卡片里', questionCardOwnsTarget(null, QUESTION_KEY), false)
  check('没有 getAttribute 的裸卡片 → 值比较无从谈起', questionCardOwnsTarget(domBareQuestionCard, QUESTION_KEY), false)
}

console.log('--- N③ 可关闭的提问 ---')
{
  const question = questionPending()
  const statuses = statusWith('s1', question)
  checkTrue('主视图的待答提问可关', presentedQuestion('s1', statuses) === question)
  checkTrue('plan-review 也归这条桥', presentedQuestion('s1', statusWith('s1', questionPending({ key: PLAN_REVIEW_KEY, kind: 'plan-review' }))) !== undefined)
  check('别的待答域不接(kind = approval)', asDismissableQuestion(approvalPending()), undefined)
  check('缺 kind 不接', asDismissableQuestion({ key: QUESTION_KEY, dismiss() {} }), undefined)
  check('kind 不在提问域不接', asDismissableQuestion({ kind: 'other', key: QUESTION_KEY, dismiss() {} }), undefined)
  check('缺 dismiss 不接', asDismissableQuestion({ kind: 'question', key: QUESTION_KEY }), undefined)
  check('dismiss 不是函数不接', asDismissableQuestion({ kind: 'question', key: QUESTION_KEY, dismiss: 7 }), undefined)
  check('缺 key 不接', asDismissableQuestion({ kind: 'question', dismiss() {} }), undefined)
  check('key 不是字符串不接', asDismissableQuestion({ kind: 'question', key: 7, dismiss() {} }), undefined)
  check('非对象不接', asDismissableQuestion(null), undefined)
  check('没有该会话的状态不接', presentedQuestion('s2', statuses), undefined)
  check('主视图歧义(undefined)不接', presentedQuestion(undefined, statuses), undefined)
  check('状态表为空不接', presentedQuestion('s1', new Map()), undefined)
}

finish()
