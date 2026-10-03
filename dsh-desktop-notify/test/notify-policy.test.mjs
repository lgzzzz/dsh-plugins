/**
 * A 判定器:核对 `src/notify-policy.ts` 的通知判定 —— 回合完成、待回答、待审批、
 * 计划评审的触发条件,以及标题/正文/去重/截断规则。
 *
 * 运行:`node test/notify-policy.test.mjs`(或 pnpm test 跑全部)。
 */
import { createNotifyPolicy } from '../src/notify-policy.ts'
import { check, checkTrue, finish, ROWS } from './helpers.mjs'

function frame(entries, rows) {
  return { statuses: new Map(entries), rows: rows ?? {} }
}

console.log('--- A. 判定器(notify-policy)---')

{
  const policy = createNotifyPolicy()
  const first = policy.observe(frame([['s-1', { running: true, pendingInteraction: { key: 'q0', kind: 'question' } }]], ROWS))
  check('首帧只建基线', first, [])

  const done = policy.observe(frame([['s-1', { running: false }]], ROWS))
  check('running true → false 发回合完成', done.length, 1)
  check('回合完成原因', done[0]?.reason, 'turn-complete')
  check('回合完成标题', done[0]?.title, 'DSH · 回合完成')
  check('回合完成正文取 displayTitle', done[0]?.body, '修复登录 bug')
  check('回合完成 tag 带会话与原因', done[0]?.tag, 'dsh-notify:s-1:turn-complete')

  check('同帧重放无差异 → 不发', policy.observe(frame([['s-1', { running: false }]], ROWS)), [])
  check('running false → true 不发', policy.observe(frame([['s-1', { running: true }]], ROWS)), [])
}

{
  const policy = createNotifyPolicy()
  policy.observe(frame([['s-2', { running: true }]], ROWS))
  check('子代理会话不发', policy.observe(frame([['s-2', { running: false }]], ROWS)), [])
}

{
  const policy = createNotifyPolicy()
  policy.observe(frame([['ghost', { running: true }]], ROWS))
  check('列表里查不到的行不发', policy.observe(frame([['ghost', { running: false }]], ROWS)), [])
}

{
  const policy = createNotifyPolicy()
  policy.observe(frame([['s-1', { running: true }]], ROWS))
  const plans = policy.observe(
    frame([['s-1', { running: true, pendingInteraction: { key: 'q1', kind: 'question', sessionId: 's-1', questions: [{ question: '要用哪个数据库?' }] } }]], ROWS),
  )
  check('待回答出现 → 发一条', plans.length, 1)
  check('待回答原因', plans[0]?.reason, 'question')
  check('待回答标题', plans[0]?.title, 'DSH · 需要你回答')
  check('待回答正文 = 标题 + 首题', plans[0]?.body, '修复登录 bug · 要用哪个数据库?')

  const same = policy.observe(
    frame([['s-1', { running: true, pendingInteraction: { key: 'q1', kind: 'question', questions: [{ question: '要用哪个数据库?' }] } }]], ROWS),
  )
  check('同一 key 不重复发', same, [])

  const replaced = policy.observe(
    frame([['s-1', { running: true, pendingInteraction: { key: 'q2', kind: 'question', questions: [{ header: '第二个问题' }] } }]], ROWS),
  )
  check('换新 key → 再发', replaced.length, 1)
  check('题面回退到 header', replaced[0]?.body, '修复登录 bug · 第二个问题')

  const cleared = policy.observe(frame([['s-1', { running: true }]], ROWS))
  check('交互消失不发', cleared, [])
  const again = policy.observe(
    frame([['s-1', { running: true, pendingInteraction: { key: 'q2', kind: 'question', questions: [{ question: '又来了' }] } }]], ROWS),
  )
  check('消失后又出现同一 key → 再发', again.length, 1)
}

{
  const policy = createNotifyPolicy()
  policy.observe(frame([['s-1', {}]], ROWS))
  const approval = policy.observe(
    frame([['s-1', { running: true, pendingInteraction: { key: 'a1', kind: 'approval', toolName: 'git push', reason: '推送到远程' } }]], ROWS),
  )
  check('审批原因', approval[0]?.reason, 'approval')
  check('审批标题', approval[0]?.title, 'DSH · 需要你审批')
  check('审批正文取工具 + 理由', approval[0]?.body, '修复登录 bug · git push · 推送到远程')

  const bare = createNotifyPolicy()
  bare.observe(frame([['s-1', {}]], ROWS))
  const noTool = bare.observe(frame([['s-1', { pendingInteraction: { key: 'a2', kind: 'approval' } }]], ROWS))
  check('审批缺工具名时的兜底正文', noTool[0]?.body, '修复登录 bug · 有一条工具调用等你决定')

  const plan = createNotifyPolicy()
  plan.observe(frame([['s-1', {}]], ROWS))
  const review = plan.observe(frame([['s-1', { pendingInteraction: { key: 'p1', kind: 'plan-review', questions: [{ detail: '计划正文' }] } }]], ROWS))
  check('计划评审原因', review[0]?.reason, 'plan-review')
  check('计划评审标题', review[0]?.title, 'DSH · 计划待确认')
  check('计划评审正文取 detail', review[0]?.body, '修复登录 bug · 计划正文')
}

{
  const long = 'x'.repeat(200)
  const policy = createNotifyPolicy()
  policy.observe(frame([['s-1', { running: true }]], { 's-1': { id: 's-1', displayTitle: long } }))
  const plans = policy.observe(frame([['s-1', { running: false }]], { 's-1': { id: 's-1', displayTitle: long } }))
  checkTrue('超长正文被截断到 96 字', plans[0].body.length === 96 && plans[0].body.endsWith('…'))

  const fallback = createNotifyPolicy()
  fallback.observe(frame([['s-x', { running: true }]], { 's-x': {} }))
  const noTitle = fallback.observe(frame([['s-x', { running: false }]], { 's-x': {} }))
  check('无标题时回退到会话 id', noTitle[0]?.body, 's-x')
}

{
  const policy = createNotifyPolicy()
  check('空状态表首帧安全', policy.observe(frame([])), [])
  check('空状态表后续帧安全', policy.observe(frame([])), [])
}

finish()
