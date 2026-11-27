/**
 * `src/remove-sidebar-toggle.ts`：把上游 `sidebar.left.toggle` 的绑定清成显式未绑定，
 * 只在目录里仍有绑定时写一次；等配置就绪、`stale` 重试、失败告警与卸载都收敛。
 *
 * 运行：`node test/remove-sidebar-toggle.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  LEFT_SIDEBAR_TOGGLE_ID,
  leftSidebarShortcutBound,
  removeLeftSidebarShortcut,
} from '../src/remove-sidebar-toggle.ts'
import { check, checkTrue, finish, observable, settle } from './helpers.mjs'

const BOUND = { code: 'KeyB', modifiers: ['primary', 'alt'] }

/** 最小快捷键服务：目录 / 配置可推，`edit` 记录调用并更新目录。 */
function fakeService({ bound = true, status = 'ready', editResult } = {}) {
  let revision = 0
  const catalog = observable([{ id: 'session.new', label: '新会话' }, {
    id: LEFT_SIDEBAR_TOGGLE_ID,
    label: '展开／收起左侧栏',
    binding: bound ? BOUND : null,
  }])
  const config = observable({ status, revision: 'revision-0' })
  const edits = []
  return {
    catalog,
    config,
    edits,
    edit(change, expectedRevision) {
      edits.push({ change, expectedRevision })
      if (editResult !== undefined) return Promise.resolve(editResult)
      if (expectedRevision !== config.getSnapshot().revision) {
        return Promise.resolve({ status: 'stale', snapshot: config.getSnapshot() })
      }
      catalog.set(catalog.getSnapshot().map((row) => (row.id === change.id ? { ...row, binding: change.binding } : row)))
      revision += 1
      const snapshot = { status: 'ready', revision: `revision-${revision}` }
      config.set(snapshot)
      return Promise.resolve({ status: 'saved', snapshot })
    },
  }
}

/** 捕获异步落在微任务里的 console.warn。 */
async function captureAsyncWarnings(run) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  try {
    await run()
  } finally {
    console.warn = original
  }
  return warnings
}

console.log('--- R① 仍绑定时清成未绑定，目录随之变空 ---')
{
  const shortcuts = fakeService()
  checkTrue('开始时有绑定', leftSidebarShortcutBound(shortcuts))
  const stop = removeLeftSidebarShortcut(shortcuts, () => {})
  await settle()
  check('写入一次', shortcuts.edits.length, 1)
  check('写的是显式未绑定', shortcuts.edits[0].change, { type: 'set', id: LEFT_SIDEBAR_TOGGLE_ID, binding: null })
  check('目录已无绑定', leftSidebarShortcutBound(shortcuts), false)
  check('没有重复写入', shortcuts.edits.length, 1)
  stop()
}

console.log('--- R② 已未绑定：不写偏好 ---')
{
  const shortcuts = fakeService({ bound: false })
  const stop = removeLeftSidebarShortcut(shortcuts, () => {})
  await settle()
  check('没有 edit 调用', shortcuts.edits.length, 0)
  stop()
}

console.log('--- R③ 配置加载中先等，就绪后再写 ---')
{
  const shortcuts = fakeService({ status: 'loading' })
  const stop = removeLeftSidebarShortcut(shortcuts, () => {})
  await settle()
  check('加载中不写', shortcuts.edits.length, 0)
  shortcuts.config.set({ status: 'ready', revision: 'revision-0' })
  await settle()
  check('就绪后写一次', shortcuts.edits.length, 1)
  stop()
}

console.log('--- R④ stale 用新 revision 重试 ---')
{
  const shortcuts = fakeService()
  const original = shortcuts.edit
  let calls = 0
  shortcuts.edit = (change, revision) => {
    if (calls === 0) {
      calls += 1
      shortcuts.edits.push({ change, expectedRevision: revision })
      return Promise.resolve({ status: 'stale', snapshot: shortcuts.config.getSnapshot() })
    }
    calls += 1
    return original(change, revision)
  }
  const stop = removeLeftSidebarShortcut(shortcuts, () => {})
  await settle()
  check('重试后保存', calls, 2)
  check('目录已无绑定', leftSidebarShortcutBound(shortcuts), false)
  stop()
}

console.log('--- R⑤ 写入失败只告警一次 ---')
{
  const shortcuts = fakeService({ editResult: { status: 'write-failed' } })
  const warnings = await captureAsyncWarnings(async () => {
    const stop = removeLeftSidebarShortcut(shortcuts)
    await settle()
    stop()
  })
  check('写入一次', shortcuts.edits.length, 1)
  checkTrue('有告警', warnings.some((line) => line.includes('左侧栏快捷键解绑失败')))
}

console.log('--- R⑥ 卸载后不再响应目录变化 ---')
{
  const shortcuts = fakeService({ bound: false })
  const stop = removeLeftSidebarShortcut(shortcuts, () => {})
  stop()
  shortcuts.catalog.set([{ id: LEFT_SIDEBAR_TOGGLE_ID, label: '展开／收起左侧栏', binding: BOUND }])
  await settle()
  check('卸载后不写', shortcuts.edits.length, 0)
}

finish()
