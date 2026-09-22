/**
 * 诊断脚本(非插件产物):近期对话浮窗:⌘/Ctrl+I。列表 = `sessions.list` + `workspaces.list` 快照派生(组序 = 宿主顺序、
 * 组内最近更新在前,空白 / 归档 / 子代理不列出),↑ / ↓ 跨组移高亮、Enter 调
 * `uiWorkspace.openSession(id)`;含全局 10 条上限与当前会话强制纳入、面板底色 / `--recent`
 * 修饰类等样式回归、当前会话不可见时的落点规则、空态 / 服务缺席与 `bindings` 覆盖。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/picker-recent.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, check, classHas, collectNodes, isMain, loadPlugin, nodeText, pickerRows, report, same, storage, view } from './harness.mjs'

// ---- 阶段 7(浮窗):⌘/Ctrl+I → 近期对话浮窗(按工作区分组 + ↑↓ 跨组选择 + Enter 打开) ----
// 列表 = sessions.list + workspaces.list 快照,由 recent-sessions.ts 派生:组序 = 宿主顺序、组内 = 最近更新在前、
// 空白 / 归档 / 子代理不列出、无归属落末尾空标题组;↑↓ 只移高亮(不打开会话),Enter / 点击行才打开(见 ③′)。
console.log('\n--- ⌘/Ctrl+I → 近期对话浮窗(按工作区分组 + ↑↓ 选择 + Enter 打开) ---')
{
  const combo = { key: 'i', code: 'KeyI', ctrlKey: true }
  const T = 1_700_000_000_000
  /** 会话摘要工厂(与上游 client SessionSummary 同形的最小子集)。 */
  const summary = (id, updatedAt, over = {}) => ({
    id, displayTitle: `会话 ${id}`, title: `会话 ${id}`,
    cwd: `/work/${id}`, running: false, blank: false, updatedAt, ...over,
  })
  /** 夹具:两个工作区 + 无归属 + 空白 + 归档 + 子代理,覆盖全部派生规则。 */
  const sessionIds = ['a1', 'a2', 'b1', 'stray', 'blank', 'arch', 'sub']
  const byId = {
    a1: summary('a1', T - 1000),
    a2: summary('a2', T, { running: true }),
    b1: summary('b1', T - 500),
    stray: summary('stray', T - 200),
    blank: summary('blank', T + 500, { blank: true }),
    arch: summary('arch', T + 900),
    sub: summary('sub', T + 1000, { origin: 'subagent' }),
  }
  // 当前会话与「完成未读」都来自 uiSession(alpha.2);sessions.list 快照里已无 current / completed。
  view.current = 'b1'
  view.completionUnread = new Set(['b1'])
  const listSnapshot = () => ({ ids: sessionIds, byId, projectionsBySession: {} })
  const workspaceItems = [
    {
      workspaceId: 'w1', title: 'alpha', path: '/work/alpha', sessionIds: ['a1', 'a2', 'blank', 'arch'],
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      workspaceId: 'w2', title: 'beta', path: '/work/beta', sessionIds: ['b1', 'sub'],
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ]

  /** 装配:默认「两个工作区就绪、当前会话 = b1」;over.sessions 只替换列表快照,over.service 替换整个服务(undefined = 缺席)。
   * 打开只经 uiWorkspace.openSession(alpha.2 起 sessions.open 已删除),录制用的 openSession 刻意写成读 this 的方法
   * (真机是原型方法,摘下来丢 this 抛 TypeError,这正是「Enter 不跳转」的回归点)。 */
  function env(over = {}) {
    const opened = []
    const listOf = () => ('sessions' in over ? over.sessions.list.getSnapshot() : listSnapshot())
    const base = { list: { getSnapshot: listOf }, binding: () => undefined }
    const recorder = {
      openSession(id) {
        if (this === undefined || this === null) throw new Error('uiWorkspace.openSession lost its receiver')
        opened.push(id)
      },
    }
    const workspacesService = 'workspaces' in over
      ? over.workspaces
      : { list: { getSnapshot: () => ({ items: workspaceItems, archivedSessionIds: ['arch'], phase: 'ready' }) } }
    const extra = over.extra ?? {}
    const press = loadPlugin({
      sessions: 'service' in over ? over.service : base,
      uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
      workspaces: workspacesService,
      uiWorkspace: 'uiWorkspace' in extra ? extra.uiWorkspace : recorder,
      ...extra,
    })
    return { press, opened }
  }

  // 近期对话行 / 分组标题:与工作区、模型浮窗的行类名不同,故互不干扰
  const sessionRows = () => collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-groupRow'))
  const groupHeadings = () => collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-group'))
  const activeSessionIndex = () => sessionRows().findIndex((el) => classHas(el, 'isActive'))
  /** 近期对话浮窗的 DOM 渲染快照(组标题 + 行的组合,按 DOM 顺序)。 */
  function rendered() {
    const out = []
    for (const child of (collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-list'))[0]?.children ?? [])) {
      if (classHas(child, 'dsh-kbd-group')) out.push(`[${nodeText(child)}]`)
      else if (classHas(child, 'dsh-kbd-groupRow')) out.push(nodeText(child))
    }
    return out
  }

  // ① 打开浮窗:按工作区分组渲染,组内最近更新在前,blank / 归档 / 子代理不列出
  const first = env()
  let event = first.press(combo)
  check('⌘/Ctrl+I 打开近期对话浮窗并吞键', event.propagationStopped === true)
  check(
    '按工作区分组渲染(组序 = 宿主顺序;组内 = 最近更新在前;末尾无归属组无标题)',
    same(rendered(), [
      '[alpha]',
      '会话 a2 /work/a2 运行中',
      '会话 a1 /work/a1',
      '[beta]',
      '会话 b1 /work/b1 完成 当前',
      '会话 stray /work/stray',
    ]),
    JSON.stringify(rendered()),
  )
  check('近期对话行不占用工作区 / 模型浮窗的行类名', pickerRows().length === 0, String(pickerRows().length))
  check('空白会话不列出', sessionRows().every((el) => !nodeText(el).includes('blank')) === true)
  check('子代理会话不列出', sessionRows().every((el) => !nodeText(el).includes('sub')) === true)
  check('归档会话不列出', sessionRows().every((el) => !nodeText(el).includes('arch')) === true)
  check('初始高亮 = 当前会话所在行(第 3 行)', activeSessionIndex() === 2, String(activeSessionIndex()))

  // ② ↑ / ↓ 跨组连续移动高亮且**不打开会话**;首尾 clamp(不循环)
  event = first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('↓ 移入下一个工作区分组(跨组)', activeSessionIndex() === 3, String(activeSessionIndex()))
  check('↓ 被浮窗吞掉', event.propagationStopped === true)
  check('↑/↓ 不打开会话(只有 Enter 才打开)', same(first.opened, []), JSON.stringify(first.opened))
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('首行 clamp(不循环,仍停在第 1 行)', activeSessionIndex() === 0, String(activeSessionIndex()))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('末行 clamp(不循环,仍停在第 4 行)', activeSessionIndex() === 3, String(activeSessionIndex()))

  // ③ Enter → uiWorkspace.openSession(高亮会话)并关闭浮窗
  event = first.press({ key: 'Enter', code: 'Enter' })
  check('Enter → openSession(stray)', same(first.opened, ['stray']), JSON.stringify(first.opened))
  check('Enter 被吞', event.propagationStopped === true)
  check('打开后浮窗关闭(会话行清空)', sessionRows().length === 0, String(sessionRows().length))
  event = first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('浮窗关闭后裸 ↓ 不吞键', event.propagationStopped !== true)

  // ③′ 确认路径只走 uiWorkspace.openSession(alpha.2 起 sessions.open 已删除,无回退);
  //     刻意用读 this 的类方法形态(摘下来丢 this 抛错,正是「Enter 不跳转」的回归点)。
  const wsOpened = []
  const viaWorkspace = env({
    extra: {
      uiWorkspace: {
        openSession(id) {
          if (this === undefined || this === null) throw new Error('uiWorkspace.openSession lost its receiver')
          wsOpened.push(id)
        },
      },
    },
  })
  viaWorkspace.press(combo)
  viaWorkspace.press({ key: 'Enter', code: 'Enter' })
  check('Enter → uiWorkspace.openSession(b1)', same(wsOpened, ['b1']), JSON.stringify(wsOpened))

  const wsNoMethod = env({ extra: { uiWorkspace: {} } })
  wsNoMethod.press(combo)
  event = wsNoMethod.press({ key: 'Enter', code: 'Enter' })
  check('无 openSession → 确认时 no-op、不崩、浮窗关闭', event.propagationStopped === true && sessionRows().length === 0)

  const wsThrowing = env({ extra: { uiWorkspace: { openSession: () => { throw new Error('no mounted session surface') } } } })
  wsThrowing.press(combo)
  event = wsThrowing.press({ key: 'Enter', code: 'Enter' })
  check('openSession 抛错 → 确认时 no-op、不崩、浮窗关闭', event.propagationStopped === true && sessionRows().length === 0)

  // ④ Esc 关闭 / 再按 ⌘/Ctrl+I 关闭(开关语义)/ ⌘/ 换成速查表
  first.press(combo)
  check('可再次打开', sessionRows().length === 4, String(sessionRows().length))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  event = first.press({ key: 'Escape', code: 'Escape' })
  check('Esc 关闭浮窗并吞键', event.propagationStopped === true && sessionRows().length === 0)
  first.press(combo)
  event = first.press(combo)
  check('再按一次 ⌘/Ctrl+I 关闭(开关语义)', sessionRows().length === 0, String(sessionRows().length))
  check('同组合键关闭被吞', event.propagationStopped === true)
  first.press(combo)
  event = first.press({ key: '/', code: 'Slash', ctrlKey: true })
  check('浮窗内按 ⌘/ 直接换成速查表(会话行消失)', event.propagationStopped === true && sessionRows().length === 0)
  event = first.press({ key: '/', code: 'Slash', ctrlKey: true })
  check('速查表再按 ⌘/ 关闭', event.propagationStopped === true)

  // ⑤ 当前会话不在列表里(空白会话 / 无 current)→ 初始高亮 = 同工作区第一行;无归属 / 无 current 退回首行
  view.current = 'blank'
  const blankCurrent = env()
  blankCurrent.press(combo)
  check('当前是空白会话(不列出,同工作区组在榜首)→ 初始高亮第 1 行', activeSessionIndex() === 0, String(activeSessionIndex()))
  blankCurrent.press({ key: 'Enter', code: 'Enter' })
  check('Enter → openSession(a2)', same(blankCurrent.opened, ['a2']), JSON.stringify(blankCurrent.opened))

  // ⑤′ 空白当前会话的工作区不在榜首 → 落**同工作区**的第一行(不再固定落全局首行)
  view.current = 'blankB'
  const blankInBeta = env({
    sessions: {
      list: {
        getSnapshot: () => ({
          ids: [...sessionIds, 'blankB'],
          byId: { ...byId, blankB: summary('blankB', T + 800, { blank: true }) },
          projectionsBySession: {},
        }),
      },
      binding: () => undefined,
    },
    workspaces: {
      list: {
        getSnapshot: () => ({
          items: [workspaceItems[0], { ...workspaceItems[1], sessionIds: ['b1', 'blankB', 'sub'] }],
          archivedSessionIds: ['arch'],
          phase: 'ready',
        }),
      },
    },
  })
  blankInBeta.press(combo)
  check(
    '空白当前会话(beta 组在第 2 组)→ 初始高亮 = 同工作区第一行(b1,第 3 行)',
    activeSessionIndex() === 2,
    String(activeSessionIndex()),
  )
  blankInBeta.press({ key: 'Enter', code: 'Enter' })
  check('Enter → openSession(b1)', same(blankInBeta.opened, ['b1']), JSON.stringify(blankInBeta.opened))

  // ⑤″ 空白当前会话不属于任何工作区 → 落无归属组第一行(与上游 owningGroupKey 同判据)
  view.current = 'blankU'
  const blankUngrouped = env({
    sessions: {
      list: {
        getSnapshot: () => ({
          ids: [...sessionIds, 'blankU'],
          byId: { ...byId, blankU: summary('blankU', T + 700, { blank: true }) },
          projectionsBySession: {},
        }),
      },
      binding: () => undefined,
    },
  })
  blankUngrouped.press(combo)
  check(
    '空白当前会话无工作区归属 → 初始高亮 = 无归属组第一行(stray,第 4 行)',
    activeSessionIndex() === 3,
    String(activeSessionIndex()),
  )
  blankUngrouped.press({ key: 'Escape', code: 'Escape' })

  // ⑤‴ 空白当前会话的工作区整组未上榜(组内没有可见会话)→ 退回首行
  view.current = 'blankC'
  const blankTrimmed = env({
    sessions: {
      list: {
        getSnapshot: () => ({
          ids: [...sessionIds, 'blankC'],
          byId: { ...byId, blankC: summary('blankC', T + 600, { blank: true }) },
          projectionsBySession: {},
        }),
      },
      binding: () => undefined,
    },
    workspaces: {
      list: {
        getSnapshot: () => ({
          items: [
            { workspaceId: 'w3', title: 'gamma', path: '/work/gamma', sessionIds: ['blankC'] },
            workspaceItems[0],
            workspaceItems[1],
          ],
          archivedSessionIds: ['arch'],
          phase: 'ready',
        }),
      },
    },
  })
  blankTrimmed.press(combo)
  check('空白当前会话的工作区整组未上榜 → 退回首行', activeSessionIndex() === 0, String(activeSessionIndex()))
  blankTrimmed.press({ key: 'Escape', code: 'Escape' })

  view.current = undefined
  const noCurrent = env()
  noCurrent.press(combo)
  check('无 current → 初始高亮首行', activeSessionIndex() === 0, String(activeSessionIndex()))
  noCurrent.press({ key: 'Escape', code: 'Escape' })
  view.current = 'b1'

  // ⑥ sessions 服务缺席 / 快照缺 ids / 无 openSession:空态或 no-op,一律不崩
  const empty = env({
    sessions: { list: { getSnapshot: () => ({ ids: [], byId: {}, projectionsBySession: {} }) }, binding: () => undefined },
  })
  event = empty.press(combo)
  check('无可用会话 → 浮窗打开为空态并吞键', event.propagationStopped === true && sessionRows().length === 0)
  check('空态给出提示文本', nodeText(globalThis.document.body).includes('当前没有可打开的对话'))
  event = empty.press({ key: 'Enter', code: 'Enter' })
  check('空态 Enter 不打开会话', same(empty.opened, []), JSON.stringify(empty.opened))
  check('空态 Enter 仍被模态吞掉', event.propagationStopped === true)
  empty.press({ key: 'Escape', code: 'Escape' })

  const noSessions = env({ service: undefined })
  event = noSessions.press(combo)
  check('sessions 服务缺席 → 浮窗空态、不崩、吞键', event.propagationStopped === true && sessionRows().length === 0)
  noSessions.press({ key: 'Escape', code: 'Escape' })

  const noIds = env({ sessions: { list: { getSnapshot: () => ({ byId }) } } })
  event = noIds.press(combo)
  check('快照缺 ids → 浮窗空态、不崩', event.propagationStopped === true && sessionRows().length === 0)
  noIds.press({ key: 'Escape', code: 'Escape' })

  // sessions 只有 list 的壳:浮窗照常渲染,确认仍走 uiWorkspace.openSession
  const listOnly = env({ service: { list: { getSnapshot: listSnapshot } } })
  event = listOnly.press(combo)
  check('sessions 只有 list → 浮窗照开', event.propagationStopped === true && sessionRows().length === 4)
  event = listOnly.press({ key: 'Enter', code: 'Enter' })
  check('sessions 只有 list → Enter 仍打开会话', same(listOnly.opened, ['b1']), JSON.stringify(listOnly.opened))

  // 确认抛错:no-op、不崩、浮窗照关
  const throwing = env({ extra: { uiWorkspace: { openSession: () => { throw new Error('unknown id') } } } })
  throwing.press(combo)
  event = throwing.press({ key: 'Enter', code: 'Enter' })
  check('openSession 抛错 → 确认时 no-op、不崩、浮窗关闭', event.propagationStopped === true && sessionRows().length === 0)

  // ⑦ workspaces 服务缺席 / 快照缺 items → 全部会话落入无归属组(仍可用,不假装没有会话)
  const flat = env({
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: ['arch'], phase: 'ready' }) } },
  })
  flat.press(combo)
  check('workspaces 无 items → 全部会话落在无标题组、按最近更新排序', same(rendered(), [
    '会话 a2 /work/a2 运行中',
    '会话 stray /work/stray',
    '会话 b1 /work/b1 完成 当前',
    '会话 a1 /work/a1',
  ]), JSON.stringify(rendered()))
  check('无归属组不渲染组标题', groupHeadings().length === 0, String(groupHeadings().length))
  check('无归属组仍排除归档 / 子代理 / 空白会话', sessionRows().length === 4, String(sessionRows().length))
  flat.press({ key: 'ArrowUp', code: 'ArrowUp' })
  flat.press({ key: 'ArrowUp', code: 'ArrowUp' })
  flat.press({ key: 'ArrowUp', code: 'ArrowUp' })
  flat.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('无归属组内首行 clamp', activeSessionIndex() === 0, String(activeSessionIndex()))
  flat.press({ key: 'Enter', code: 'Enter' })
  check('无归属组 Enter 仍打开会话', same(flat.opened, ['a2']), JSON.stringify(flat.opened))

  const noService = env({ workspaces: undefined })
  event = noService.press(combo)
  check('workspaces 服务缺席 → 同样退化为无归属组(不崩、不吞失败)', event.propagationStopped === true && sessionRows().length === 5)
  noService.press({ key: 'Escape', code: 'Escape' })

  // ⑦′ 全局条数上限:只列最近更新的 10 个(全局口径,不是每组 10 个);当前会话不在前 10 名时强制纳入并顶掉第 10 名。
  {
    const capIds = Array.from({ length: 13 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`)
    const capById = {}
    capIds.forEach((id, i) => { capById[id] = summary(id, T + i) })
    // 空白会话 updatedAt 最高:它不可见,不得占用 10 个名额
    capById.blankTop = summary('blankTop', T + 99, { blank: true })
    const capWorkspaces = [
      {
        workspaceId: 'w1', title: 'one', path: '/work/one', sessionIds: capIds.slice(0, 5),
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        workspaceId: 'w2', title: 'two', path: '/work/two', sessionIds: [...capIds.slice(5), 'blankTop'],
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]
    const capEnv = (current) => {
      view.current = current
      return env({
        sessions: { list: { getSnapshot: () => ({ ids: [...capIds, 'blankTop'], byId: capById, projectionsBySession: {} }) } },
        workspaces: { list: { getSnapshot: () => ({ items: capWorkspaces, archivedSessionIds: [], phase: 'ready' }) } },
      })
    }

    const capped = capEnv('c13')
    capped.press(combo)
    // 浮窗高度:面板带 --recent 修饰类,max-height 由 64vh 抬到 calc(88vh - 24px) 以容 10 行 + 组标题 + 页眉页脚;
    const panels = () => collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-panel'))
    const sheetText = () => (globalThis.document.head.children ?? [])
      .map((el) => (typeof el.textContent === 'string' ? el.textContent : '')).join('\n')
    const baseRule = /\.dsh-kbd-panel\{[^}]*?max-height:([^;}]+)/.exec(sheetText())
    const recentRule = /\.dsh-kbd-panel--recent\{max-height:([^}]+)\}/.exec(sheetText())
    check(
      '近期对话浮窗面板带 --recent 修饰类',
      panels().length === 1 && classHas(panels()[0], 'dsh-kbd-panel--recent'),
      JSON.stringify(panels().map((el) => el.className)),
    )
    check(
      '高度上限从 64vh 抬到 calc(88vh - 24px)',
      baseRule?.[1] === '64vh' && recentRule?.[1] === 'calc(88vh - 24px)',
      `${String(baseRule?.[1])} / ${String(recentRule?.[1])}`,
    )
    // 面板不透明:`--dsw-specific-menu` 本体带 alpha(约 50–58%,官方配 backdrop-filter 磨砂),
    // 直接铺会透出背后的遮罩;必须铺在不透明底 token 上(background-color + 同色 gradient 叠加)。
    const panelRule = /\.dsh-kbd-panel\{([^}]*)\}/.exec(sheetText())
    const panelCss = panelRule?.[1] ?? ''
    check(
      '面板底色不透明:菜单 token 叠加在不透明底上,而非直接铺半透明色',
      /background-color:var\(--dsw-alias-bg-base/.test(panelCss) &&
        /background-image:linear-gradient\(var\(--dsw-specific-menu/.test(panelCss) &&
        !/(?:^|;)background:var\(--dsw-specific-menu/.test(panelCss),
      panelCss.slice(0, 200),
    )
    check('全局上限:13 个可见会话只渲染 10 行', sessionRows().length === 10, String(sessionRows().length))
    check(
      '上限 = 全局最近更新前 10(c01–c03 被裁掉),组序 / 组内序不变',
      same(rendered(), [
        '[one]',
        '会话 c05 /work/c05',
        '会话 c04 /work/c04',
        '[two]',
        '会话 c13 /work/c13 当前',
        '会话 c12 /work/c12',
        '会话 c11 /work/c11',
        '会话 c10 /work/c10',
        '会话 c09 /work/c09',
        '会话 c08 /work/c08',
        '会话 c07 /work/c07',
        '会话 c06 /work/c06',
      ]),
      JSON.stringify(rendered()),
    )
    check(
      '空白会话不占名额(updatedAt 最高也不进列表)',
      sessionRows().every((el) => !nodeText(el).includes('blankTop')) === true,
    )
    check('初始光标 = 当前会话 c13(组内第 3 行)', activeSessionIndex() === 2, String(activeSessionIndex()))
    capped.press({ key: 'Escape', code: 'Escape' })

    // 修饰类只属于近期对话浮窗:工作区浮窗的高度上限仍是基线 64vh
    capped.press({ key: 'k', code: 'KeyK', ctrlKey: true })
    check(
      '工作区浮窗不带 --recent(上限仍为 64vh)',
      panels().length === 1 && !classHas(panels()[0], 'dsh-kbd-panel--recent'),
      JSON.stringify(panels().map((el) => el.className)),
    )
    capped.press({ key: 'Escape', code: 'Escape' })

    const forced = capEnv('c01')
    forced.press(combo)
    check('当前会话不在前 10 名 → 强制纳入,行数仍为 10', sessionRows().length === 10, String(sessionRows().length))
    check('被顶掉的是原第 10 名 c04', sessionRows().every((el) => !nodeText(el).includes('会话 c04')) === true, JSON.stringify(rendered()))
    check('初始光标 = 被强制纳入的当前会话 c01(组内第 2 行)', activeSessionIndex() === 1, String(activeSessionIndex()))
    check(
      '强制纳入后组序 / 组内序仍按最近更新',
      same(rendered(), [
        '[one]',
        '会话 c05 /work/c05',
        '会话 c01 /work/c01 当前',
        '[two]',
        '会话 c13 /work/c13',
        '会话 c12 /work/c12',
        '会话 c11 /work/c11',
        '会话 c10 /work/c10',
        '会话 c09 /work/c09',
        '会话 c08 /work/c08',
        '会话 c07 /work/c07',
        '会话 c06 /work/c06',
      ]),
      JSON.stringify(rendered()),
    )
    forced.press({ key: 'Enter', code: 'Enter' })
    check('强制纳入的当前会话可被 Enter 打开', same(forced.opened, ['c01']), JSON.stringify(forced.opened))
  }
  view.current = 'b1'

  // ⑧ card / editing 态同样可用(带修饰键的组合不与卡片裸键、文本编辑冲突)
  const carded = env({
    extra: {
      uiSession: {
        pendingInteractions: {
          getSnapshot: () => new Map([['b1', { kind: 'question', key: 'question:9', sessionId: 'b1', questions: [{ id: 'q1', options: [{ label: 'A' }] }] }]]),
        },
      },
    },
  })
  event = carded.press(combo)
  check('card 态 ⌘/Ctrl+I 仍打开浮窗', event.propagationStopped === true && sessionRows().length === 4)
  carded.press({ key: 'Escape', code: 'Escape' })
  const editing = env()
  event = editing.press({ ...combo, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+I 仍打开浮窗', event.propagationStopped === true && sessionRows().length === 4)
  editing.press({ key: 'Escape', code: 'Escape' })

  // ⑨ 键位可独立覆盖(与其它动作同一套 bindings 机制)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'session.recent': 'mod+alt+7' } }))
  const custom = env()
  event = custom.press(combo)
  check('覆盖键位后 ⌘/Ctrl+I 不再打开', event.propagationStopped !== true && sessionRows().length === 0)
  event = custom.press({ key: '7', code: 'Digit7', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+7 打开浮窗并吞键', event.propagationStopped === true && sessionRows().length === 4)
  event = custom.press({ key: 'Enter', code: 'Enter' })
  check('自定义键位下 Enter 打开高亮会话', same(custom.opened, ['b1']), JSON.stringify(custom.opened))
  storage.delete('dsh-kbd-hotkeys:v1')
  view.current = 'sess-b'
  view.completionUnread = new Set()
}

if (isMain(import.meta.url)) report()
