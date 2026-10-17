/**
 * A 纯投影与定位:不碰 slots 的纯函数 —— verbose 折叠投影、收起时机保留、
 * 注入面形状判定、按 id 找注册项。
 */
import { findChatViewEntry, foldCompletedForVerbose, presentationOf } from '../src/policy-fold.ts'
import { chatEntry, check, checkTrue, FakeSlots, finish, makeSource, policyFor } from './helpers.mjs'

console.log('--- A① 纯投影:verbose 折叠,收起时机保留 ---')
{
  const verbose = policyFor('verbose', 'next-input')
  const folded = foldCompletedForVerbose(verbose)
  check('verbose 折叠为 true', folded.foldCompletedTurns, true)
  check('verbose 保持无组头', folded.stepGrouping, 'none')
  check('verbose 保留收起时机', folded.collapseTiming, 'next-input')
  checkTrue('verbose 返回新对象(不污染原策略)', folded !== verbose)
  check('verbose 原对象仍为 false', verbose.foldCompletedTurns, false)

  const completion = policyFor('verbose', 'completion')
  check('completion 时机同样折叠', foldCompletedForVerbose(completion).foldCompletedTurns, true)
  check('completion 时机保留', foldCompletedForVerbose(completion).collapseTiming, 'completion')

  const compact = policyFor('compact')
  checkTrue('compact 按身份透传', foldCompletedForVerbose(compact) === compact)
  check('compact 保持原值', foldCompletedForVerbose(compact).foldCompletedTurns, true)

  const already = { mode: 'verbose', foldCompletedTurns: true, stepGrouping: 'none' }
  checkTrue('verbose 已折叠 → 按身份透传', foldCompletedForVerbose(already) === already)

  const bare = {}
  checkTrue('无 mode → 按身份透传', foldCompletedForVerbose(bare) === bare)
}

console.log('--- A② 同一原始策略的投影保持稳定引用 ---')
{
  const verbose = policyFor('verbose', 'next-input')
  const first = foldCompletedForVerbose(verbose)
  const second = foldCompletedForVerbose(verbose)
  checkTrue('同一原始对象 → 同一投影对象', first === second)

  const otherTiming = foldCompletedForVerbose(policyFor('verbose', 'completion'))
  checkTrue('不同收起时机 → 不同投影对象', first !== otherTiming)
}

console.log('--- A③ presentationOf:形状不符一律判缺失 ---')
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

console.log('--- A④ findChatViewEntry:按 id 命中,容忍缺席 ---')
{
  const entry = chatEntry(makeSource('verbose').source)
  check('命中注册项', findChatViewEntry(new FakeSlots([entry])), entry)
  check('无注册项', findChatViewEntry(new FakeSlots([])), undefined)
  check('entries 非函数', findChatViewEntry({}), undefined)
}

finish()
