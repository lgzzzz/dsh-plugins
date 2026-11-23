/**
 * 文件列表宽度固定：隐藏文件树分隔条的样式表、安装 / 卸载，以及没有样式能力时的降级。
 *
 * 运行：`node test/tree-fixed.test.mjs`（或 pnpm test 跑全部）。
 */
import { CSS, MARKER_ATTRIBUTE, installFixedTreeWidth } from '../src/tree-fixed.ts'
import { FakeRootElement, check, checkTrue, finish } from './card-helpers.mjs'
import { FullDocument } from './full-document.mjs'

console.log('--- F① 样式：只隐藏 forge 变更视图里的文件树分隔条 ---')
{
  checkTrue('命中 role + aria-controls', CSS.includes('[data-forge-changes] [role="separator"][aria-controls]'))
  checkTrue('用 display:none 隐藏', CSS.includes('display: none !important'))
  checkTrue('作用域限定在 forge 根里', CSS.trimStart().startsWith('[data-forge-changes] '))
  check('只有一条声明块', CSS.split('{').length - 1, 1)
  checkTrue('不写宽度', !/width\s*:/.test(CSS))
  checkTrue('不读写存储', !/localStorage|storage/.test(CSS))
}

console.log('--- F② 安装：注入 style、写插件标记与文档根标记 ---')
{
  const doc = new FullDocument()
  const dispose = installFixedTreeWidth(doc)
  check('样式写进 head', doc.head.child?.textContent, CSS)
  check('样式元素带插件标记', doc.head.child?.dataset?.plugin, 'dsh-changes-behavior')
  check('文档根标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), '')

  dispose()
  check('卸载移除样式', doc.head.child?.removed, true)
  check('卸载移除标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
}

console.log('--- F③ 没有样式能力：只写标记，不抛错 ---')
{
  const doc = { documentElement: new FakeRootElement() }
  const dispose = installFixedTreeWidth(doc)
  check('只留标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), '')
  dispose()
  check('卸载移除标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
}

console.log('--- F④ 没有文档：空操作 ---')
{
  const dispose = installFixedTreeWidth(undefined)
  checkTrue('返回可调用卸载函数', typeof dispose === 'function')
  dispose()
}

finish()
