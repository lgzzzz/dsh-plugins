/**
 * A 纯投影与定位:`src/policy-fold.ts` 里不碰 slots 的那几个纯函数 ——
 * verbose 折叠的纯投影(其余模式按身份透传)、注入面形状判定、按 id 找注册项。
 */
import { findChatViewEntry, foldCompletedForVerbose, presentationOf } from '../src/policy-fold.ts'
import { chatEntry, check, checkTrue, FakeSlots, finish, makeSource, policyFor } from './helpers.mjs'

console.log('--- A① 纯投影:verbose 折叠,其余按身份透传 ---')
{
  const verbose = policyFor('verbose')
  const folded = foldCompletedForVerbose(verbose)
  check('verbose 折叠为 true', folded.foldCompletedTurns, true)
  check('verbose 其余字段不变', folded.stepGrouping, 'none')
  checkTrue('verbose 返回新对象(不污染 POLICIES)', folded !== verbose)
  check('verbose 原对象仍为 false', verbose.foldCompletedTurns, false)

  const compact = policyFor('compact')
  checkTrue('compact 按身份透传', foldCompletedForVerbose(compact) === compact)
  check('compact 保持 false', foldCompletedForVerbose(compact).foldCompletedTurns, false)

  const already = { mode: 'verbose', foldCompletedTurns: true }
  checkTrue('verbose 已折叠 → 按身份透传', foldCompletedForVerbose(already) === already)

  const bare = {}
  checkTrue('无 mode → 按身份透传', foldCompletedForVerbose(bare) === bare)
}

console.log('--- A② presentationOf:形状不符一律判缺失 ---')
{
  const source = makeSource('verbose').source
  checkTrue('合法注入面取到 source', presentationOf({ hooks: { presentation: source } }) === source)
  check('无 hooks', presentationOf({}), undefined)
  check('hooks 非对象', presentationOf({ hooks: 3 }), undefined)
  check('presentation 缺席', presentationOf({ hooks: {} }), undefined)
  check('presentation 非对象', presentationOf({ hooks: { presentation: 7 } }), undefined)
  check('缺 getSnapshot', presentationOf({ hooks: { presentation: { subscribe() {} } } }), undefined)
  check('缺 subscribe', presentationOf({ hooks: { presentation: { getSnapshot() {} } } }), undefined)
  check('face 为 null', presentationOf(null), undefined)
}

console.log('--- A③ findChatViewEntry:按 id 命中,容忍缺席 ---')
{
  const entry = chatEntry(makeSource('verbose').source)
  check('命中注册项', findChatViewEntry(new FakeSlots([entry])), entry)
  check('无注册项', findChatViewEntry(new FakeSlots([])), undefined)
  check('entries 非函数', findChatViewEntry({}), undefined)
}

finish()
