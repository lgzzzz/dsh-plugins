/**
 * 排序计划:`src/order.ts` 的纯计划逻辑 —— 上游序 → 目标序、幂等、
 * 未列出的 id 落在基址段,无 id / 已正确 / 重复表项。
 *
 * 运行:`node test/order-plan.test.mjs`(或 pnpm test 跑全部)。
 */
import { UNLISTED_ORDER_BASE, planOrderWrites } from '../src/order.ts'
import { EXPECTED, check, checkTrue, entry, finish, renderedOrder, upstreamEntries } from './helpers.mjs'

console.log('--- A① 上游序 → 目标序:schedule / job-list 挪到最后 ---')
{
  const entries = upstreamEntries()
  const writes = planOrderWrites(entries)
  check('待写条数', writes.length, 5)
  check('上游初始渲染序', renderedOrder(entries), [
    'agent-preset',
    'schedule-catalog',
    'job-list',
    'agent-team',
    'subagent-catalog',
  ])
  for (const write of writes) write.target.order = write.order
  check('写入后渲染序', renderedOrder(entries), EXPECTED)
}

console.log('--- A② 幂等:同一批注册项重复计划不产生写入 ---')
{
  const entries = upstreamEntries()
  for (const write of planOrderWrites(entries)) write.target.order = write.order
  check('第二次计划为空', planOrderWrites(entries), [])
  check('渲染序不变', renderedOrder(entries), EXPECTED)
}

console.log('--- A③ 未列出的 id:排在表内项之后,相对先后保持 ---')
{
  const entries = [...upstreamEntries(), entry('desktop-notify', 120), entry('zzz-new-icon', 5)]
  for (const write of planOrderWrites(entries)) write.target.order = write.order
  check('表内项按数组下标', entries.slice(0, 5).map((e) => [e.options.id, e.options.order]), [
    ['agent-preset', 0],
    ['schedule-catalog', 3],
    ['job-list', 4],
    ['agent-team', 1],
    ['subagent-catalog', 2],
  ])
  check('未列出项落在基址段且按原 order 排名', [entries[5].options.order, entries[6].options.order], [
    UNLISTED_ORDER_BASE + 1,
    UNLISTED_ORDER_BASE,
  ])
  check('整体渲染序', renderedOrder(entries), [...EXPECTED, 'zzz-new-icon', 'desktop-notify'])
}

console.log('--- A④ 无 id / 已正确 / 重复表项 ---')
{
  const anonymous = { options: { order: 7 } }
  const entries = [...upstreamEntries(), anonymous]
  const writes = planOrderWrites(entries)
  check('无 id 项也纳入计划', writes.some((w) => w.id === '(no id)'), true)
  for (const write of writes) write.target.order = write.order
  check('无 id 项排在未列出段', anonymous.options.order, UNLISTED_ORDER_BASE)
  checkTrue('无 id 项渲染在末尾', renderedOrder(entries).indexOf(undefined) === entries.length - 1)

  const already = [
    entry('agent-preset', 0),
    entry('agent-team', 1),
    entry('subagent-catalog', 2),
    entry('schedule-catalog', 3),
    entry('job-list', 4),
  ]
  check('已正确 → 无写入', planOrderWrites(already), [])

  const dup = planOrderWrites([entry('a', 9), entry('b', 9)], ['b', 'a', 'b'])
  check('重复表项取首个下标', dup.map((w) => [w.id, w.order]), [
    ['a', 1],
    ['b', 0],
  ])
}

finish()
