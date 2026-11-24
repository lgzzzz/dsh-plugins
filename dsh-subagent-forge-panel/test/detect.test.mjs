/**
 * 子会话判定：地址与会话列表行两条依据，各自单独成立、彼此兜底，且都不误判普通会话。
 *
 * 两条依据对应两条打开路径：从子会话自己打开时快照带地址；页面重开或从侧栏列表直接打开时
 * 只有列表行还记得 origin。任一条失效都会让一半路径漏判——所以这里逐条钉住。
 *
 * 运行：`node test/detect.test.mjs`（或 pnpm test 跑全部）。
 */
import { isSubagentSession } from '../src/detect.ts'
import { checkTrue, finish } from './helpers.mjs'

/** 会话身份。 */
const sessionId = 'child'

console.log('--- D① 快照带地址：点名的就是本会话 ---')
checkTrue('地址点名本会话', isSubagentSession({
  sessionId,
  address: { parentSessionId: 'root', childSessionId: sessionId, mode: 'continuable' },
  origin: undefined,
}))

console.log('--- D② 地址属于别的会话：不作数 ---')
checkTrue('换过会话后残留的地址不判定', !isSubagentSession({
  sessionId,
  address: { parentSessionId: 'root', childSessionId: 'another-child', mode: 'continuable' },
  origin: undefined,
}))

console.log('--- D③ 只有列表行：页面重开 / 从侧栏直接打开 ---')
checkTrue('列表行标 origin', isSubagentSession({ sessionId, address: null, origin: 'subagent' }))
checkTrue('列表行还没到时凭快照地址', isSubagentSession({
  sessionId,
  address: { parentSessionId: 'root', childSessionId: sessionId, mode: 'one-shot' },
  origin: undefined,
}))

console.log('--- D④ 普通会话不误判 ---')
checkTrue('根会话', !isSubagentSession({ sessionId: 'root', address: null, origin: undefined }))
checkTrue('地址显式 undefined', !isSubagentSession({ sessionId: 'root', address: undefined, origin: undefined }))

finish()
