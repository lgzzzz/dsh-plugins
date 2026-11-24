/**
 * 分区标记：标记落在最近的 `[data-session-panel-section]` 上、卸载时只摘一次、
 * 找不到落点或元素形状不对时是空操作。
 *
 * 这层是隐藏 forge 连接行的唯一支点：标记没打上，说明那一行会出现、而「重试」那一行还在。
 *
 * 运行：`node test/mark.test.mjs`（或 pnpm test 跑全部）。
 */
import { MARKER_ATTRIBUTE, SECTION_SELECTOR, markSectionOfRow } from '../src/mark.ts'
import { check, checkTrue, finish } from './helpers.mjs'

/** 造一个分区元素替身，记下属性写入与最外层查询用的选择器。 */
function sectionStub() {
  const attributes = new Map()
  const calls = []
  return {
    attributes,
    calls,
    setAttribute: (name, value) => { attributes.set(name, value) },
    removeAttribute: (name) => { calls.push(name); attributes.delete(name) },
  }
}

console.log('--- M① 找到分区：打标记，卸载时摘掉 ---')
{
  const section = sectionStub()
  const row = { closest: (selector) => { row.selector = selector; return section } }
  const release = markSectionOfRow(row)
  check('用分区锚点向上找', row.selector, SECTION_SELECTOR)
  check('标记写在分区上', [...section.attributes.keys()], [MARKER_ATTRIBUTE])
  release()
  check('卸载时摘掉标记', section.calls, [MARKER_ATTRIBUTE])
  check('摘干净', [...section.attributes.keys()], [])
}

console.log('--- M② 重复卸载只摘一次 ---')
{
  const section = sectionStub()
  const release = markSectionOfRow({ closest: () => section })
  release()
  release()
  check('removeAttribute 只调一次', section.calls, [MARKER_ATTRIBUTE])
}

console.log('--- M③ 没有落点 / 元素缺席：空操作 ---')
{
  let released = 0
  const release = markSectionOfRow({ closest: () => null })
  release()
  check('找不到分区也不抛', typeof release, 'function')
  const noop = markSectionOfRow(null)
  noop()
  const noClosest = markSectionOfRow({})
  noClosest()
  checkTrue('缺席时是空操作', released === 0)
}

finish()
