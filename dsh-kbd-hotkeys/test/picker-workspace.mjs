/**
 * 诊断脚本(非插件产物):工作区浮窗:⌘/Ctrl+K。列表 = `workspaces.list` 快照按「组内可见会话里最新的 updatedAt」
 * 降序取前 10,当前会话所属工作区掉出榜单时强制保留(顶掉第 10 名);
 * ↑ / ↓ 只移高亮、Enter 调 `uiWorkspace.openWorkspace(id)`;含空列表 / 服务缺席 / 确认抛错、
 * 开关语义与 ⌘/ 换速查表、`bindings` 覆盖。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/picker-workspace.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, activeRowIndex, check, isMain, loadPlugin, nodeText, pickerRows, report, same, storage, view } from './harness.mjs'

// ---- 阶段 5(浮窗):⌘/Ctrl+K → 工作区浮窗(活跃度前 10 + ↑↓ 高亮 + Enter 切换) ----
// 列表 = workspaces.list 快照,按「组内可见会话里最新的 updatedAt」降序取前 WORKSPACE_LIMIT(10) 个;
// 当前会话所属工作区掉出榜单时强制保留(顶掉第 10 名);切换 = 公开的 uiWorkspace.openWorkspace(workspaceId)。
// ↑/↓ 只移动高亮、不触发导航;Esc / 同组合键关闭;浮层 DOM 由插件自建,这里只读它自己的子树。
console.log('\n--- ⌘/Ctrl+K → 工作区浮窗(活跃度前 10 + ↑↓ 选择 + Enter 切换) ---')
{
  const combo = { key: 'k', code: 'KeyK', ctrlKey: true }
  const wsNow = Date.now()
  const item = (workspaceId, title, path, sessionIds = []) => ({
    workspaceId, title, path, sessionIds,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  })
  /** 会话摘要:活跃度只看 updatedAt(越大越活跃)。 */
  const summary = (id, updatedAt, extra = {}) => ({ id, running: false, blank: false, updatedAt, ...extra })
  const wsSnapshot = {
    ids: ['sess-a', 'sess-b', 'sess-e'],
    byId: {
      'sess-a': summary('sess-a', wsNow - 1000),
      'sess-b': summary('sess-b', wsNow - 2000),
      'sess-e': summary('sess-e', wsNow),
    },
    projectionsBySession: {},
  }
  /** sessions 桩:默认用 wsSnapshot,可换成自定义目录。 */
  const makeSessions = (snapshot = wsSnapshot) => ({ list: { getSnapshot: () => snapshot }, binding: () => undefined })

  // 宿主顺序 = w1 w2 w3 w4 w5;活跃度顺序 = w5 w1 w2(w3 / w4 无可见会话 → 沉底且保持宿主顺序)
  const items = [
    item('w1', 'alpha', '/work/alpha', ['sess-a']),
    item('w2', 'beta', '/work/beta', ['sess-b']),
    item('w3', '', '/work/gamma'), // 无 title → 回退路径末段
    item('w4', '', 'plain'), // 末段 = 原路径 → 次行省略
    item('w5', 'epsilon', '/work/epsilon', ['sess-e']),
  ]
  const workspaces = { list: { getSnapshot: () => ({ items, archivedSessionIds: [], phase: 'ready' }) } }

  /** 假 uiWorkspace:记录 openWorkspace 调用;可配置同步抛错 / 异步拒绝。 */
  function makeUiWorkspace(mode = 'ok') {
    const calls = []
    return {
      calls,
      openWorkspace(workspaceId) {
        calls.push(workspaceId)
        if (mode === 'throw') throw new Error('uiWorkspace: no mounted session surface')
        if (mode === 'reject') return Promise.reject(new Error('uiWorkspace: connect failed'))
        return Promise.resolve()
      },
    }
  }
  /** 装配:默认「服务齐全、当前会话 sess-b(属于 w2,活跃度第 3)」。 */
  function env(over = {}) {
    const uiWorkspace = over.uiWorkspace !== undefined ? over.uiWorkspace : makeUiWorkspace(over.mode)
    // 显式传 { workspaces: undefined } 表示「服务缺席」,不能用 `=== undefined` 兜底
    const workspacesService = 'workspaces' in over ? over.workspaces : workspaces
    const press = loadPlugin({
      sessions: over.sessions ?? makeSessions(over.snapshot),
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
      workspaces: workspacesService,
      uiWorkspace,
      ...over.extra,
    })
    return { press, uiWorkspace }
  }

  // ① 打开浮窗:按活跃度降序渲染(宿主顺序 ≠ 活跃度顺序),初始高亮 = 当前会话所属工作区(w2 第 3 行)
  const first = env()
  let event = first.press(combo)
  check('⌘/Ctrl+K 打开工作区浮窗并吞键', event.propagationStopped === true)
  check(
    '浮窗按活跃度降序渲染工作区行(标题 / 路径 / 当前标记 / 会话数)',
    same(pickerRows().map(nodeText), [
      'epsilon /work/epsilon 1 个会话',
      'alpha /work/alpha 1 个会话',
      'beta /work/beta 当前 1 个会话',
      'gamma /work/gamma 0 个会话',
      'plain 0 个会话',
    ]),
    JSON.stringify(pickerRows().map(nodeText)),
  )
  check('初始高亮 = 当前会话所属工作区(第 3 行)', activeRowIndex() === 2, String(activeRowIndex()))

  // ② ↑ / ↓ 只移动高亮(不触发导航),Enter 才切换
  event = first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('↓ 移动高亮到第 4 行', activeRowIndex() === 3, String(activeRowIndex()))
  check('↓ 被浮窗吞掉', event.propagationStopped === true)
  check('↓ 不触发切换(只有 Enter 才调 openWorkspace)', same(first.uiWorkspace.calls, []), JSON.stringify(first.uiWorkspace.calls))
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('↑ 移回第 3 行', activeRowIndex() === 2, String(activeRowIndex()))
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('首行 clamp(不循环,仍停在第 1 行)', activeRowIndex() === 0, String(activeRowIndex()))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('高亮回到当前工作区行', activeRowIndex() === 2, String(activeRowIndex()))
  event = first.press({ key: 'Enter', code: 'Enter' })
  check('Enter → uiWorkspace.openWorkspace(高亮工作区)', same(first.uiWorkspace.calls, ['w2']), JSON.stringify(first.uiWorkspace.calls))
  check('Enter 被吞', event.propagationStopped === true)
  check('切换后浮窗关闭(工作区行清空)', pickerRows().length === 0, String(pickerRows().length))
  event = first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('浮窗关闭后裸 ↓ 不吞键', event.propagationStopped !== true)

  // ③ Esc 关闭 / 同组合键再按一次关闭(开关语义)/ ⌘/ 直接换成速查表
  first.press(combo)
  check('可再次打开', pickerRows().length === 5, String(pickerRows().length))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  event = first.press({ key: 'Escape', code: 'Escape' })
  check('Esc 关闭浮窗并吞键', event.propagationStopped === true && pickerRows().length === 0)
  first.press(combo)
  event = first.press(combo)
  check('再按一次 ⌘/Ctrl+K 关闭(开关语义)', pickerRows().length === 0, String(pickerRows().length))
  check('同组合键关闭被吞', event.propagationStopped === true)
  first.press(combo)
  event = first.press({ key: '/', code: 'Slash', ctrlKey: true })
  check('浮窗内按 ⌘/ 直接换成速查表(工作区行消失)', event.propagationStopped === true && pickerRows().length === 0)
  event = first.press({ key: '/', code: 'Slash', ctrlKey: true })
  check('速查表再按 ⌘/ 关闭', event.propagationStopped === true)

  // ④ 初始高亮:当前会话不属于任何工作区 → 首行;↑ 在首行 clamp
  view.current = 'sess-x'
  const stray = env()
  stray.press(combo)
  check('当前会话无归属 → 初始高亮第 1 行', activeRowIndex() === 0, String(activeRowIndex()))
  stray.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('首行再按 ↑ 仍停在第 1 行', activeRowIndex() === 0, String(activeRowIndex()))
  stray.press({ key: 'Enter', code: 'Enter' })
  check('Enter → openWorkspace(w5,活跃度最高)', same(stray.uiWorkspace.calls, ['w5']), JSON.stringify(stray.uiWorkspace.calls))
  view.current = 'sess-b'

  // ⑤ 空列表 / workspaces 服务缺席:浮窗照样打开(空态),Enter 不切换、不崩
  const empty = env({ workspaces: { list: { getSnapshot: () => ({ items: [], archivedSessionIds: [], phase: 'ready' }) } } })
  event = empty.press(combo)
  check('无工作区时仍打开浮窗(空态)并吞键', event.propagationStopped === true && pickerRows().length === 0)
  event = empty.press({ key: 'Enter', code: 'Enter' })
  check('空态 Enter 不触发 openWorkspace', same(empty.uiWorkspace.calls, []), JSON.stringify(empty.uiWorkspace.calls))
  check('空态 Enter 仍被模态吞掉', event.propagationStopped === true)
  empty.press({ key: 'Escape', code: 'Escape' })

  const noService = env({ workspaces: undefined })
  event = noService.press(combo)
  check('workspaces 服务缺席 → 浮窗空态、不崩、吞键', event.propagationStopped === true && pickerRows().length === 0)
  event = noService.press({ key: 'Enter', code: 'Enter' })
  check('workspaces 缺席时 Enter 不切换、不抛错', same(noService.uiWorkspace.calls, []), JSON.stringify(noService.uiWorkspace.calls))
  noService.press({ key: 'Escape', code: 'Escape' })

  // ⑥ uiWorkspace 缺席 / 抛错:浮窗照常开关,确认时 no-op(不崩、不回退 DOM)
  for (const [label, over] of [
    ['uiWorkspace 缺席', { uiWorkspace: null }],
    ['openWorkspace 同步抛错', { mode: 'throw' }],
    ['openWorkspace 异步拒绝', { mode: 'reject' }],
  ]) {
    const target = env(over)
    target.press(combo)
    target.press({ key: 'ArrowDown', code: 'ArrowDown' })
    event = target.press({ key: 'Enter', code: 'Enter' })
    check(`${label} → 确认时 no-op、不崩、浮窗关闭`, event.propagationStopped === true && pickerRows().length === 0)
    if (over.mode !== undefined) {
      check(`${label} → 仍如实调用了 openWorkspace`, target.uiWorkspace.calls.length === 1, JSON.stringify(target.uiWorkspace.calls))
    }
  }

  // ⑦ card / editing 态同样可用(带修饰键的组合不与卡片裸键、文本编辑冲突)
  const carded = env({
    extra: {
      uiSession: {
        pendingInteractions: {
          getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:9', sessionId: 'sess-b', questions: [{ id: 'q1', options: [{ label: 'A' }] }] }]]),
        },
      },
    },
  })
  event = carded.press(combo)
  check('card 态 ⌘/Ctrl+K 仍打开浮窗', event.propagationStopped === true && pickerRows().length === 5)
  carded.press({ key: 'Escape', code: 'Escape' })
  const editing = env()
  event = editing.press({ ...combo, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+K 仍打开浮窗', event.propagationStopped === true && pickerRows().length === 5)
  editing.press({ key: 'Escape', code: 'Escape' })

  // ⑧ 键位可独立覆盖(与其它动作同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'workspace.pick': 'mod+alt+9' } }))
  const custom = env()
  event = custom.press(combo)
  check('覆盖键位后 ⌘/Ctrl+K 不再打开', event.propagationStopped !== true && pickerRows().length === 0)
  event = custom.press({ key: '9', code: 'Digit9', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+9 打开浮窗并吞键', event.propagationStopped === true && pickerRows().length === 5)
  custom.press({ key: 'Enter', code: 'Enter' })
  check('自定义键位下 Enter 切换当前高亮工作区(w2)', same(custom.uiWorkspace.calls, ['w2']), JSON.stringify(custom.uiWorkspace.calls))
  storage.delete('dsh-kbd-hotkeys:v1')

  // ⑨ 活跃度裁剪:超过 10 个只列最近活跃的 10 个;当前工作区掉出榜单时顶掉第 10 名
  const manyItems = []
  const manyById = {}
  const manyIds = []
  for (let i = 1; i <= 12; i += 1) {
    const sid = 'm' + i
    manyItems.push(item('mw' + i, 'ws' + i, '/work/ws' + i, [sid]))
    manyById[sid] = summary(sid, wsNow + i) // i 越大越活跃 → 活跃度顺序 mw12 … mw1
    manyIds.push(sid)
  }
  const manySessions = makeSessions({ ids: manyIds, byId: manyById, projectionsBySession: {} })
  const manyWorkspaces = { list: { getSnapshot: () => ({ items: manyItems, archivedSessionIds: [], phase: 'ready' }) } }

  // 当前会话 m2(工作区 mw2,活跃度第 11)→ 强制保留,顶掉第 10 名 mw3
  view.current = 'm2'
  const capped = env({ workspaces: manyWorkspaces, sessions: manySessions })
  capped.press(combo)
  check('12 个工作区只列 10 行', pickerRows().length === 10, String(pickerRows().length))
  check('首行 = 活跃度最高的 mw12', nodeText(pickerRows()[0]) === 'ws12 /work/ws12 1 个会话', nodeText(pickerRows()[0]))
  check(
    '当前工作区 mw2 顶掉第 10 名(第 10 行带当前标记)',
    nodeText(pickerRows()[9]) === 'ws2 /work/ws2 当前 1 个会话',
    nodeText(pickerRows()[9]),
  )
  check(
    '被顶掉的 mw3 与更低排名的 mw1 都不出现',
    pickerRows().every((row) => !nodeText(row).startsWith('ws3 ') && !nodeText(row).startsWith('ws1 ')),
    JSON.stringify(pickerRows().map(nodeText)),
  )
  check('初始高亮 = 被强制保留的当前工作区(第 10 行)', activeRowIndex() === 9, String(activeRowIndex()))
  capped.press({ key: 'Escape', code: 'Escape' })

  // 当前工作区已在榜内 → 不顶替,严格按活跃度取前 10(mw12 … mw3)
  view.current = 'm12'
  const onList = env({ workspaces: manyWorkspaces, sessions: manySessions })
  onList.press(combo)
  check(
    '当前工作区已在榜内 → 严格前 10(首行 mw12、第 10 行 mw3)',
    pickerRows().length === 10 && nodeText(pickerRows()[0]) === 'ws12 /work/ws12 当前 1 个会话' && nodeText(pickerRows()[9]) === 'ws3 /work/ws3 1 个会话',
    JSON.stringify(pickerRows().map(nodeText)),
  )
  onList.press({ key: 'Escape', code: 'Escape' })

  // 恰好 10 个 → 全部列出(不裁剪)
  view.current = 'sess-b'
  const exactly = env({
    workspaces: { list: { getSnapshot: () => ({ items: manyItems.slice(0, 10), archivedSessionIds: [], phase: 'ready' }) } },
    sessions: manySessions,
  })
  exactly.press(combo)
  check('恰好 10 个工作区 → 全部列出', pickerRows().length === 10, String(pickerRows().length))
  exactly.press({ key: 'Escape', code: 'Escape' })

  // 活跃度只看可见会话:归档 / 子代理 / 空白会话不贡献活跃度(real 是唯一有活跃度的工作区)
  const hiddenSnapshot = {
    ids: ['arch', 'sub', 'blank', 'sess-a'],
    byId: {
      arch: summary('arch', wsNow + 100),
      sub: summary('sub', wsNow + 200, { origin: 'subagent' }),
      blank: summary('blank', wsNow + 300, { blank: true }),
      'sess-a': summary('sess-a', wsNow - 5000),
    },
    projectionsBySession: {},
  }
  const hiddenItems = [
    item('h1', 'archivedOnly', '/work/h1', ['arch']),
    item('h2', 'subagentOnly', '/work/h2', ['sub']),
    item('h3', 'blankOnly', '/work/h3', ['blank']),
    item('h4', 'real', '/work/h4', ['sess-a']),
  ]
  const hidden = env({
    workspaces: { list: { getSnapshot: () => ({ items: hiddenItems, archivedSessionIds: ['arch'], phase: 'ready' }) } },
    sessions: makeSessions(hiddenSnapshot),
  })
  hidden.press(combo)
  check(
    '归档 / 子代理 / 空白会话不算活跃(real 首行,其余按宿主顺序沉底)',
    same(pickerRows().map((row) => nodeText(row).split(' ')[0]), ['real', 'archivedOnly', 'subagentOnly', 'blankOnly']),
    JSON.stringify(pickerRows().map(nodeText)),
  )
  hidden.press({ key: 'Escape', code: 'Escape' })
  view.current = 'sess-b'
}

if (isMain(import.meta.url)) report()
