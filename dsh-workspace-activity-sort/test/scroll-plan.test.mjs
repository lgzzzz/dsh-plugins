/**
 * 纯函数测试：验证「这次顺序变化是不是一次重排到最前」的判定，以及滚动写入在各类侧栏状态下
 * 的取舍（窗口没渲染、单列表视图、已在最上面、没有文档）。
 *
 * 运行：`node test/scroll-plan.test.mjs`。
 */
import assert from 'node:assert/strict'
import {
  DRAG_GRACE_MS,
  DRAG_STALE_MS,
  SECTION_SCROLLER_SELECTOR,
  WORKSPACE_ROW_SELECTOR,
  frontArrival,
  scrollWorkspaceSectionToTop,
  sectionScroller,
  workspaceRowOf,
} from '../src/scroll.ts'
import { createSidebarDom, otherDragTarget, workspaceDragTarget } from './client-helpers.mjs'

// 上游锚点保持与 check-css 契约一致

assert.equal(SECTION_SCROLLER_SELECTOR, '[data-sidebar-list-area]', '滚动容器锚点是上游 listArea 的 data 标记')
assert.equal(WORKSPACE_ROW_SELECTOR, '[data-row-key^="workspace:"]', '分组行锚点按上游行 key 前缀匹配')

// 重排到最前

{
  assert.equal(frontArrival(['a', 'b', 'c'], ['b', 'a', 'c']), 'b', '第二个移到最前算一次上浮')
  assert.equal(frontArrival(['a', 'b', 'c'], ['c', 'a', 'b']), 'c', '末尾移到最前算一次上浮')
  assert.equal(frontArrival(['a', 'b', 'c', 'd'], ['d', 'b', 'a', 'c']), 'd', '其余工作区的相对顺序不影响判定')
}

// 不是重排到最前（基线 / 追加 / 新建 / 删除 / 清空）

{
  assert.equal(frontArrival([], ['a', 'b']), undefined, '空列表 → 首个完整顺序是基线，不滚动')
  assert.equal(frontArrival([], ['a']), undefined, '只有一个工作区的 baseline 也不滚动')
  assert.equal(frontArrival(['a', 'b'], ['a', 'b', 'c']), undefined, '末尾追加不改变第一名')
  assert.equal(frontArrival(['a', 'b'], ['n', 'a', 'b']), undefined, '新建工作区插到最前不算重排')
  assert.equal(frontArrival(['a', 'b', 'c'], ['b', 'c']), undefined, '删除原第一名后下一个顶上来不算重排')
  assert.equal(frontArrival(['a', 'b', 'c'], ['c', 'b']), undefined, '原第一名被删掉时，前移的新第一名不算重排')
  assert.equal(frontArrival(['a', 'b'], []), undefined, '列表被清空不滚动')
  assert.equal(frontArrival(['a'], ['b']), undefined, '整个列表被替换（旧第一名消失）不滚动')
  assert.equal(frontArrival(['a', 'b'], ['a', 'b']), undefined, '顺序没变不滚动')
  assert.equal(frontArrival(['a'], ['a']), undefined, '只有一个工作区时顺序不可能变')
}

// 滚动写入

{
  const dom = createSidebarDom({ scrollTop: 240 })
  assert.equal(sectionScroller(dom.document), dom.area, '找得到侧栏区块的滚动容器')
  assert.equal(scrollWorkspaceSectionToTop(dom.document), true, '有分组行、有滚动余量时写回最上面')
  assert.equal(dom.area.scrollTop, 0, '写入后 scrollTop 归零')
  assert.equal(scrollWorkspaceSectionToTop(dom.document), false, '已经在最上面时不再写')
  assert.equal(dom.area.scrollTop, 0, '重复调用仍停在最上面')
}

{
  const dom = createSidebarDom({ scrollTop: 240, workspaceRows: false })
  assert.equal(scrollWorkspaceSectionToTop(dom.document), false, '单列表视图没有分组行：不滚')
  assert.equal(dom.area.scrollTop, 240, '滚动位置保持不动')
}

{
  const dom = createSidebarDom({ scrollTop: 240, area: false })
  assert.equal(sectionScroller(dom.document), undefined, '侧栏没渲染时找不到滚动容器')
  assert.equal(scrollWorkspaceSectionToTop(dom.document), false, '侧栏没渲染：不滚')
}

{
  assert.equal(sectionScroller(undefined), undefined, '没有文档时没有滚动容器')
  assert.equal(scrollWorkspaceSectionToTop(undefined), false, '没有文档时什么都不做')
}

// 拖拽起点判定与静默窗口

{
  assert.equal(workspaceRowOf(workspaceDragTarget()), true, '起点在分组行里：认作一次工作区拖拽')
  assert.equal(workspaceRowOf(otherDragTarget()), false, '起点不在分组行里：不是工作区拖拽')
  assert.equal(workspaceRowOf(null), false, '没有 target 时不算')
  assert.equal(workspaceRowOf(undefined), false, 'target 缺席时不算')
  assert.equal(workspaceRowOf({}), false, '没有 closest 的 target（测试替身）不算')
  assert.equal(DRAG_GRACE_MS > 0 && DRAG_GRACE_MS <= 1000, true, '拖拽结束后的静默窗口是短窗口')
  assert.equal(DRAG_STALE_MS > DRAG_GRACE_MS, true, '丢事件的上限长于静默窗口')
}

console.log('scroll-plan: 全部通过')
