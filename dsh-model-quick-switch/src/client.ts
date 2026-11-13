/**
 * 浏览器半部：一条固定键 + 一张快捷菜单 + 注册进设置页的列表编辑器。
 *
 *   - **快捷菜单**：`primary+alt+U`（macOS `⌘⌥U`，Windows / Linux `Ctrl+Alt+U`）弹出。顶部两行是
 *     作用于**当前主视图会话**的「新建工作树」「团队协作」开关（`remote.forgePanel` /
 *     `remote.agentTeams`，成功也不关浮层）；下面是本插件设置里保存的模型列表，`Enter` / 点击
 *     一行切换当前会话使用的模型（`session.selectModel`），成功后关闭浮层，失败则把 Host 的
 *     错误留在浮层底部。
 *   - **设置页**：注册进 `settings.section`（「模型快速切换」）。列表从 Host 模型目录里按提供方
 *     浏览、添加，也能删除；写入走 `ctx.configForms.get('dsh-model-quick-switch')` 的
 *     `mutate({ op: 'set', path: ['models'] })`，整份列表原子替换。
 *
 * 浮层交互与 `dsh-workspace-quick-switch` 同一套（一屏 10 行、窗口连续滑动、滚轮一格一行、
 * `←` / `→` 滑一整屏、两端绕回），状态规则在 `palette.ts`，候选投影在 `model.ts`，两行快捷
 * 操作的事实收窄与文案在 `actions.ts`。
 *
 * 四条通路：
 *
 *   - **固定行**注册在快捷键服务里（group `application`），占据 `primary+alt+U`，存在本身就是
 *     占用；按键经 `observeFixedInput` 的固定通道送达，命中时立刻 `consume()`（适配器就是
 *     `preventDefault`）—— 固定行只占住组合键，上游不会替它消费。
 *   - **浮层**注册进 `shell.overlay`；业务 props（浮层状态、数据快照、文案）只由 `options.inject`
 *     交出来。
 *   - **浮层内的按键**由本插件在 document 捕获阶段取走（Esc / Enter / ↑ / ↓ / ← / →）。
 *   - **打开键的捕获兜底**：另挂一条 window 捕获阶段 keydown，命中就吞掉这一按并开浮层。
 *     它覆盖 composer、设置页与终端（终端会 stopPropagation，固定通道的 window 冒泡收不到），
 *     捕获先跑，所以固定通道不会收到同一按、不会开两次。
 *
 * 内核所需的 `slots` / `shortcuts` 是启动即有；`configForms`、`sessions`、`remote.session`、
 * `remote.forgePanel`、`remote.agentTeams` 各经等待子 fiber 接上（设置文档、会话目录、远程链路
 * 都可能比本插件晚到位）。服务缺席时浮层照常能开，只是没有候选 / 工作树行隐藏 / 团队行写明
 * 不可用 / 执行时给出可读错误。
 */
import * as React from 'react'
import {
  actionOfKey,
  actionRowCount,
  checkoutStateOf,
  firstModelRowIndex,
  quickActionRows,
  teamFacts,
  worktreeFacts,
  type CheckoutState,
  type QuickAction,
  type TeamFacts,
  type WorktreeFacts,
} from './actions.ts'
import { name } from './runtime.ts'
import {
  MODEL_SWITCH_BINDING,
  MODEL_SWITCH_ID,
  PAGE_SIZE,
  bindingPress,
  clampIndex,
  clampOffset,
  createPaletteStore,
  inRange,
  installPaletteKeys,
  installPaletteWheel,
  keepOptionVisible,
  modelSwitchKeys,
  windowSlice,
  type ModelSwitchGesture,
  type PaletteRow,
  type PaletteStore,
  type PaletteView,
  type QuickSwitchPlatform,
} from './palette.ts'
import {
  addChoice,
  choiceKey,
  choicePresentation,
  choiceRows,
  currentChoiceIndex,
  effortChoices,
  effortRows,
  findCatalogModel,
  initialEffortIndex,
  orderCatalogGroups,
  readChoices,
  removeChoice,
  selectionOfChoice,
  selectionOfEffort,
  type CatalogModelRow,
  type CatalogGroup,
  type EffortChoice,
  type ModelChoice,
  type ModelSelectionLike,
} from './model.ts'
import {
  createModelDataStore,
  describeRemoteFailure,
  messageOf,
  type ModelDataStore,
  type PaletteStage,
} from './model-data.ts'
import { PALETTE_CSS, SETTINGS_CSS } from './styles.ts'

// 上游类型：服务面与数据契约全部直接用包导出的名字，本文件不再自己重写一份同名形状。
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-agent/types'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ForgePanelState } from '@deepseek-ai/dsh-experimental-client-ui-forge/types'
import type { ShortcutFixedCommand, Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConfigForm, ConfigForms, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
// 空类型导入：只为加载上游包的模块增强，不产生任何运行时导入 —— `Context.remote` 与
// `remote.session` / `remote.forgePanel` / `remote.agentTeams` 三个命名空间、ui-layout 声明的
// `shell.overlay` 槽位键、`retainedBy.mainView` 计数、`agentTeam` 投影键。
// （`settings.section` 键、`modelSelection` 与 `forgeWorktree` 投影键随上面同包的命名导入生效。）
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-forge/remote'
import type {} from '@deepseek-ai/dsh-agent-team/remote'
import type {} from '@deepseek-ai/dsh-agent-team/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

export { name }
export { paletteAction } from './palette.ts'

/** 浮层依赖的两个客户端服务；任一缺席就整体不安装。 */
export const inject = ['slots', 'shortcuts']

/** 设置页的分区 id（也用于图标寻址）。 */
export const SETTINGS_SECTION_ID = name

/** 设置页在导航里的顺序：排在「模型」（10）与「插件」（900）之间，靠后但不垫底。 */
export const SETTINGS_SECTION_ORDER = 70

/** 本插件在 profile 里的条目 id —— 也就是设置命名空间 / `configForms.get` 的键。 */
export const CONFIG_ENTRY_ID = name

/** 浮层根节点的 DOM 标记（人工排查与自动化验证都读它）。 */
export const PALETTE_ROOT_ATTR = 'data-model-quick-switch'

/** 浮层里一行候选的 DOM 标记。 */
export const PALETTE_OPTION_ATTR = 'data-model-quick-switch-option'

/** 设置页根节点的 DOM 标记。 */
export const SETTINGS_ROOT_ATTR = 'data-model-quick-switch-settings'

/** 模型浮层的文案。 */
export const MODEL_VIEW: PaletteView = {
  id: name,
  domId: name,
  rootAttr: PALETTE_ROOT_ATTR,
  title: '快捷菜单',
  unit: '个模型',
  emptyCount: '列表里还没有模型',
  emptyHint: '在「设置 → 模型快速切换」里添加要在这里出现的模型。',
  listLabel: '模型与操作',
  enterHint: 'Enter 切换模型',
}

/** 思考等级浮层的文案。 */
export const EFFORT_VIEW: PaletteView = {
  id: `${name}.effort`,
  domId: `${name}-effort`,
  rootAttr: PALETTE_ROOT_ATTR,
  title: '选择思考等级',
  unit: '个等级',
  emptyCount: '没有可选等级',
  emptyHint: '这个模型没有公布思考等级。',
  listLabel: '思考等级',
  enterHint: 'Enter 切换模型',
}

/*
 * 服务面与数据契约不再本地重写：`ctx.slots` 是 `SlotRegistry`、`ctx.shortcuts` 是 `Shortcuts`、
 * `ctx.configForms` 是 `ConfigForms`（表单是 `ConfigForm<T>`）、`ctx.sessions` 是
 * `Context['sessions']`，三个远程命名空间是 `Context['remote']` 的 `session` / `forgePanel` /
 * `agentTeams`；投影与摘要全部走会话语义包的命名导出。下面只保留本插件自己的领域类型
 * （浮层、设置页 props 与动作面）。
 */

/** 设置页里可执行的动作。 */
export interface SettingsActions {
  /** 重新拉取 Host 模型目录。 */
  loadCatalog(): Promise<void>
  /** 往列表里加一条（已存在则不动）。 */
  add(choice: ModelChoice): Promise<void>
  /** 从列表里删一条（不存在则不动）。 */
  remove(choice: ModelChoice): Promise<void>
}

/** 设置页组件的 props（由 `options.inject` 交出）。 */
export interface SettingsProps {
  readonly data: ModelDataStore
  readonly actions: SettingsActions
}

/** 浮层组件的 props。 */
export interface OverlayProps {
  readonly store: PaletteStore
  readonly data: ModelDataStore
  readonly view: PaletteView
  /** 第二步（选思考等级）的文案；缺席时复用 `view`。 */
  readonly effortView?: PaletteView
  /** 第二步按 `Esc` 时退回第一步。 */
  readonly onBack?: () => void
}

/**
 * 安装一条样式表（浮层 + 设置页）。
 * @returns 移除样式表的函数。
 */
function installStyleTag(): () => void {
  if (typeof document === 'undefined') return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.textContent = `${PALETTE_CSS}\n${SETTINGS_CSS}`
  document.head.appendChild(tag)
  return () => tag.remove()
}

/** 输出一行带插件前缀的诊断。 */
function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}

/** 标题右侧的计数文案：一屏装得下时报总数，否则报当前看到的行范围。 */
export function countLabel(view: PaletteView, total: number, offset: number): string {
  if (total <= PAGE_SIZE) return `${total} ${view.unit}`
  const from = offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)
  return `${total} ${view.unit} · 显示 ${from}–${to}`
}

/**
 * 快捷菜单标题右侧的计数：把模型与操作分开报。
 *
 * 没有操作行时保持原行为（含「显示 a–b」的窗口提示）；有操作行时只报「n 个模型 · m 个操作」，
 * 不把两行操作算进模型数。
 * @param view - 浮层文案。
 * @param entries - 全部候选。
 * @param offset - 窗口起点。
 * @returns 一行计数文案。
 */
export function paletteCountLabel(view: PaletteView, entries: readonly PaletteRow[], offset: number): string {
  const actions = actionRowCount(entries)
  if (actions === 0) return countLabel(view, entries.length, offset)
  const models = entries.length - actions
  return `${models} ${view.unit} · ${actions} 个操作`
}

/** 一行候选项的 DOM id（与 `aria-activedescendant` 配对，滚进可见区也按它定位）。 */
export function optionDomId(view: PaletteView, index: number): string {
  return `${view.domId}-option-${index}`
}

/**
 * 固定输入读数里的按键事实；不是 keydown 或没有 gesture 时返回 undefined。
 * @param input - 固定输入读数。
 */
function fixedGesture(input: unknown): ModelSwitchGesture | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const candidate = input as { readonly type?: unknown; readonly gesture?: unknown }
  if (candidate.type !== 'keydown') return undefined
  // 固定通道读数是不透明的线上值：只按上游手势类型取字段，形状不合的字段在读取处按 undefined 处理。
  const gesture = candidate.gesture as ModelSwitchGesture | undefined
  return gesture === null ? undefined : gesture
}

/**
 * 这次固定输入是否归模型浮层。
 *
 * 组合完全匹配（macOS `⌘⌥U`，其余平台 `Ctrl+Alt+U`）、不是组字 / 长按 / 已被消费的输入，
 * 且对应的固定行真的还挂在目录里（被别的注册者挤掉时这一按就「无主」）。
 * @param shortcuts - 快捷键目录面。
 * @param platform - 接收输入的设备平台。
 * @param gesture - 按键事实（KeyboardEvent 或固定通道读数结构上都满足）。
 * @returns 是否归本插件。
 */
export function ownedModelSwitch(
  shortcuts: Shortcuts,
  platform: QuickSwitchPlatform,
  gesture: ModelSwitchGesture | undefined,
): boolean {
  if (gesture === undefined) return false
  if (gesture.composing === true || gesture.repeat === true || gesture.defaultPrevented === true) return false
  if (!bindingPress(platform, MODEL_SWITCH_BINDING, gesture)) return false
  const rows = shortcuts.fixedCatalog?.getSnapshot()
  return rows === undefined || rows.some((row) => row.id === MODEL_SWITCH_ID)
}

/** 从一次原生 keydown 里取出本插件要读的手势事实（捕获阶段 `defaultPrevented` 恒为 false）。 */
function keyGesture(event: KeyboardEvent): ModelSwitchGesture {
  return {
    code: event.code,
    control: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    repeat: event.repeat,
    composing: event.isComposing,
    defaultPrevented: false,
  }
}

/**
 * 把这次固定输入收归本插件：调用适配器交出来的 `consume`（它就是 `event.preventDefault()`）。
 *
 * 固定行只「占住」组合键，上游不会替它消费；不消费的话平台会把同一次组合键再执行一遍自己的
 * 快捷键。消费必须发生在按键派发的同一拍里，而固定通道本来就是同步回调。
 * @param input - 固定输入读数；没有 `consume` 的替身输入直接跳过。
 */
function consumeFixedInput(input: unknown): void {
  if (typeof input !== 'object' || input === null) return
  const face = input as { readonly consume?: unknown }
  if (typeof face.consume === 'function') (face.consume as () => void)()
}

/**
 * 从注入面读槽位表。
 *
 * 读数用 `ctx.get` 取（`Context` 之上由 ui-renderer 声明的 `slots` 面），先做运行时形状检查
 * 再交给上游类型：服务缺席时调用方整块不安装，而不是让浮层带着半个槽位表跑。
 * @param scope - 当前等待子 fiber 的客户端上下文。
 * @returns `SlotRegistry`，或服务不可用时的 undefined。
 */
function readSlots(scope: Context): SlotRegistry | undefined {
  const value = scope.get('slots')
  if (typeof value !== 'object' || value === null) return undefined
  const face = value as Partial<SlotRegistry>
  if (typeof face.inject !== 'function' || typeof face.register !== 'function') return undefined
  return face as SlotRegistry
}

/**
 * 从注入面读快捷键目录。
 * @param scope - 当前客户端上下文。
 * @returns `Shortcuts`，或服务不可用时的 undefined。
 */
function readShortcuts(scope: Context): Shortcuts | undefined {
  const value = scope.get('shortcuts')
  if (typeof value !== 'object' || value === null) return undefined
  const face = value as Partial<Shortcuts>
  if (typeof face.registerFixed !== 'function' || typeof face.observeFixedInput !== 'function') return undefined
  return face as Shortcuts
}

/**
 * 从注入面读设置表单服务。
 * @param scope - 当前客户端上下文。
 * @returns `ConfigForms`，或服务不可用时的 undefined。
 */
function readConfigForms(scope: Context): ConfigForms | undefined {
  const value = scope.get('configForms')
  if (typeof value !== 'object' || value === null) return undefined
  const face = value as Partial<ConfigForms>
  if (typeof face.get !== 'function') return undefined
  return face as ConfigForms
}

/**
 * 从注入面读会话目录。
 * @param scope - 当前客户端上下文。
 * @returns `ctx.sessions` 的公开面，或服务不可用时的 undefined。
 */
function readSessions(scope: Context): Context['sessions'] | undefined {
  const value = scope.get('sessions')
  if (typeof value !== 'object' || value === null) return undefined
  const face = value as Partial<Context['sessions']>
  if (face.list === undefined || typeof face.list.getSnapshot !== 'function') return undefined
  return face as Context['sessions']
}

/**
 * 从注入面读远程服务。
 * @param scope - 当前客户端上下文。
 * @returns 上游 `Context['remote']` 面，或服务不可用时的 undefined。
 */
function readRemote(scope: Context): Context['remote'] | undefined {
  const value = scope.get('remote')
  if (typeof value !== 'object' || value === null) return undefined
  return value as Context['remote']
}

/**
 * 安装「固定行 + 浮层 + 设置页」。
 *
 * 只等 `slots` / `shortcuts`；`sessions` / `configForms` / `remote` 通过等待子 fiber 接上。
 * @param ctx - 客户端上下文。
 */
export function apply(ctx: Context): void {
  ctx.inject(inject, (scope) => {
    const slots = readSlots(scope)
    if (slots === undefined) return
    const shortcuts = readShortcuts(scope)
    if (shortcuts === undefined) {
      warn('shortcuts 服务不可用：固定行与快捷键输入未安装')
      return
    }

    // `primary` 按平台展开：macOS 上是 meta（⌘⌥U），其余平台是 control（Ctrl+Alt+U）。
    const platform: QuickSwitchPlatform = shortcuts.platform ?? 'windows'
    const data = createModelDataStore()
    const palette = createPaletteStore()
    let form: ConfigForm<unknown> | undefined
    // `remote.session` 是生成出来的命名空间：没在 fiber 的 inject 里声明就直接读会抛
    // 「cannot get property "remote.session" without inject」，所以先等子 fiber 把它接上。
    let sessionRemote: Context['remote']['session'] | undefined
    // 快捷操作的两条链路各自晚到：forge 面板负责工作树请求与 Git 检查，团队服务负责 agentTeam 开关。
    let forgePanelRemote: Context['remote']['forgePanel'] | undefined
    let agentTeamsRemote: Context['remote']['agentTeams'] | undefined
    // 只为「当前目录是不是 Git 仓库」维持一条 forge 面板状态流；会话切换时换一条。
    let forgePanelStream: RemoteStreamHandle<ForgePanelState, never> | undefined
    let forgePanelStreamSession: SessionId | null = null
    let catalogInFlight: Promise<void> | undefined
    // 浮层的两步：先选模型，确认后再把候选换成这个模型的思考等级。
    let stage: PaletteStage = 'models'
    let stageChoice: ModelChoice | null = null
    let stageEfforts: readonly EffortChoice[] = []
    let stageModelIndex = 0

    /** 把设置里保存的列表读进数据快照。 */
    const refreshChoices = (): void => {
      const entry = form
      if (entry === undefined) {
        data.set({ choices: [], configStatus: 'unavailable', writable: false })
        return
      }
      const snapshot: ConfigFormSnapshot<unknown> = entry.getSnapshot()
      data.set({
        choices: readChoices(snapshot.value),
        configStatus: snapshot.status,
        writable: snapshot.writable === true,
      })
    }

    /**
     * 为「当前目录是不是 Git 仓库」维持一条 forge 面板状态流。
     *
     * 只读 `checkout.state`：`none` 时工作树那一行整行隐藏。会话切换就换一条流；
     * 流断开时保留最后一次读数（不把 Git 仓库误判成非仓库）。
     * @param sessionId - 当前主视图会话；没有会话时为 null。
     */
    const startForgeFollow = (sessionId: SessionId | null): void => {
      forgePanelStream?.dispose()
      forgePanelStream = undefined
      forgePanelStreamSession = sessionId
      data.set({ checkout: null })
      if (sessionId === null) return
      const remote = forgePanelRemote
      const follow = remote?.follow
      if (remote === undefined || typeof follow !== 'function') return
      let stream: RemoteStreamHandle<ForgePanelState, never>
      try {
        stream = follow.call(remote, sessionId)
      } catch {
        return
      }
      forgePanelStream = stream
      void (async () => {
        try {
          for await (const frame of stream) {
            if (forgePanelStream !== stream) return
            const checkout = checkoutStateOf(frame)
            if (checkout !== null && checkout !== data.getSnapshot().checkout) data.set({ checkout })
          }
        } catch {
          // 链路断开：保留最后一次读数，工作树行不因一次断线而消失。
        } finally {
          if (forgePanelStream === stream) forgePanelStream = undefined
        }
      })()
    }

    /**
     * 会话变化时换一条面板流；没变就不重复订阅。
     * @param sessionId - 当前主视图会话；没有会话时为 null。
     */
    const syncForgeFollow = (sessionId: SessionId | null): void => {
      if (forgePanelStreamSession === sessionId) return
      startForgeFollow(sessionId)
    }

    /**
     * 读主视图会话与它的当前选择 / 两个快捷操作的状态投影。
     * @returns 会话 id；没有打开的会话时为 null。
     */
    const refreshSession = (): SessionId | null => {
      const sessions = readSessions(scope)
      const snapshot: SessionListState | undefined = sessions?.list.getSnapshot()
      if (snapshot === undefined) {
        data.set({ sessionId: null, current: null, worktree: null, team: null })
        syncForgeFollow(null)
        return null
      }
      const id = snapshot.ids.find((candidate) => (snapshot.byId[candidate]?.retainedBy?.mainView ?? 0) > 0)
      if (id === undefined) {
        data.set({ sessionId: null, current: null, worktree: null, team: null })
        syncForgeFollow(null)
        return null
      }
      const summary: SessionSummary | undefined = snapshot.byId[id]
      const values = summary?.projectionValues
      const projection: ModelSelectionProjection | undefined = values?.modelSelection
      data.set({
        sessionId: id,
        current: projection?.next ?? projection?.lastUsed ?? null,
        worktree: worktreeFacts(values?.forgeWorktree),
        team: teamFacts(values?.agentTeam),
      })
      syncForgeFollow(id)
      return id
    }

    /**
     * 把「操作 + 列表 + 目录 + 当前选择」投影成浮层行。
     *
     * 两行快捷操作排在模型前面；重投影时按 key 找回原来选中的行，避免前插操作行后选中行
     * 从某个模型跳到「新建工作树」上。
     */
    const syncRows = (): void => {
      const state = data.getSnapshot()
      const current = state.current ?? state.defaultSelection
      const actions = quickActionRows({
        sessionOpen: state.sessionId !== null,
        worktreeAvailable: forgePanelRemote !== undefined,
        teamAvailable: agentTeamsRemote !== undefined,
        worktree: state.worktree,
        team: state.team,
        checkout: state.checkout,
      })
      const models = choiceRows(state.choices, state.catalog, current, { catalogReady: state.catalogStatus === 'ready' })
      const rows = [...actions, ...models]
      const before = palette.getSnapshot()
      const activeKey = before.open && inRange(before.activeIndex, before.entries.length)
        ? before.entries[before.activeIndex]?.key
        : undefined
      palette.sync(rows)
      if (activeKey !== undefined) {
        const index = rows.findIndex((row) => row.key === activeKey)
        if (index >= 0 && index !== palette.getSnapshot().activeIndex) palette.select(index)
      }
    }

    /** 拉一次 Host 模型目录；并发调用共用同一次请求。 */
    const loadCatalog = (): Promise<void> => {
      if (catalogInFlight !== undefined) return catalogInFlight
      const modelCatalog = sessionRemote?.modelCatalog
      if (sessionRemote === undefined || typeof modelCatalog !== 'function') {
        data.set({ catalogStatus: 'error', catalogError: '模型目录服务不可用（remote.session 尚未就绪）。' })
        return Promise.resolve()
      }
      data.set({ catalogStatus: 'loading', catalogError: null })
      const operation = (async (): Promise<void> => {
        try {
          const response: RemoteResult<ModelCatalog> = await modelCatalog.call(sessionRemote)
          if (!response.ok) {
            data.set({ catalogStatus: 'error', catalogError: describeRemoteFailure(response.error) })
            return
          }
          // 成功值就是上游 `ModelCatalog`：分组、失败与默认选择都按它自己的字段读。
          const catalog = response.value
          data.set({
            catalogStatus: 'ready',
            catalogError: null,
            groups: catalog.groups ?? [],
            failures: catalog.failures ?? [],
            defaultSelection: catalog.default ?? null,
          })
        } catch (error) {
          data.set({ catalogStatus: 'error', catalogError: messageOf(error) })
        }
      })().finally(() => {
        if (catalogInFlight === operation) catalogInFlight = undefined
      })
      catalogInFlight = operation
      return operation
    }

    /**
     * 给当前会话切换模型。
     * @param choice - 选中行对应的模型。
     * @returns 是否成功（失败原因写进 `error`，浮层保持打开）。
     */
    const selectChoice = async (choice: ModelChoice): Promise<boolean> => {
      if (data.getSnapshot().pending) return false
      const sessionId = refreshSession()
      if (sessionId === null) {
        data.set({ error: '当前没有打开的会话：先在左侧栏打开或新建一个会话，再切换模型。' })
        return false
      }
      const selectModel = sessionRemote?.selectModel
      if (sessionRemote === undefined || typeof selectModel !== 'function') {
        data.set({ error: '模型选择服务不可用（remote.session 尚未就绪）。' })
        return false
      }
      data.set({ pending: true, error: null })
      try {
        const request = { sessionId, ...selectionOfChoice(choice) }
        const response = await selectModel.call(sessionRemote, request)
        if (!response.ok) {
          data.set({ pending: false, error: `切换失败：${describeRemoteFailure(response.error)}` })
          return false
        }
        const selected = response.value?.selected ?? selectionOfChoice(choice)
        data.set({ pending: false, error: null, current: selected })
        return true
      } catch (error) {
        data.set({ pending: false, error: `切换失败：${messageOf(error)}` })
        return false
      }
    }

    /**
     * 执行浮层顶部的一行快捷操作。
     *
     * 与模型确认的区别：成功与否都**不关闭浮层** —— 用户可以接着按 `↑` / `↓` 去切另一个开关，
     * 最后按 `Esc` 回到输入框；失败原因留在浮层底部。
     * @param action - 选中的快捷操作。
     */
    const runQuickAction = async (action: QuickAction): Promise<void> => {
      const state = data.getSnapshot()
      if (state.pending || state.actionPending !== null) return
      // 不在这里重读会话投影：写入成功后的乐观状态会被尚未追上的旧投影盖掉，连按第二次
      // 就会把「取消」又变成一次「请求」。会话切换由目录订阅负责刷新。
      const sessionId = state.sessionId ?? refreshSession()
      if (sessionId === null) {
        data.set({ error: '当前没有打开的会话：先在左侧栏打开或新建一个会话，再使用这里的开关。' })
        return
      }
      const facts = data.getSnapshot().worktree
      if (action === 'worktree') {
        if (facts !== null && facts.created !== null) {
          data.set({ error: `当前会话已经有工作树：${facts.created.branch ?? facts.created.path ?? '已创建'}。` })
          return
        }
        const remote = forgePanelRemote
        const request = remote?.requestWorktree
        const cancel = remote?.cancelWorktree
        if (remote === undefined || typeof request !== 'function' || typeof cancel !== 'function') {
          data.set({ error: '工作树服务不可用（forge 面板未启用）。' })
          return
        }
        const pending = facts !== null && facts.request !== null
        data.set({ actionPending: action, error: null })
        syncRows()
        try {
          const result = pending
            ? await cancel.call(remote, sessionId)
            : await request.call(remote, sessionId, null)
          if (!result.ok) {
            data.set({
              actionPending: null,
              error: `${pending ? '取消工作树' : '新建工作树'}失败：${describeRemoteFailure(result.error)}`,
            })
          } else {
            // 投影会随后推同一份状态；先按写入结果更新，避免等待一拍才看到角标变化。
            data.set({
              actionPending: null,
              worktree: {
                request: pending ? null : { from: null },
                created: facts?.created ?? null,
                locked: facts?.locked ?? false,
                stepped: facts?.stepped ?? false,
              },
            })
          }
        } catch (error) {
          data.set({
            actionPending: null,
            error: `${pending ? '取消工作树' : '新建工作树'}失败：${messageOf(error)}`,
          })
        }
        syncRows()
        return
      }
      const team = data.getSnapshot().team
      const remote = agentTeamsRemote
      const setEnabled = remote?.setEnabled
      if (remote === undefined || typeof setEnabled !== 'function') {
        data.set({ error: '团队协作服务不可用（agentTeams 未挂载）。' })
        return
      }
      const next = !(team?.enabled ?? false)
      data.set({ actionPending: action, error: null })
      syncRows()
      try {
        const result = await setEnabled.call(remote, sessionId, next)
        if (!result.ok) {
          data.set({ actionPending: null, error: `保存团队协作设置失败：${describeRemoteFailure(result.error)}` })
        } else {
          data.set({ actionPending: null, team: { enabled: next } })
        }
      } catch (error) {
        data.set({ actionPending: null, error: `保存团队协作设置失败：${messageOf(error)}` })
      }
      syncRows()
    }

    /** 把当前步骤的候选重新投影进浮层（目录 / 当前选择变化时都走这里）。 */
    const projectPalette = (): void => {
      if (stage === 'efforts' && stageChoice !== null) {
        palette.sync(effortRows(stageChoice, stageEfforts, data.getSnapshot().current))
        return
      }
      syncRows()
    }

    /** 关掉浮层并退回第一步（成功切换或外部关闭都走这里）。 */
    const closePalette = (): void => {
      palette.close()
      stage = 'models'
      stageChoice = null
      stageEfforts = []
      if (data.getSnapshot().stage !== 'models') data.set({ stage: 'models', stageModel: null })
    }

    /** 进入第二步：候选换成这个模型的思考等级，并选中当前强度。 */
    const enterEfforts = (choice: ModelChoice, efforts: readonly EffortChoice[], modelIndex: number): void => {
      stage = 'efforts'
      stageChoice = choice
      stageEfforts = efforts
      stageModelIndex = modelIndex
      const current = data.getSnapshot().current
      data.set({ stage: 'efforts', stageModel: { provider: choice.provider, model: choice.model }, error: null })
      palette.sync(effortRows(choice, efforts, current))
      palette.open(() => {
        void confirmEffort()
      }, initialEffortIndex(choice, efforts, current))
    }

    /** 确认模型行：这个模型公布了思考等级就进入第二步，否则直接切换。 */
    const confirmModel = async (): Promise<void> => {
      const snapshot = palette.getSnapshot()
      const index = clampIndex(snapshot.activeIndex, snapshot.entries.length)
      const row = index < 0 ? undefined : snapshot.entries[index]
      if (row === undefined) return
      const action = actionOfKey(row.key)
      if (action !== null) {
        await runQuickAction(action)
        return
      }
      const choice = data.getSnapshot().choices.find((candidate) => choiceKey(candidate) === row.key)
      if (choice === undefined) return
      // 目录还在路上时先等一下：不知道这个模型有没有思考等级，就不能贸然跳过第二步。
      const status = data.getSnapshot().catalogStatus
      if (status === 'idle' || status === 'loading') await loadCatalog()
      const efforts = effortChoices(choice, findCatalogModel(data.getSnapshot().catalog, choice))
      if (efforts.length <= 1) {
        if (await selectChoice(choice)) closePalette()
        return
      }
      enterEfforts(choice, efforts, index)
    }

    /** 确认思考等级行：把「模型 + 强度」一起写给 Host。 */
    const confirmEffort = async (): Promise<void> => {
      if (stage !== 'efforts' || stageChoice === null) return
      const snapshot = palette.getSnapshot()
      const index = clampIndex(snapshot.activeIndex, snapshot.entries.length)
      const effort = index < 0 ? undefined : stageEfforts[index]
      if (effort === undefined) return
      if (await selectChoice(selectionOfEffort(stageChoice, effort))) closePalette()
    }

    /** 第二步按 Esc：退回模型列表，并回到刚才确认的那一行。 */
    const backToModels = (): void => {
      if (stage !== 'efforts') return
      stage = 'models'
      stageChoice = null
      stageEfforts = []
      data.set({ stage: 'models', stageModel: null })
      syncRows()
      palette.open(() => {
        void confirmModel()
      }, stageModelIndex)
    }

    /** 打开浮层：总是从模型列表开始，对齐到「当前」那一行，并顺手刷新会话与目录。 */
    const openPalette = (): void => {
      stage = 'models'
      stageChoice = null
      stageEfforts = []
      data.set({ error: null, stage: 'models', stageModel: null })
      const sessionId = refreshSession()
      syncRows()
      const rows = palette.getSnapshot().entries
      let index = currentChoiceIndex(rows)
      // 没有「当前」模型时落在第一行模型上，不要把选中行停在快捷操作上导致回车误触。
      if (index < 0) index = firstModelRowIndex(rows)
      palette.open(() => {
        void confirmModel()
      }, index < 0 ? 0 : index)
      if (sessionId === null) {
        data.set({ error: '当前没有打开的会话：先在左侧栏打开或新建一个会话，再切换模型。' })
      }
      void loadCatalog()
    }

    /**
     * 整份替换设置里的列表。
     * @param next - 新列表。
     * @returns Host 是否接受。
     */
    const writeChoices = async (next: readonly ModelChoice[]): Promise<boolean> => {
      const entry = form
      if (entry === undefined) {
        data.set({ writeError: '设置服务不可用，无法保存模型列表。' })
        return false
      }
      data.set({ writing: true, writeError: null })
      try {
        const value = next.map((choice) => ({
          provider: choice.provider,
          model: choice.model,
          ...choice.reasoningEffort === undefined ? {} : { reasoningEffort: choice.reasoningEffort },
        }))
        // 上游 `SettingsPathOpView['value']` 是 `JsonValue`：可选字段在类型层是 `string | undefined`，
        // 但条件展开让它在值对象里缺席，运行期仍是合法 JSON，边界处一次性收窄。
        const ops: readonly SettingsPathOpView[] = [{ op: 'set', path: ['models'], value: value as unknown as JsonValue }]
        const accepted = await entry.mutate(ops)
        if (!accepted) data.set({ writeError: 'Host 拒绝了这次写入：设置不可写，或列表没有通过校验。' })
        return accepted
      } catch (error) {
        data.set({ writeError: `保存失败：${messageOf(error)}` })
        return false
      } finally {
        data.set({ writing: false })
      }
    }

    const actions: SettingsActions = {
      loadCatalog,
      async add(choice) {
        const current = data.getSnapshot().choices
        const next = addChoice(current, choice)
        if (next === current) return
        await writeChoices(next)
      },
      async remove(choice) {
        const current = data.getSnapshot().choices
        const next = removeChoice(current, choice)
        if (next === current) return
        await writeChoices(next)
      },
    }

    // 数据一变就重投影当前步骤的浮层行（设置里增删、目录加载完成、当前会话切换都会走到这里）。
    scope.effect(() => data.subscribe(projectPalette), `${name}: row projection`)
    scope.effect(installStyleTag, `${name}: styles`)

    // 固定行要先挂载，固定输入观察者才读得到它。
    scope.effect(() => {
      const command: ShortcutFixedCommand = {
        id: MODEL_SWITCH_ID,
        label: () => '模型快速切换',
        keys: modelSwitchKeys(platform),
        bindings: [MODEL_SWITCH_BINDING],
        group: 'application',
      }
      try {
        return shortcuts.registerFixed(command)
      } catch (error) {
        warn(`固定行注册失败（${command.keys.join('+')} 未占用）：`, error)
        // 没注册成功就没有要撤的东西；effect 契约要求交回一个清理函数，给个空动作。
        return () => {}
      }
    }, `${name}: model switch fixed row`)

    scope.effect(
      () => shortcuts.observeFixedInput((input) => {
        if (!ownedModelSwitch(shortcuts, platform, fixedGesture(input))) return
        // 先收归本插件，再开浮层：consume() 一调用，平台就不会把同一次组合键再执行一遍。
        consumeFixedInput(input)
        openPalette()
      }),
      `${name}: model switch key`,
    )

    // 全局捕获那一半：固定通道挂在 window 冒泡上，页面里任何一处 stopPropagation（终端、
    // 模态、编辑器）都会让它收不到。这里在 window 捕获阶段先判定，命中就吞掉这一按再开浮层；
    // 捕获先跑并 stopPropagation，固定通道收不到同一按，所以不会开两次。聚焦在 composer、
    // 设置页或终端里都一样生效。
    scope.effect(() => {
      if (typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        if (!ownedModelSwitch(shortcuts, platform, keyGesture(event))) return
        event.preventDefault()
        event.stopPropagation()
        openPalette()
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: model switch capture`)

    // 浮层：注册进 shell.overlay，等 ui-layout 声明该槽。
    scope.effect(() => {
      let disposeOverlay: (() => void) | undefined
      slots.inject('shell.overlay', () => {
        disposeOverlay = slots.register(
          {
            name: 'shell.overlay',
            id: name,
            order: 70,
            // 业务 props 只能由 inject 交出来：渲染器对条目做的是 jsx(entry.component, props)。
            inject: () => ({ store: palette, data, view: MODEL_VIEW, effortView: EFFORT_VIEW, onBack: backToModels }),
          },
          ModelOverlay,
        )
        return () => {
          disposeOverlay?.()
          disposeOverlay = undefined
        }
      })
      return () => {
        disposeOverlay?.()
      }
    }, `${name}: model overlay`)

    // 设置页：注册进 settings.section（由 ui-settings-general 声明）。
    scope.effect(() => {
      let disposeSection: (() => void) | undefined
      slots.inject('settings.section', () => {
        disposeSection = slots.register(
          {
            name: 'settings.section',
            id: SETTINGS_SECTION_ID,
            order: SETTINGS_SECTION_ORDER,
            label: () => '模型快速切换',
            inject: () => ({ data, actions }),
          },
          ModelSettingsSection,
        )
        return () => {
          disposeSection?.()
          disposeSection = undefined
        }
      })
      return () => {
        disposeSection?.()
      }
    }, `${name}: model settings section`)

    // 设置文档晚到也能补上：configForms 一就位就读命名空间，并跟随它的快照。
    scope.inject(['configForms'], (inner) => {
      const forms = readConfigForms(inner)
      if (forms === undefined) return
      let entry: ConfigForm<unknown>
      try {
        entry = forms.get(CONFIG_ENTRY_ID)
      } catch (error) {
        warn(`读取设置命名空间失败：${messageOf(error)}`)
        return
      }
      form = entry
      inner.effect(() => () => {
        if (form !== entry) return
        form = undefined
        // 服务被撤下时不要把旧列表留在界面上：下一次打开浮层会读到一个空列表。
        refreshChoices()
      }, `${name}: config form release`)
      const publish = (): void => {
        refreshChoices()
      }
      publish()
      inner.effect(() => entry.subscribe(publish), `${name}: config form subscription`)
    })

    // 远程命名空间晚到也能补上：模型目录与模型选择都走 `remote.session`。
    // 只 `scope.get('remote')` 不够 —— `session` 是带 inject 守卫的生成访问器。
    scope.inject(['remote', 'remote.session'], (inner) => {
      const remote = readRemote(inner)
      const session = remote?.session
      if (session === undefined) return
      sessionRemote = session
      inner.effect(() => () => {
        if (sessionRemote !== session) return
        sessionRemote = undefined
        // 链路被撤下时别把旧目录当成可用：下一次打开浮层会重新走失败提示。
        data.set({ catalogStatus: 'error', catalogError: '模型目录服务不可用（remote.session 已断开）。' })
      }, `${name}: remote session release`)
      // 设置页/浮层可能先因为链路未就绪落到 error：链路一到就补拉一次。
      if (data.getSnapshot().catalogStatus !== 'ready') void loadCatalog()
    })

    // 工作树快捷操作走 forge 面板；链路晚到或没装 forge 时整行隐藏（没有 Git 检查就无从判断）。
    scope.inject(['remote', 'remote.forgePanel'], (inner) => {
      const remote = readRemote(inner)
      const panel = remote?.forgePanel
      if (panel === undefined) return
      forgePanelRemote = panel
      startForgeFollow(data.getSnapshot().sessionId)
      inner.effect(() => () => {
        if (forgePanelRemote !== panel) return
        forgePanelRemote = undefined
        forgePanelStream?.dispose()
        forgePanelStream = undefined
        forgePanelStreamSession = null
        data.set({ actionPending: null, checkout: null })
        syncRows()
      }, `${name}: forge panel release`)
      syncRows()
    })

    // 团队协作快捷操作走 agentTeams；同样允许晚到，缺席时只是行上写明不可用。
    scope.inject(['remote', 'remote.agentTeams'], (inner) => {
      const remote = readRemote(inner)
      const agentTeams = remote?.agentTeams
      if (agentTeams === undefined) return
      agentTeamsRemote = agentTeams
      inner.effect(() => () => {
        if (agentTeamsRemote !== agentTeams) return
        agentTeamsRemote = undefined
        data.set({ actionPending: null })
        syncRows()
      }, `${name}: agent teams release`)
      syncRows()
    })

    // 会话目录晚到也能补上：主视图会话与 `modelSelection` 投影都从这里来。
    scope.inject(['sessions'], (inner) => {
      const sessions = readSessions(inner)
      if (sessions === undefined) return
      refreshSession()
      if (typeof sessions.list.subscribe === 'function') {
        inner.effect(() => sessions.list.subscribe(refreshSession), `${name}: session selection`)
      }
    })

    // 首次读：configForms 若比本插件晚到位，这里先落一个「不可用」，等子 fiber 再改。
    refreshChoices()
  })
}

/** 浮层本体：只在 `open` 为真时渲染；开着的时候按捕获阶段收到的按键动作。 */
export function ModelOverlay(props: OverlayProps): React.ReactElement | null {
  const { store, data, view: modelView, effortView, onBack } = props
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const dataState = React.useSyncExternalStore(data.subscribe, data.getSnapshot, data.getSnapshot)
  const stage = dataState.stage
  const view = stage === 'efforts' && effortView !== undefined ? effortView : modelView
  const stagePresentation = dataState.stageModel === null
    ? undefined
    : choicePresentation(dataState.stageModel, dataState.catalog)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const open = state.open
  const entries = state.entries
  const activeIndex = clampIndex(state.activeIndex, entries.length)
  const offset = clampOffset(state.offset, entries.length)
  const visible = windowSlice(entries, offset)
  const activeEntry = activeIndex < 0 ? undefined : entries[activeIndex]
  const enterHint = activeEntry !== undefined && actionOfKey(activeEntry.key) !== null
    ? 'Enter 执行'
    : view.enterHint

  React.useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
  }, [open])

  // 选中行必须留在可见范围：窗口不够高时列表只在内部滚动，键盘把选中行移出视口等于「看不见」。
  React.useEffect(() => {
    if (!open) return
    const list = listRef.current
    keepOptionVisible(activeIndex < 0 ? null : list?.querySelector(`#${optionDomId(view, activeIndex)}`))
  }, [open, activeIndex, view])

  React.useEffect(
    () => installPaletteKeys(store, document, undefined, stage === 'efforts' && onBack !== undefined ? { back: onBack } : {}),
    [store, stage, onBack],
  )

  // 滚轮按行滑动窗口（一格一行），不改选中行；挂在整个浮层上，指针偏到遮罩留白也归浮层。
  React.useEffect(() => {
    if (!open) return
    return installPaletteWheel(rootRef.current, (rows) => store.slide(rows))
  }, [open, store])

  if (!open) return null

  const children: React.ReactNode[] = [
    React.createElement('div', { key: 'backdrop', className: 'dsh-model-quick-switch-backdrop' }),
    React.createElement(
      'div',
      {
        key: 'panel',
        ref: panelRef,
        className: 'dsh-model-quick-switch-panel',
        tabIndex: -1,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': view.title,
      },
      React.createElement(
        'div',
        { key: 'head', className: 'dsh-model-quick-switch-head' },
        React.createElement('span', { key: 'title', className: 'dsh-model-quick-switch-title' }, view.title),
        React.createElement(
          'span',
          { key: 'count', className: 'dsh-model-quick-switch-count' },
          entries.length === 0 ? view.emptyCount : paletteCountLabel(view, entries, offset),
        ),
      ),
      stagePresentation === undefined
        ? null
        : React.createElement(
            'div',
            { key: 'subhead', className: 'dsh-model-quick-switch-subhead' },
            `模型：${stagePresentation.title} · ${stagePresentation.subtitle}`,
          ),
      entries.length === 0
        ? React.createElement(
            'div',
            { key: 'empty', className: 'dsh-model-quick-switch-empty' },
            view.emptyHint,
          )
        : React.createElement(
            'div',
            {
              key: 'list',
              ref: listRef,
              className: 'dsh-model-quick-switch-list',
              role: 'listbox',
              'aria-label': view.listLabel,
              'aria-activedescendant': optionDomId(view, activeIndex),
            },
            visible.map((entry, index) => optionElement(store, view, entry, offset + index, offset + index === activeIndex)),
          ),
      // 状态区始终占一行高：切换工作树 / 团队协作时浮层不增不减，面板不会因这一行出现
      // 或消失而在视口里上下跳一下（浮层是居中的，高度一变整块就平移）。快捷操作不显示
      // 中间态：开关成功与否只用行上的角标与副标题体现，状态区只留给模型切换与错误。
      React.createElement(
        'div',
        { key: 'status', className: 'dsh-model-quick-switch-status' },
        dataState.pending
          ? React.createElement('span', { key: 'pending', className: 'dsh-model-quick-switch-pending' }, '正在切换模型…')
          : null,
        dataState.error === null
          ? null
          : React.createElement('span', { key: 'error', className: 'dsh-model-quick-switch-error', role: 'alert' }, dataState.error),
      ),
      React.createElement(
        'div',
        { key: 'foot', className: 'dsh-model-quick-switch-foot' },
        React.createElement('span', { key: 'move' }, '↑ ↓ 选择'),
        entries.length > PAGE_SIZE
          ? React.createElement('span', { key: 'page' }, '← → 翻一屏')
          : null,
        React.createElement('span', { key: 'enter' }, enterHint),
        React.createElement('span', { key: 'esc' }, stage === 'efforts' ? 'Esc 返回' : 'Esc 关闭'),
      ),
    ),
  ]

  return React.createElement(
    'div',
    { ref: rootRef, className: 'dsh-model-quick-switch-overlay', [view.rootAttr]: '' },
    children,
  )
}

/** 一行候选项。 */
function optionElement(
  store: PaletteStore,
  view: PaletteView,
  entry: PaletteRow,
  index: number,
  active: boolean,
): React.ReactElement {
  const label = entry.title === '' ? entry.key : entry.title
  const badges = entry.badges ?? []
  const action = actionOfKey(entry.key)
  return React.createElement(
    'button',
    {
      key: entry.key,
      type: 'button',
      id: optionDomId(view, index),
      role: 'option',
      className: 'dsh-model-quick-switch-option',
      'aria-selected': active ? 'true' : 'false',
      [PALETTE_OPTION_ATTR]: '',
      // 稳定身份（列表项的复合 key）：人工排查与自动化验证按它定位行。
      'data-palette-key': entry.key,
      'data-active': active ? 'true' : 'false',
      ...action === null ? {} : { 'data-action': action },
      onClick: () => {
        store.select(index)
        const binding = store.getSnapshot().binding
        if (binding !== null) binding()
      },
    },
    React.createElement('span', { key: 'index', className: 'dsh-model-quick-switch-index' }, `${index + 1}`),
    React.createElement(
      'span',
      { key: 'texts', className: 'dsh-model-quick-switch-texts' },
      React.createElement(
        'span',
        { key: 'label', className: 'dsh-model-quick-switch-label' },
        React.createElement('span', { key: 'name', className: 'dsh-model-quick-switch-name' }, label),
        entry.current === true
          ? React.createElement('span', { key: 'current', className: 'dsh-model-quick-switch-current' }, '当前')
          : null,
        badges.map((badge) => React.createElement(
          'span',
          { key: `badge:${badge}`, className: 'dsh-model-quick-switch-badge', 'data-badge': badge },
          badge,
        )),
      ),
      React.createElement('span', { key: 'path', className: 'dsh-model-quick-switch-path' }, entry.subtitle),
    ),
    active
      ? React.createElement('span', { key: 'enter', className: 'dsh-model-quick-switch-enter' }, 'Enter')
      : null,
  )
}

/**
 * 设置页：「列表里有什么」+「从目录里添加」。
 *
 * 列表与浮层候选是同一份数据（`ctx.configForms` 的 `models` 字段），所以这里增删一条，
 * 浮层下一次打开（以及开着的那张）立刻跟着变。写入进行中禁用所有增删按钮，失败时在页面上
 * 显示 Host 的拒绝原因。
 */
export function ModelSettingsSection(props: SettingsProps): React.ReactElement {
  const state = React.useSyncExternalStore(props.data.subscribe, props.data.getSnapshot, props.data.getSnapshot)
  const [addOpen, setAddOpen] = React.useState(false)
  const { actions } = props

  // 打开设置页就拉一次目录（目录可能比页面挂载晚就绪，失败时页面给重试入口）。
  React.useEffect(() => {
    void actions.loadCatalog()
  }, [actions])

  const groups = orderCatalogGroups(state.groups)
  const effective = state.current ?? state.defaultSelection
  const currentPresentation = effective === null ? undefined : choicePresentation(effective, state.catalog)
  const busy = state.writing || state.pending
  const disabled = busy || !state.writable

  const children: React.ReactNode[] = [
    React.createElement(
      'div',
      { key: 'head' },
      React.createElement('h2', { key: 'title', className: 'dsh-model-quick-switch-settings-title' }, '模型快速切换'),
      React.createElement(
        'p',
        { key: 'intro', className: 'dsh-model-quick-switch-settings-intro' },
        '按 ⌘⌥U（Windows / Linux 上是 Ctrl+Alt+U）打开快捷菜单：顶部两行是「新建工作树」与「团队协作」开关，生效于当前会话；下面是模型列表，先选模型，模型公布了思考等级时再选一档，最后切换当前会话使用的模型。下面这份列表就是模型候选，顺序与浮层一致。',
      ),
      React.createElement(
        'p',
        { key: 'current', className: 'dsh-model-quick-switch-settings-intro' },
        currentLine(state, currentPresentation),
      ),
    ),
    React.createElement(
      'div',
      { key: 'list-section' },
      React.createElement(
        'div',
        { key: 'heading', className: 'dsh-model-quick-switch-settings-heading' },
        React.createElement('h3', { key: 'subtitle', className: 'dsh-model-quick-switch-settings-subtitle' }, '浮层里的模型'),
        React.createElement('span', { key: 'hint', className: 'dsh-model-quick-switch-settings-hint' }, `${state.choices.length} 个`),
      ),
      state.configStatus === 'unavailable'
        ? React.createElement(
            'p',
            { key: 'unavailable', className: 'dsh-model-quick-switch-settings-empty' },
            '当前 DSH 没有提供本插件的设置命名空间（dsh-model-quick-switch 未启用或被组合排除），无法保存模型列表。',
          )
        : state.configStatus === 'loading'
          ? React.createElement('p', { key: 'loading', className: 'dsh-model-quick-switch-settings-empty' }, '正在读取设置…')
          : state.choices.length === 0
            ? React.createElement(
                'p',
                { key: 'empty', className: 'dsh-model-quick-switch-settings-empty' },
                '还没有添加模型。点下面的「添加模型」从当前模型目录里挑，添加后按快捷键就能选它。',
              )
            : React.createElement(
                'ul',
                { key: 'rows', className: 'dsh-model-quick-switch-settings-list' },
                state.choices.map((choice) => choiceSettingsRow(choice, state, state.catalogStatus === 'ready', disabled, actions)),
              ),
      state.writable ? null : React.createElement(
        'p',
        { key: 'readonly', className: 'dsh-model-quick-switch-settings-note' },
        '当前设置文档是只读的，添加与删除已禁用。',
      ),
    ),
    React.createElement(
      'div',
      { key: 'add-section' },
      React.createElement(
        'div',
        { key: 'actions', className: 'dsh-model-quick-switch-settings-actions' },
        React.createElement(
          'button',
          {
            key: 'toggle',
            type: 'button',
            className: 'dsh-model-quick-switch-settings-button',
            'aria-expanded': addOpen ? 'true' : 'false',
            onClick: () => setAddOpen(!addOpen),
          },
          addOpen ? '收起模型目录' : '添加模型',
        ),
        React.createElement(
          'button',
          {
            key: 'refresh',
            type: 'button',
            className: 'dsh-model-quick-switch-settings-button',
            disabled: busy || state.catalogStatus === 'loading',
            onClick: () => {
              void actions.loadCatalog()
            },
          },
          state.catalogStatus === 'loading' ? '正在加载目录…' : '刷新模型目录',
        ),
        state.catalogError === null
          ? null
          : React.createElement('span', { key: 'catalog-error', className: 'dsh-model-quick-switch-settings-error', role: 'alert' }, state.catalogError),
      ),
      state.writeError === null
        ? null
        : React.createElement('p', { key: 'write-error', className: 'dsh-model-quick-switch-settings-error', role: 'alert' }, state.writeError),
      addOpen ? catalogPicker(groups, state.catalog, state.choices, state.catalogStatus, disabled, actions) : null,
    ),
  ]

  return React.createElement(
    'div',
    { className: 'dsh-model-quick-switch-settings', [SETTINGS_ROOT_ATTR]: '' },
    children,
  )
}

/**
 * 设置页顶部那句「当前使用什么」。
 *
 * 三种读数分开说：没有会话、会话没有显式选择（跟随目录默认）、会话有显式选择。
 * @param state - 数据快照。
 * @param presentation - 当前有效选择（显式或默认）的显示名。
 * @returns 一行说明。
 */
function currentLine(
  state: { readonly sessionId: string | null; readonly current: ModelSelectionLike | null },
  presentation: ReturnType<typeof choicePresentation> | undefined,
): string {
  if (state.sessionId === null) return '当前没有打开的会话。'
  if (presentation === undefined) return '当前会话：还没有选择模型，模型目录也没有给出默认值。'
  const detail = `${presentation.title} · ${presentation.subtitle}`
  return state.current === null ? `当前会话：跟随默认（${detail}）` : `当前会话：${detail}`
}

/** 设置页里的一行已添加模型。 */
function choiceSettingsRow(
  choice: ModelChoice,
  state: { readonly catalog: readonly CatalogModelRow[]; readonly current: ModelSelectionLike | null },
  catalogReady: boolean,
  disabled: boolean,
  actions: SettingsActions,
): React.ReactElement {
  const presentation = choicePresentation(choice, state.catalog)
  const isCurrent = state.current !== null
    && state.current.provider === choice.provider
    && state.current.model === choice.model
    && (choice.reasoningEffort === undefined || choice.reasoningEffort === state.current.reasoningEffort)
  return React.createElement(
    'li',
    { key: choiceKey(choice), className: 'dsh-model-quick-switch-settings-row' },
    React.createElement(
      'div',
      { className: 'dsh-model-quick-switch-settings-texts' },
      React.createElement(
        'span',
        { className: 'dsh-model-quick-switch-settings-name' },
        React.createElement('span', { className: 'dsh-model-quick-switch-settings-name-text' }, presentation.title),
        isCurrent ? React.createElement('span', { className: 'dsh-model-quick-switch-settings-current' }, '当前') : null,
        catalogReady && !presentation.known
          ? React.createElement('span', { className: 'dsh-model-quick-switch-settings-badge' }, '目录外')
          : null,
      ),
      React.createElement(
        'span',
        { className: 'dsh-model-quick-switch-settings-id' },
        presentation.subtitle,
      ),
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-model-quick-switch-settings-button dsh-model-quick-switch-settings-button-danger',
        disabled,
        'aria-label': `从列表删除 ${presentation.title}`,
        onClick: () => {
          void actions.remove(choice)
        },
      },
      '删除',
    ),
  )
}

/** 目录里一个模型的副标题：模型 id，附带适配器公布的推理强度名单。 */
function modelSubtitle(model: CatalogGroup['models'][number]): string {
  const efforts = model.reasoning?.efforts ?? []
  if (efforts.length === 0) return model.id
  return `${model.id} · ${efforts.map((effort) => effort.name ?? effort.id).join(' / ')}`
}

/**
 * 目录角标的可显示文本。
 *
 * 上游 `ModelCatalogModel['badge']` 的 `text` 是 `LocalizedText`（字符串或按语言分键）；
 * 设置页只画一行，按 `en` 兜底，避免把结构对象直接交给 React。
 */
function badgeText(badge: CatalogModelRow['badge']): string {
  if (badge === undefined) return ''
  return typeof badge.text === 'string' ? badge.text : badge.text.en
}

/** 「添加模型」面板：按提供方分组列出目录里的模型。 */
function catalogPicker(
  groups: readonly CatalogGroup[],
  catalog: readonly CatalogModelRow[],
  choices: readonly ModelChoice[],
  status: 'idle' | 'loading' | 'ready' | 'error',
  disabled: boolean,
  actions: SettingsActions,
): React.ReactElement {
  if (groups.length === 0) {
    const message = status === 'loading'
      ? '正在加载模型目录…'
      : '模型目录为空：先在「设置 → 模型」里配置提供方与 API 密钥。'
    return React.createElement(
      'div',
      { className: 'dsh-model-quick-switch-settings-catalog' },
      React.createElement('p', { className: 'dsh-model-quick-switch-settings-note' }, message),
    )
  }
  return React.createElement(
    'div',
    { className: 'dsh-model-quick-switch-settings-catalog' },
    groups.map((group) => React.createElement(
      'div',
      { key: group.id, className: 'dsh-model-quick-switch-settings-group' },
      React.createElement('h4', { className: 'dsh-model-quick-switch-settings-group-title' }, group.name ?? group.id),
      group.models.length === 0
        ? React.createElement('p', { className: 'dsh-model-quick-switch-settings-note' }, '这个提供方没有可用模型。')
        : group.models.map((model) => {
            const presentation = choicePresentation({ provider: group.id, model: model.id }, catalog)
            const added = choices.some((choice) => choice.provider === group.id && choice.model === model.id)
            return React.createElement(
              'div',
              { key: model.id, className: 'dsh-model-quick-switch-settings-model' },
              React.createElement(
                'div',
                { className: 'dsh-model-quick-switch-settings-model-texts' },
                React.createElement(
                  'span',
                  { className: 'dsh-model-quick-switch-settings-model-name' },
                  React.createElement('span', { className: 'dsh-model-quick-switch-settings-model-name-text' }, presentation.title),
                  model.badge === undefined
                    ? null
                    // 上游 0.2.2-rc.2 的角标是 `{ text, tone }` 结构，本设置的展示槽只画一行文本。
                    : React.createElement('span', { className: 'dsh-model-quick-switch-settings-badge' }, badgeText(model.badge)),
                ),
                React.createElement('span', { className: 'dsh-model-quick-switch-settings-model-id' }, modelSubtitle(model)),
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsh-model-quick-switch-settings-button',
                  disabled: disabled || added,
                  onClick: () => {
                    void actions.add({ provider: group.id, model: model.id })
                  },
                },
                added ? '已添加' : '添加',
              ),
            )
          }),
    )),
  )
}
