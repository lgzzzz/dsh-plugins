/**
 * 挂载两条 fixed 行(group `application`)，把左侧栏的会话导航拆成两档：
 *
 *   - `dsh-focus-free-shortcuts.session-cycle`(`⌘↑` / `⌘↓`；Windows/Linux `Ctrl+↑` / `Ctrl+↓`)：
 *     在**前三个工作区当前显示出来的全部会话行**之间环状步进，也就是「在会话之间导航」本身；
 *   - `dsh-focus-free-shortcuts.session-active-cycle`(`⌘⌥↑` / `⌘⌥↓`；Windows/Linux
 *     `Ctrl+Alt+↑` / `Ctrl+Alt+↓`)：只在**活跃会话之间**步进。
 *
 * 两条行声明的都是逻辑组合(`primary` / `primary+alt`)。注册表在 macOS 上把 `primary`
 * 展开成 `meta`(⌘)，在 Windows/Linux 上展开成 `control`(Ctrl)。
 *
 * 候选只取左侧栏此刻真的画出来的会话行：前三个工作区分组内、未被折叠、未被每分组 5 行上限
 * 挡在「展开更多」之后、也未被归档过滤隐藏的行，顺序即侧栏显示顺序(实现见 `displayedSidebar` /
 * `displayedSessionIds`)。行由 Workspace browser 发布的 `[data-row-key]` 标记识别，所以候选与
 * 「点击某一行」是同一批对象；`uiWorkspace.openSession(id)` 就是那一击。候选口径的边界见
 * docs/dsh-focus-free-shortcuts/06-boundaries-and-contracts.md。
 *
 * 活跃 = 行上有状态点的会话：待答交互(审批 / 计划 / 提问)、正在运行、或「已完成未读」的那
 * 一颗绿点。三项状态事实的读数与退回规则见 `sessionActive`。活跃池里没有活跃会话、或只剩
 * 当前会话时，第二条行不动作、也不消费，常规导航交给第一条行。
 *
 * 落在 `.xterm` 内的按键不会到达 window 上的 fixed-input 监听(终端在自己的 textarea
 * 处理器里 `stopPropagation()`)，因此与页面循环桥一样另装捕获阶段的 window `keydown`。
 * 两条路径共用同一个判定函数(`sessionCyclePlan`)，一次按键只被处理一次。
 *
 * 切换动词 `uiWorkspace.openSession` 所在的服务声明为注入依赖。该服务来自 Workspace browser
 * 的客户端包，激活可能晚于本插件；直接 `ctx.get` 一次会把「还没激活」误判成「缺席」，整条桥
 * 就不再安装。
 */
import { captureContext, captureGesture, composedElement, terminalTarget } from './capture.ts'
import { bindingKeycaps, bindingMatches } from './binding.ts'
import { isKeydown, mainViewSessionId, name, warn, type KeydownInput, type SessionId } from './runtime.ts'
import type {
  ShortcutContext,
  ShortcutFixedCatalogEntry,
  ShortcutFixedCommand,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ShortcutCommandId, ShortcutPlatform} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type {ISessions, SessionListState} from '@deepseek-ai/dsh-api-session-controller/client'
// 空导入：让 TS 加载本包对 `@deepseek-ai/cordis` 的模块增强(`ctx.uiSession`)与
// `SessionPendingInteractionMap` 的域声明;type-only 导入在打包前被擦除。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {SessionStatusSnapshot} from '@deepseek-ai/dsh-client-ui-session/client'
import type {Context} from '@deepseek-ai/cordis'

/** Cordis 增强声明的会话 UI 状态面;本插件只读它的 `sessionStatus`。 */
type UiSession = Context['uiSession']

/**
 * 会话导航面:上游 `UiWorkspace` 的公开面里本插件唯一要用的动词。
 *
 * 该服务由 Workspace browser 所在的上游客户端包提供。本插件不为它多拉一个类型依赖,
 * 只按这份结构读取 `scope.get('uiWorkspace')`;该服务由注入列表声明,因此读取时它必然
 * 已经激活 —— 形状不符(上游改了方法名)时才告警一次并整体不安装。
 */
export interface SessionNavigation {
  /**
   * 选中一个会话、把它的 Conversation 显示出来 —— 与点击侧栏那一行是同一个操作。
   * @param target - 已知会话身份。
   */
  openSession(target: SessionId): void
}

/** 一次按键在会话导航中的方向。 */
export type SessionStep = 'previous' | 'next'

/** 一次按键要走的池子:全部候选,或只走活跃会话。 */
export type SessionPool = 'all' | 'active'

/** 本桥挂载并跟随的 fixed 会话导航行 id(`primary+↑/↓`,走全部候选)。 */
export const SESSION_CYCLE_ID: ShortcutCommandId = 'dsh-focus-free-shortcuts.session-cycle' as ShortcutCommandId

/** 本桥挂载的 fixed 活跃会话行 id(`primary+alt+↑/↓`,只走活跃池)。 */
export const SESSION_ACTIVE_CYCLE_ID: ShortcutCommandId = 'dsh-focus-free-shortcuts.session-active-cycle' as ShortcutCommandId

/** `primary+↑`:向候选列表起点方向切换(macOS `⌘↑`,Windows/Linux `Ctrl+↑`)。 */
export const SESSION_PREVIOUS_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'ArrowUp',
  modifiers: ['primary'],
}

/** `primary+↓`:向候选列表终点方向切换(macOS `⌘↓`,Windows/Linux `Ctrl+↓`)。 */
export const SESSION_NEXT_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'ArrowDown',
  modifiers: ['primary'],
}

/** `primary+alt+↑`:向活跃池起点方向切换(macOS `⌘⌥↑`,Windows/Linux `Ctrl+Alt+↑`)。 */
export const SESSION_ACTIVE_PREVIOUS_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'ArrowUp',
  modifiers: ['primary', 'alt'],
}

/** `primary+alt+↓`:向活跃池终点方向切换(macOS `⌘⌥↓`,Windows/Linux `Ctrl+Alt+↓`)。 */
export const SESSION_ACTIVE_NEXT_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'ArrowDown',
  modifiers: ['primary', 'alt'],
}

/** 全部候选那一条 fixed 行:占用两个方向键并声明该操作;键帽按平台格式化。 */
export function sessionCycleCommand(platform: ShortcutPlatform): ShortcutFixedCommand {
  return {
    id: SESSION_CYCLE_ID,
    label: () => '切换会话',
    keys: bindingKeycaps(SESSION_PREVIOUS_BINDING, platform, '↑/↓'),
    bindings: [SESSION_PREVIOUS_BINDING, SESSION_NEXT_BINDING],
    group: 'application',
  }
}

/** 活跃池那一条 fixed 行:占用带 `Alt` 的两个方向键并声明该操作;键帽按平台格式化。 */
export function sessionActiveCycleCommand(platform: ShortcutPlatform): ShortcutFixedCommand {
  return {
    id: SESSION_ACTIVE_CYCLE_ID,
    label: () => '切换到活跃会话',
    keys: bindingKeycaps(SESSION_ACTIVE_PREVIOUS_BINDING, platform, '↑/↓'),
    bindings: [SESSION_ACTIVE_PREVIOUS_BINDING, SESSION_ACTIVE_NEXT_BINDING],
    group: 'application',
  }
}

/** 参与候选的工作区分组数量上限:只切换前三个工作区里显示出来的会话行。 */
export const WORKSPACE_LIMIT = 3

/** 侧栏工作区分组行的 `data-row-key` 前缀(Workspace browser 的分组行)。 */
const WORKSPACE_ROW_PREFIX = 'workspace:'

/** 侧栏会话行的 `data-row-key` 前缀(Workspace browser 的会话行)。 */
const SESSION_ROW_PREFIX = 'session:'

/**
 * 侧栏行的通用标记。只有 Workspace browser 发布这个属性:分组行与会话行,外加
 * 「空列表」与「展开更多」两种非会话行;轨迹视图、会话流、搜索框都不带。
 */
const ROW_SELECTOR = '[data-row-key]'

/**
 * 归档行的标记:官方渲染器只对归档行写 `aria-description`(「已归档,不可打开」的提示文案)。
 * 官方 `guardedOpen` 打开归档行只弹提示、不切换,所以这类行不进候选。
 */
const ARCHIVED_MARKER = 'aria-description'

/** 「未分组」桶的分组键:它不是工作区,既不占前三个名额、也不贡献候选。 */
const UNGROUPED_KEY = ''

/**
 * 两条会话切换行各自的池子与方向键读数。
 *
 * 两条行的物理键位只在修饰键集合上不同(有无 `Alt`),方向键是同一对,所以方向由命中的
 * `code` 决定,池子由命中的**行**决定。
 */
const SESSION_CYCLE_ROWS: readonly {
  readonly id: ShortcutCommandId
  readonly pool: SessionPool
}[] = [
  { id: SESSION_CYCLE_ID, pool: 'all' },
  { id: SESSION_ACTIVE_CYCLE_ID, pool: 'active' },
]

/**
 * 某一条挂载行自己的绑定为该次按键指明的方向。
 *
 * 按行是否拥有该按键判定,并读取命中的 binding 的 `code`;行未挂载或未命中则返回
 * undefined —— 与页面循环的 `pageStepFor` 同一条规则。
 */
export function sessionStepFor(
  rows: readonly ShortcutFixedCatalogEntry[],
  id: string,
  gesture: ShortcutGesture,
): SessionStep | undefined {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) return undefined
  const matched = row.bindings.find((binding) => bindingMatches(binding, gesture))
  if (matched === undefined) return undefined
  if (matched.code === SESSION_NEXT_BINDING.code) return 'next'
  if (matched.code === SESSION_PREVIOUS_BINDING.code) return 'previous'
  return undefined
}

/** 一次按键的意图:走哪个池子、往哪个方向。 */
export interface SessionCycleRequest {
  readonly pool: SessionPool
  readonly step: SessionStep
}

/**
 * 本次按键命中的是哪一条行、往哪个方向走。
 *
 * 两条行都按「行是否拥有该按键」判定;一条都没命中(键位不对、行未挂载)时返回 undefined。
 * 两条行的绑定修饰键集合互斥(`primary` 对 `primary+alt`),所以至多命中一条。
 */
export function sessionCycleRequest(
  rows: readonly ShortcutFixedCatalogEntry[],
  gesture: ShortcutGesture,
): SessionCycleRequest | undefined {
  for (const row of SESSION_CYCLE_ROWS) {
    const step = sessionStepFor(rows, row.id, gesture)
    if (step !== undefined) return { pool: row.pool, step }
  }
  return undefined
}

/**
 * 该次按键能否在没有 DOM 焦点时切换会话。
 *
 * 任何输入区域都接受(包括终端:落在 `.xterm` 内的按键由捕获路先拦下),已消费的按键
 * (`defaultPrevented`)也照常处理;只保留输入法组合中、自动重复与存在模态这三项排除 ——
 * 与页面循环同一条准入。
 */
export function sessionCycleEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && context.modal === null
}

/** 行的 `data-row-key` 读数;没有该属性时返回 undefined。 */
function rowKeyOf(element: Element): string | undefined {
  const key = element.getAttribute('data-row-key')
  return key === null ? undefined : key
}

/**
 * 会话行所在的分组容器。
 *
 * 行的外面还包着一层 HoverCard 的 `<span>`(官方 `HoverCard` 的根),所以从行的父节点
 * 往上取「最近的 div 祖先」—— 那就是分组容器;行本身就是分组容器的直接子节点时
 * (上游去掉那层包装)取到的也是同一个容器。
 */
function sectionOf(element: Element): Element | undefined {
  const wrapper = element.parentElement
  if (wrapper === null) return undefined
  return wrapper.closest('div') ?? undefined
}

/**
 * 会话行所属的分组键:该行所在分组容器里**第一个**工作区行。
 *
 * 分组容器按「自己的分组行 → 嵌套子分组 → 自己名下的会话行」渲染,所以第一个工作区行
 * 一定是本容器自己的分组行,嵌套子分组里的行不会被误认;工作区树模式下父分组自己的
 * 会话行跟在自己的嵌套子分组之后,靠这一条仍归父分组。单列表模式下容器里根本没有
 * 工作区行,返回 undefined(这类行不进候选)。
 */
function owningGroupKey(element: Element): string | undefined {
  const section = sectionOf(element)
  if (section === undefined) return undefined
  for (const row of section.querySelectorAll(ROW_SELECTOR)) {
    const key = rowKeyOf(row)
    if (key !== undefined && key.startsWith(WORKSPACE_ROW_PREFIX)) {
      return key.slice(WORKSPACE_ROW_PREFIX.length)
    }
  }
  return undefined
}

/**
 * 一段渲染出来的会话行:它属于哪个分组、是哪一次会话、可不可打开。
 */
export interface DisplayedRow {
  /** 所属分组键:真实工作区是它的 workspace id,「未分组」桶是空串。 */
  readonly group: string
  readonly session: SessionId
  /**
   * 归档行。官方渲染器给归档行写上「已归档,不可打开」的 `aria-description`,而
   * `guardedOpen` 打开它只弹提示、不切换 —— 这类行不算可切的目标。
   */
  readonly archived: boolean
}

/** 左侧栏此刻渲染出来的分组行与会话行,都按显示顺序。 */
export interface DisplayedSidebar {
  /** 工作区分组键,按显示顺序(含「未分组」桶的空串键,去重)。 */
  readonly groups: readonly string[]
  /** 会话行,按显示顺序(含归档行,便于调用处自行取舍)。 */
  readonly rows: readonly DisplayedRow[]
}

/**
 * 读一次左侧栏此刻渲染出来的分组行与会话行,这就是「被展示出来」的唯一口径。
 *
 * 只有工作区浏览器发布 `[data-row-key]` 这个行标记(轨迹视图、会话流、搜索框都不带),
 * 所以全文档扫一遍不会收到别处的行。由此天然跟随侧栏的真实状态:折叠的分组不渲染会话行;
 * 每个分组默认最多渲染 5 行,多出来的挡在「展开更多」行之后;搜索过滤生效时列表区换成
 * 搜索结果(没有行标记);窄/收起侧栏时整个列表区不渲染。分组按首次出现顺序、会话行按
 * DOM 顺序返回,与眼睛看到的顺序一致。
 */
export function displayedSidebar(): DisplayedSidebar {
  if (typeof document === 'undefined') return { groups: [], rows: [] }
  const groups: string[] = []
  const seen = new Set<string>()
  const rows: DisplayedRow[] = []
  for (const element of document.querySelectorAll(ROW_SELECTOR)) {
    const rowKey = rowKeyOf(element)
    if (rowKey === undefined) continue
    if (rowKey.startsWith(WORKSPACE_ROW_PREFIX)) {
      const key = rowKey.slice(WORKSPACE_ROW_PREFIX.length)
      if (!seen.has(key)) {
        seen.add(key)
        groups.push(key)
      }
      continue
    }
    if (!rowKey.startsWith(SESSION_ROW_PREFIX)) continue //「空列表」/「展开更多」不是会话行
    const group = owningGroupKey(element)
    // 归属认不出来(上游换了渲染结构)时宁可不收这一行,也不猜它属于谁。
    if (group === undefined) continue
    rows.push({
      group,
      session: rowKey.slice(SESSION_ROW_PREFIX.length) as SessionId,
      archived: element.hasAttribute(ARCHIVED_MARKER),
    })
  }
  return { groups, rows }
}

/**
 * 前三个工作区里此刻显示出来的会话 id,按显示顺序。
 *
 * 「未分组」桶不是工作区,既不占前三个名额、也不贡献候选;没有会话行的分组照占名额
 * (它明明是被展示出来的一个工作区);归档行不可打开,不进候选。
 */
export function displayedSessionIds(): SessionId[] {
  const { groups, rows } = displayedSidebar()
  const allowed = new Set(groups.filter((key) => key !== UNGROUPED_KEY).slice(0, WORKSPACE_LIMIT))
  return rows
    .filter((row) => !row.archived && allowed.has(row.group))
    .map((row) => row.session)
}

/**
 * 一个候选会话是否活跃,即它的行上此刻有没有状态点。
 *
 * 三项状态事实任一成立即活跃:有待答交互(它正等着人)、已完成未读(绿点)、或正在运行
 * —— 状态表里的 `running` 是权威读数,还没建立读数时退回会话目录的 `running`(与
 * Workspace browser 的同一处判定同源)。回合出错结束时与正常完成一样走「运行变 false」,
 * 因此这类会话由 `completionUnread` 覆盖,不另设判定。
 */
export function sessionActive(
  sessionId: SessionId,
  statuses: SessionStatusSnapshot | undefined,
  list: SessionListState,
): boolean {
  const status = statuses?.get(sessionId)
  if (status !== undefined && status.pendingInteraction !== undefined) return true
  if (status?.completionUnread === true) return true
  return (status?.running ?? list.byId[sessionId]?.running) === true
}

/** 候选里活跃的会话 id,保持候选顺序。 */
export function activeAmong(
  candidates: readonly SessionId[],
  statuses: SessionStatusSnapshot | undefined,
  list: SessionListState,
): SessionId[] {
  return candidates.filter((sessionId) => sessionActive(sessionId, statuses, list))
}

/** 一次按键的候选事实:候选顺序、当前会话与其中的活跃候选。 */
export interface SessionCycleFacts {
  /** 候选会话 id,按侧栏显示顺序。 */
  readonly candidates: readonly SessionId[]
  /** 主视图当前保留的会话;没有或正在切换时为 undefined。 */
  readonly current: SessionId | undefined
  /** 候选里活跃的会话 id,保持候选顺序。 */
  readonly active: readonly SessionId[]
}

/**
 * 本次按键要循环的池子。
 *
 * `'all'` 是全部候选(`primary+↑` / `primary+↓` 那一条);`'active'` 只取活跃候选
 * (`primary+alt+↑` / `primary+alt+↓` 那一条),没有活跃候选时是空池 —— 空池不动作,不退回
 * 全部候选:常规导航本来就有自己的一条键。
 */
export function sessionPool(facts: SessionCycleFacts, pool: SessionPool): readonly SessionId[] {
  return pool === 'active' ? facts.active : facts.candidates
}

/**
 * 池中与当前会话相邻的一个会话。
 *
 * 环状步进:回头绕到末尾、到头绕回开头;当前会话不在池里(它在别的工作区,或正在切换)
 * 时,前进落池首、后退落池尾。只有一个成员时返回它自己,由调用处判为「没有可切的目标」。
 */
export function steppedSessionId(
  pool: readonly SessionId[],
  currentId: SessionId | undefined,
  step: SessionStep,
): SessionId | undefined {
  if (pool.length === 0) return undefined
  const index = currentId === undefined ? -1 : pool.indexOf(currentId)
  if (index < 0) return step === 'next' ? pool[0] : pool[pool.length - 1]
  const delta = step === 'next' ? 1 : -1
  return pool[(index + delta + pool.length) % pool.length]
}

/**
 * 一次按键要切换到的会话;没有可切的目标时返回 undefined。
 *
 * `undefined` 覆盖:没有候选、活跃池空、以及算出来的目标就是当前会话(池里只有一个成员,
 * 或那个活跃会话已在屏上)。
 */
export function sessionCycleTarget(facts: SessionCycleFacts, request: SessionCycleRequest): SessionId | undefined {
  const next = steppedSessionId(sessionPool(facts, request.pool), facts.current, request.step)
  if (next === undefined || next === facts.current) return undefined
  return next
}

/**
 * 一次按键切换会话所需的全部信息,按当前状态解析;返回 undefined 表示不动该按键。
 *
 * 两条投递路径(观察者与终端前的捕获拦截)共用本判定;两条 fixed 行也共用它,池子由
 * 命中的那一条行决定。
 */
export function sessionCyclePlan(
  shortcuts: Shortcuts,
  sessions: ISessions,
  uiSession: UiSession,
  gesture: ShortcutGesture,
  context: ShortcutContext,
): SessionId | undefined {
  if (!sessionCycleEligible(gesture, context)) return undefined
  const request = sessionCycleRequest(shortcuts.fixedCatalog.getSnapshot(), gesture)
  if (request === undefined) return undefined
  // 侧栏没渲染(窄/收起、搜索过滤中、单列表模式下没有工作区分组)时没有候选可切。
  const candidates = displayedSessionIds()
  if (candidates.length === 0) return undefined
  const list = sessions.list.getSnapshot()
  return sessionCycleTarget({
    candidates,
    current: mainViewSessionId(list),
    active: activeAmong(candidates, uiSession.sessionStatus.getSnapshot(), list),
  }, request)
}

/**
 * 桥接会话切换键(两条 fixed 行)。
 *
 * 通过两条路径投递按键:观察者处理 DOM 通道收到的按键;捕获阶段 window `keydown`
 * 监听处理落在 `.xterm` 内、通道收不到的按键。两条路径运行同一判定
 * (`sessionCyclePlan`)与同一切换,一次按键只被处理一次。
 *
 * `uiWorkspace` 与其余三项一样声明在注入列表里,而不是在回调里直接 `get` 一次:
 * `ctx.get` 默认只认**已激活**的服务,而 Workspace browser 的客户端包依赖一长串服务
 * (`layout` / `remote.directoryPicker` 等),它的激活可能晚于本插件 —— 采样一次会把
 * 「还没激活」错当成「缺席」,整条桥就再也不安装了。声明成依赖后本 scope 会等到该服务
 * 真正可用再跑,服务缺席(没有 Workspace browser 的客户端)时同样退化为不安装。
 */
export function installSessionCycleBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sessions', 'uiSession', 'uiWorkspace'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sessions: ISessions = scope.sessions
    const uiSession: UiSession = scope.uiSession
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; session-cycle keys not installed')
      return
    }
    // 会话导航面由 Workspace browser 提供;没有它就既没有侧栏行、也没有可切换的动作。
    const navigation: SessionNavigation | undefined = scope.get('uiWorkspace')
    if (navigation === undefined || typeof navigation.openSession !== 'function') {
      warn('uiWorkspace service unavailable; session-cycle keys not installed')
      return
    }
    // 行必须先挂载,观察者才能读到它们;三者在同 scope,按同序销毁。
    scope.effect(() => {
      const offCycle = shortcuts.registerFixed(sessionCycleCommand(shortcuts.platform))
      const offActive = shortcuts.registerFixed(sessionActiveCycleCommand(shortcuts.platform))
      return () => {
        offCycle()
        offActive()
      }
    }, `${name}: session cycle fixed row`)
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handleSessionCycleInput(shortcuts, sessions, uiSession, navigation, input)
    }), `${name}: session cycle keys`)
    // 终端那一半:落在 `.xterm` 内的 keydown 到不了上面的 window 监听(终端在自己的
    // textarea 处理器里停掉了它),本捕获监听早一个阶段看到它,且早于事件进入终端。
    // 只处理终端本会占用的按键,并复用观察者使用的同一判定函数。
    scope.effect(() => {
      if (typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        const element = composedElement(event)
        if (!terminalTarget(element)) return
        const nextId = sessionCyclePlan(shortcuts, sessions, uiSession, captureGesture(event), captureContext(element))
        if (nextId === undefined) return
        // 在终端自身处理器之前拦截:事件到此为止,xterm 既收不到该按键,也不会向
        // shell 发送转义序列。
        event.preventDefault()
        event.stopPropagation()
        navigation.openSession(nextId)
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: session cycle terminal capture`)
  })
}

/**
 * 处理固定通道投递的一次 keydown;只有解析出切换目标时才消费按键。
 */
function handleSessionCycleInput(
  shortcuts: Shortcuts,
  sessions: ISessions,
  uiSession: UiSession,
  navigation: SessionNavigation,
  input: KeydownInput,
): void {
  const nextId = sessionCyclePlan(shortcuts, sessions, uiSession, input.gesture, input.context)
  if (nextId === undefined) return
  // 先消费再动作,避免该按键同时被页面内的输入控件处理。
  input.consume()
  navigation.openSession(nextId)
}
