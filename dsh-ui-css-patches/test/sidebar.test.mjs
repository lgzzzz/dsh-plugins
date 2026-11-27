/**
 * `src/sidebar.ts` 的行为测试：收起状态只读帧标记；`toggleSidebar` 在展开态是空操作、
 * 在收起态原样放行；控制器与私有动作表都被包住，卸载后全部还原。
 *
 * 不需要真实 DOM：文档、控制器与动作表都用最小替身。运行：
 * `node test/sidebar.test.mjs`（或 `pnpm test` 跑全部）。
 */
import {
  LEFT_SIDEBAR_COLLAPSED_SELECTOR,
  installSidebarGuard,
  isLeftSidebarCollapsed,
} from '../src/sidebar.ts'

let failures = 0

function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e}，实得 ${a}`}`)
}

function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/** 只按选择器回答「帧是否收起」的最小文档替身。 */
function fakeDocument({ collapsed = false } = {}) {
  return {
    collapsed,
    querySelector(selector) {
      if (selector !== LEFT_SIDEBAR_COLLAPSED_SELECTOR) return null
      return collapsed ? {} : null
    },
  }
}

/** 控制器 + 它的私有动作表；调用计数分开记。 */
function fakeLayout() {
  const calls = { controller: 0, action: 0 }
  const actions = {
    toggleSidebar() {
      calls.action += 1
    },
  }
  const layout = {
    panels: actions,
    toggleSidebar() {
      calls.controller += 1
      actions.toggleSidebar()
    },
  }
  return { layout, actions, calls }
}

console.log('--- S① 收起状态只读帧上的 data-sidebar-collapsed ---')
{
  check('展开态', isLeftSidebarCollapsed(fakeDocument()), false)
  check('收起态', isLeftSidebarCollapsed(fakeDocument({ collapsed: true })), true)
}

console.log('--- S② 展开态：控制器与动作表都不再收起 ---')
{
  const doc = fakeDocument()
  const { layout, actions, calls } = fakeLayout()
  const dispose = installSidebarGuard(layout, doc)

  layout.toggleSidebar()
  actions.toggleSidebar()
  check('控制器调用被吞', calls, { controller: 0, action: 0 })

  dispose()
}

console.log('--- S③ 收起态：放行展开，控制器只走一次动作 ---')
{
  const doc = fakeDocument({ collapsed: true })
  const { layout, actions, calls } = fakeLayout()
  const dispose = installSidebarGuard(layout, doc)

  layout.toggleSidebar()
  check('控制器与动作各执行一次', calls, { controller: 1, action: 1 })

  calls.controller = 0
  calls.action = 0
  actions.toggleSidebar()
  check('直接调动作表也放行', calls, { controller: 0, action: 1 })

  dispose()
}

console.log('--- S④ 卸载后还原两个 toggleSidebar ---')
{
  const doc = fakeDocument()
  const { layout, actions, calls } = fakeLayout()
  const originalController = layout.toggleSidebar
  const originalAction = actions.toggleSidebar
  const dispose = installSidebarGuard(layout, doc)

  check('控制器已包层', layout.toggleSidebar === originalController, false)
  check('动作表已包层', actions.toggleSidebar === originalAction, false)

  dispose()
  check('控制器已还原', layout.toggleSidebar, originalController)
  check('动作表已还原', actions.toggleSidebar, originalAction)

  layout.toggleSidebar()
  check('还原后展开态照常收起', calls, { controller: 1, action: 1 })
}

console.log('--- S⑤ 动作表缺席时只包控制器，不抛错 ---')
{
  const doc = fakeDocument()
  const layout = { toggleSidebar() {} }
  const dispose = installSidebarGuard(layout, doc)
  check('可以调用', typeof layout.toggleSidebar, 'function')
  dispose()
  check('可以再次卸载', typeof dispose, 'function')
}

finish()
