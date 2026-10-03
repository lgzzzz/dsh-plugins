/**
 * 目标归属:`conversationOwnsTarget` 判断内置 stop 是否按 target 掌权;
 * `mainViewSessionId` 靠 `retainedBy.mainView` 找出唯一的主视图会话(歧义就不动手)。
 */
import { conversationOwnsTarget } from '../src/stop-sequence.ts'
import { mainViewSessionId } from '../src/runtime.ts'
import { check, checkTrue, domApproval, domBody, domComposer, domFrame, domInert, domLooseRegion, finish, session } from './helpers.mjs'

console.log('--- C① 内置 stop 是否按 target 掌权 ---')
{
  checkTrue('会话区内的输入框 → 内置掌权', conversationOwnsTarget(domComposer))
  check('审批控件 → 不掌权', conversationOwnsTarget(domApproval), false)
  check('内嵌 iframe → 不掌权', conversationOwnsTarget(domFrame), false)
  check('inert 内容 → 不掌权', conversationOwnsTarget(domInert), false)
  check('body(无聚焦)→ 不掌权', conversationOwnsTarget(domBody), false)
  check('只有 region 没有 session → 不掌权', conversationOwnsTarget(domLooseRegion), false)
  check('null → 不掌权', conversationOwnsTarget(null), false)
}

console.log('--- C② 主视图会话:靠 retainedBy.mainView 判定,歧义就不动手 ---')
{
  const list = (summary) => ({ ids: Object.keys(summary), byId: summary })
  check('唯一主视图', mainViewSessionId(list({ s1: session('s1'), s2: session('s2', { mainView: 0 }) })), 's1')
  check('没有主视图', mainViewSessionId(list({ s1: session('s1', { mainView: 0 }) })), undefined)
  check('两个主视图(切换中)', mainViewSessionId(list({ s1: session('s1'), s2: session('s2') })), undefined)
  check('计数为 0 不算', mainViewSessionId(list({ s1: { id: 's1', running: true, retainedBy: { mainView: 0 } } })), undefined)
  check('无 retainedBy', mainViewSessionId(list({ s1: { id: 's1', running: true } })), undefined)
  check('空列表', mainViewSessionId(list({})), undefined)
}

finish()
