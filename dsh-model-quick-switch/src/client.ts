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
import {
  EMPTY_TEAM_FACTS,
  EMPTY_WORKTREE_FACTS,
  actionOfKey,
  checkoutStateOf,
  firstModelRowIndex,
  quickActionRows,
  sameTeamFacts,
  sameWorktreeFacts,
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
  bindingPress,
  clampIndex,
  createPaletteStore,
  inRange,
  modelSwitchKeys,
  type ModelSwitchGesture,
  type PaletteStore,
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
import {
  ModelOverlay,
  ModelSettingsSection,
  type SettingsActions,
} from './components.tsx'
import { NS, en, modelTextsOf, quickActionTextsOf, translateZh, zh } from './locales.ts'
import { effortView, modelView } from './views.ts'

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
// （`settings.section` 键、`modelSelection` 投影键随上面同包的命名导入生效。）
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-forge/remote'
import type {} from '@deepseek-ai/dsh-agent-team/remote'
import type {} from '@deepseek-ai/dsh-agent-team/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

export { name }
export { paletteAction } from './palette.ts'

/** 浮层依赖的三个客户端服务；slots / shortcuts 任一缺席就整体不安装，locale 缺席时退回简体中文。 */
export const inject = ['slots', 'shortcuts', 'locale']

/** 设置页的分区 id（也用于图标寻址）。 */
export const SETTINGS_SECTION_ID = name

/** 设置页在导航里的顺序：排在「模型」（10）与「插件」（900）之间，靠后但不垫底。 */
export const SETTINGS_SECTION_ORDER = 70

/** 本插件在 profile 里的条目 id —— 也就是设置命名空间 / `configForms.get` 的键。 */
export const CONFIG_ENTRY_ID = name

/**
 * 目录已经在手上时，两次自动刷新之间的最小间隔。
 *
 * 一次 `remote.session.modelCatalog()` 在 Host 上要重建整份目录（每个提供方一次模型列表、
 * 每个模型一次 `resolveModelInfo`，其中含网络请求），所以打开浮层这种高频动作不能每次都发；
 * 设置页的「刷新模型目录」用 `force` 跳过去抖。
 */
const CATALOG_FRESH_MS = 60_000

/** 安装一条样式表（浮层 + 设置页）。 */
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

/** 从注入面读 locale 服务（字典注册与翻译）。 */
function readLocale(scope: Context): Context['locale'] | undefined {
  const value = scope.get('locale')
  if (typeof value !== 'object' || value === null) return undefined
  if (typeof value.bind !== 'function' || typeof value.register !== 'function') return undefined
  return value as Context['locale']
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

/** 与上游键盘适配器一致：isComposing、旧 keyCode 229、AltGraph 都算组合输入。 */
function isComposingEvent(event: KeyboardEvent): boolean {
  if (event.isComposing === true) return true
  if (event.keyCode === 229) return true
  return typeof event.getModifierState === 'function' && event.getModifierState('AltGraph') === true
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
    composing: isComposingEvent(event),
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

    // 可见文案走 Client locale；字典登记在 scope 上，随插件 fiber 卸载一起撤回。
    // locale 服务缺席（受限环境 / 测试桩）时退回简体中文字典。
    const locale = readLocale(scope)
    if (locale !== undefined) {
      scope.effect(() => locale.register(NS, { zh, en }), `${name}: dictionaries`)
    }
    const t = locale === undefined ? translateZh : locale.bind(NS)
    const quickActionTexts = quickActionTextsOf(t)
    const modelTexts = modelTextsOf(t)
    const modelPaletteView = modelView(t)
    const effortPaletteView = effortView(t)

    const data = createModelDataStore()
    const palette = createPaletteStore()
    let form: ConfigForm<unknown> | undefined
    // `remote.session` 是生成出来的命名空间：没在 fiber 的 inject 里声明就直接读会抛
    // 「cannot get property "remote.session" without inject」，所以先等子 fiber 把它接上。
    let sessionRemote: Context['remote']['session'] | undefined
    // 快捷操作的两条链路各自晚到：forge 面板负责工作树请求与 Git 检查，团队服务负责 agentTeam 开关。
    let forgePanelRemote: Context['remote']['forgePanel'] | undefined
    let agentTeamsRemote: Context['remote']['agentTeams'] | undefined
    // 只为「当前目录是不是 Git 仓库」与工作树请求维持一条 forge 面板状态流；会话切换时换一条。
    let forgePanelStream: RemoteStreamHandle<ForgePanelState, never> | undefined
    let forgePanelStreamSession: SessionId | null = null
    /**
     * 写入成功后的乐观读数。旧投影可能在响应之后才追上：在它变成我们写入的目标之前，
     * 用它挡住旧值，否则关闭浮层再打开会把开关显示回旧状态。推来第三种值说明别处又改过
     * 设置，这时撤掉覆盖、交给新读数。
     */
    let worktreeOverride: {
      readonly sessionId: SessionId
      readonly baseline: WorktreeFacts
      readonly target: WorktreeFacts
    } | null = null
    let teamOverride: {
      readonly sessionId: SessionId
      readonly baseline: TeamFacts
      readonly target: TeamFacts
    } | null = null
    let catalogInFlight: Promise<void> | undefined
    /** 最近一次目录加载成功的时刻；`0` 表示还没成功过。 */
    let catalogLoadedAt = 0
    // 浮层的两步：先选模型，确认后再把候选换成这个模型的思考等级。
    let stage: PaletteStage = 'models'
    let stageChoice: ModelChoice | null = null
    let stageEfforts: readonly EffortChoice[] = []
    let stageModelIndex = 0
    /**
     * 浮层代次：每次打开、关闭、或从思考等级退回模型列表都 +1。
     *
     * 一次确认请求可能跨过「用户关掉浮层又重开」：回来时只看 `open` 分不清这是不是同一次
     * 打开，就会把用户刚重开的那张浮层关掉。代次只在「打开 / 关闭 / 退回」时变，
     * 同一会话里的正常成功不会失效。
     */
    let paletteEpoch = 0
    /** 模型切换请求的代次：只有最后一次请求有权清 pending / 写结果。 */
    let selectEpoch = 0

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

    /** 会话切换时丢弃上一条会话的乐观覆盖。 */
    const clearActionOverrides = (): void => {
      worktreeOverride = null
      teamOverride = null
    }

    /**
     * 把面板流 / 会话目录推来的工作树状态与刚写入的目标对齐。
     *
     * 写前旧值（baseline）或「未知」都保留目标；写成目标后撤掉覆盖；第三种值代表别处改过，
     * 直接采用新读数。
     * @param observed - 这一次推来的工作树事实。
     * @returns 浮层应显示的事实。
     */
    const reconcileWorktree = (observed: WorktreeFacts | null): WorktreeFacts | null => {
      const override = worktreeOverride
      if (override === null) return observed
      // 第二道防线：覆盖只对写入它的那条会话有效。第一道在 runQuickAction 收尾时
      // （会话已切走的响应整条丢弃）；这里再挡一次「覆盖晚到、当前会话已经换了」。
      if (override.sessionId !== data.getSnapshot().sessionId) {
        worktreeOverride = null
        return observed
      }
      const current = observed ?? EMPTY_WORKTREE_FACTS
      if (sameWorktreeFacts(current, override.target)) {
        worktreeOverride = null
        return observed
      }
      if (sameWorktreeFacts(current, override.baseline)) return override.target
      worktreeOverride = null
      return observed
    }

    /**
     * 把会话目录推来的团队状态与刚写入的目标对齐（规则同 {@link reconcileWorktree}）。
     * @param observed - 这一次推来的团队事实。
     * @returns 浮层应显示的事实。
     */
    const reconcileTeam = (observed: TeamFacts | null): TeamFacts | null => {
      const override = teamOverride
      if (override === null) return observed
      // 同 reconcileWorktree：会话已经换了就丢弃上一条会话的覆盖读数。
      if (override.sessionId !== data.getSnapshot().sessionId) {
        teamOverride = null
        return observed
      }
      const current = observed ?? EMPTY_TEAM_FACTS
      if (sameTeamFacts(current, override.target)) {
        teamOverride = null
        return observed
      }
      if (sameTeamFacts(current, override.baseline)) return override.target
      teamOverride = null
      return observed
    }

    /**
     * 为「当前目录是不是 Git 仓库」维持一条 forge 面板状态流。
     *
     * 同时读 `checkout.state` 与 `worktree`：`none` 时工作树那一行整行隐藏，工作树行与
     * hero 勾选框读同一份 `worktree.request` / `worktree.created`。会话切换就换一条流；
     * 流断开时保留最后一次读数（不把 Git 仓库误判成非仓库）。
     * @param sessionId - 当前主视图会话；没有会话时为 null。
     */
    const startForgeFollow = (sessionId: SessionId | null): void => {
      forgePanelStream?.dispose()
      forgePanelStream = undefined
      forgePanelStreamSession = sessionId
      data.set({
        checkout: null,
        worktree: worktreeOverride?.sessionId === sessionId ? worktreeOverride.target : null,
      })
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
            const worktree = worktreeFacts(frame.worktree)
            const patch: { checkout?: CheckoutState; worktree?: WorktreeFacts | null } = {}
            if (checkout !== null && checkout !== data.getSnapshot().checkout) patch.checkout = checkout
            if (worktree !== null) {
              const next = reconcileWorktree(worktree)
              if (!sameWorktreeFacts(next, data.getSnapshot().worktree)) patch.worktree = next
            }
            if (Object.keys(patch).length > 0) data.set(patch)
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
      const previousId = data.getSnapshot().sessionId
      const sessions = readSessions(scope)
      const snapshot: SessionListState | undefined = sessions?.list.getSnapshot()
      if (snapshot === undefined) {
        clearActionOverrides()
        data.set({ sessionId: null, current: null, worktree: null, team: null, actionPending: null, pending: false })
        syncForgeFollow(null)
        return null
      }
      const id = snapshot.ids.find((candidate) => (snapshot.byId[candidate]?.retainedBy?.mainView ?? 0) > 0)
      if (id === undefined) {
        clearActionOverrides()
        data.set({ sessionId: null, current: null, worktree: null, team: null, actionPending: null, pending: false })
        syncForgeFollow(null)
        return null
      }
      // 换会话时旧会话的乐观覆盖与进行中的快捷操作都必须丢掉；同一会话重读时保留，直到
      // 投影追上或出现新值。进行中的模型切换由 selectChoice 自己按会话收尾（见那里的守卫）。
      const changed = previousId !== id
      if (changed) clearActionOverrides()
      const summary: SessionSummary | undefined = snapshot.byId[id]
      const values = summary?.projectionValues
      const projection: ModelSelectionProjection | undefined = values?.modelSelection
      // 工作树改由 forge 面板流提供（见 startForgeFollow）；会话目录只负责团队投影。
      data.set({
        sessionId: id,
        current: projection?.next ?? projection?.lastUsed ?? null,
        team: reconcileTeam(teamFacts(values?.agentTeam)),
        ...(changed ? { actionPending: null, pending: false } : {}),
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
      }, quickActionTexts)
      const models = choiceRows(state.choices, state.catalog, current, {
        catalogReady: state.catalogStatus === 'ready',
        texts: modelTexts,
      })
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

    /** 手里是否已经有一份可用的目录（`ready` 但一组提供方都没有也算：那是「加载过、确实为空」）。 */
    const hasCatalog = (): boolean => {
      const state = data.getSnapshot()
      return state.catalogStatus === 'ready' || state.groups.length > 0 || state.catalog.length > 0
    }

    /**
     * 拉一次 Host 模型目录；并发调用共用同一次请求。
     *
     * 已经有目录时只做**后台刷新**：`catalogStatus` 留在 `ready`，等着它的路径（确认模型、行
     * 投影）继续用上一次的读数，刷新结果到了再原地换。只有一份目录都没有时才进入 `loading`
     * 并让调用方等 —— 那时没有旧读数可用，等是唯一的选择。
     *
     * 后台刷新失败保留上一次目录，只把原因写进 `catalogError`：一次网络抖动不该让「目录外」
     * 角标消失、也不该让浮层把可用模型显示成不可用。
     * @param options - `force` 为 true 时忽略 {@link CATALOG_FRESH_MS}（设置页的手动刷新）。
     * @returns 这一次请求的完成；被去抖跳过或服务缺席时立刻完成。
     */
    const loadCatalog = (options: { readonly force?: boolean } = {}): Promise<void> => {
      if (catalogInFlight !== undefined) return catalogInFlight
      const background = hasCatalog()
      const modelCatalog = sessionRemote?.modelCatalog
      if (sessionRemote === undefined || typeof modelCatalog !== 'function') {
        // 已经有目录时链路断开的说法由 `remote.session` 的释放回调负责，这里不改写可用目录。
        if (background) return Promise.resolve()
        data.set({ catalogStatus: 'error', catalogError: t('errCatalogUnavailable') })
        return Promise.resolve()
      }
      if (background && options.force !== true && Date.now() - catalogLoadedAt < CATALOG_FRESH_MS) {
        return Promise.resolve()
      }
      data.set(background ? { catalogRefreshing: true } : { catalogStatus: 'loading', catalogError: null })
      const operation = (async (): Promise<void> => {
        try {
          const response: RemoteResult<ModelCatalog> = await modelCatalog.call(sessionRemote)
          if (!response.ok) {
            const message = describeRemoteFailure(response.error)
            data.set(background
              ? { catalogError: message }
              : { catalogStatus: 'error', catalogError: message })
            return
          }
          // 成功值就是上游 `ModelCatalog`：分组、失败与默认选择都按它自己的字段读。
          const catalog = response.value
          catalogLoadedAt = Date.now()
          data.set({
            catalogStatus: 'ready',
            catalogError: null,
            groups: catalog.groups ?? [],
            failures: catalog.failures ?? [],
            defaultSelection: catalog.default ?? null,
          })
        } catch (error) {
          const message = messageOf(error)
          data.set(background
            ? { catalogError: message }
            : { catalogStatus: 'error', catalogError: message })
        }
      })().finally(() => {
        if (catalogInFlight === operation) catalogInFlight = undefined
        // 后台刷新的收尾只清标记；成功路径已经写过一次，这里按需补一次。
        if (background && data.getSnapshot().catalogRefreshing) data.set({ catalogRefreshing: false })
      })
      catalogInFlight = operation
      return operation
    }

    /**
     * 给当前会话切换模型。
     *
     * 请求跨过一次用户切会话时，回包只属于旧会话：清掉 `pending` 就走，不写 `current`、
     * 不把 Host 的旧错误留在新会话上，也不让调用方关掉浮层。
     * @param choice - 选中行对应的模型。
     * @returns 是否成功（失败原因写进 `error`，浮层保持打开）。
     */
    const selectChoice = async (choice: ModelChoice): Promise<boolean> => {
      if (data.getSnapshot().pending) return false
      const sessionId = refreshSession()
      if (sessionId === null) {
        data.set({ error: t('errNoSessionSwitch') })
        return false
      }
      const selectModel = sessionRemote?.selectModel
      if (sessionRemote === undefined || typeof selectModel !== 'function') {
        data.set({ error: t('errSelectUnavailable') })
        return false
      }
      const requestEpoch = selectEpoch + 1
      selectEpoch = requestEpoch
      /** 只有最后一次请求可以清 pending / 写结果；换会话后新请求不能被旧回包清掉。 */
      const settle = (patch: Parameters<typeof data.set>[0]): void => {
        if (selectEpoch === requestEpoch) data.set(patch)
      }
      data.set({ pending: true, error: null })
      /** 这次回包是否还落在发起请求的会话上。 */
      const stillCurrent = (): boolean => data.getSnapshot().sessionId === sessionId
      try {
        const request = { sessionId, ...selectionOfChoice(choice) }
        const response = await selectModel.call(sessionRemote, request)
        if (!stillCurrent()) {
          settle({ pending: false })
          return false
        }
        if (!response.ok) {
          settle({ pending: false, error: t('errSwitchFailed', { message: describeRemoteFailure(response.error) }) })
          return false
        }
        const selected = response.value?.selected ?? selectionOfChoice(choice)
        settle({ pending: false, error: null, current: selected })
        return true
      } catch (error) {
        if (!stillCurrent()) {
          settle({ pending: false })
          return false
        }
        settle({ pending: false, error: t('errSwitchFailed', { message: messageOf(error) }) })
        return false
      }
    }

    /**
     * 这次异步快捷操作的响应是否仍属于发起它的会话与这一次操作。
     *
     * 用户可能在等 Host 回包时切走会话（这一次动作也可能已被服务撤下 / 别的写入取代）：
     * 那时结果只属于旧会话，写进当前会话就会把别人的状态盖掉。
     * @param sessionId - 发起请求时记下的会话。
     * @param action - 发起请求时的快捷操作。
     * @returns 仍可写回时为 true。
     */
    const actionResponseIsCurrent = (sessionId: SessionId, action: QuickAction): boolean => {
      const current = data.getSnapshot()
      return current.sessionId === sessionId && current.actionPending === action
    }

    /**
     * 丢弃属于旧会话 / 已被取代的快捷操作响应：不动 `team` / `worktree` / `error`，
     * 也不动 `actionPending`（换会话时它已由 refreshSession 清掉；如果新会话已经发起
     * 同一个 action，旧回包更不能把它清掉），只重投影一次行。
     */
    const dropStaleActionResponse = (): void => {
      syncRows()
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
      // 写入成功后的乐观读数由 worktreeOverride / teamOverride 挡住迟到的旧投影（见
      // reconcileWorktree / reconcileTeam），所以这里可以不重读：重读只会把刚写入的状态
      // 盖回旧值，连按第二次就会把「取消」又变成一次「请求」。会话切换由目录订阅负责刷新。
      const sessionId = state.sessionId ?? refreshSession()
      if (sessionId === null) {
        data.set({ error: t('errNoSessionAction') })
        return
      }
      const facts = data.getSnapshot().worktree
      if (action === 'worktree') {
        if (facts !== null && facts.created !== null) {
          data.set({ error: t('errWorktreeExists', { detail: facts.created.branch ?? facts.created.path ?? t('errWorktreeCreated') }) })
          return
        }
        const remote = forgePanelRemote
        const request = remote?.requestWorktree
        const cancel = remote?.cancelWorktree
        if (remote === undefined || typeof request !== 'function' || typeof cancel !== 'function') {
          data.set({ error: t('errWorktreeUnavailable') })
          return
        }
        const pending = facts !== null && facts.request !== null
        data.set({ actionPending: action, error: null })
        syncRows()
        try {
          // 远程签名的第三个实参是工作树分支名(`name`):这里的快捷操作按 HEAD 创建、
          // 不指定名字,与上游 forge 面板的调用一致传 null。
          const result = pending
            ? await cancel.call(remote, sessionId)
            : await request.call(remote, sessionId, null, null)
          // 回包先对会话：等 Host 的这段时间里用户可能已经切走（refreshSession 会把
          // actionPending 清掉）；不属于当前会话的结果整条丢弃，不写状态、不设覆盖。
          if (!actionResponseIsCurrent(sessionId, action)) {
            dropStaleActionResponse()
            return
          }
          if (!result.ok) {
            data.set({
              actionPending: null,
              error: t('errActionFailed', { action: pending ? t('worktreeCancel') : t('worktreeTitle'), message: describeRemoteFailure(result.error) }),
            })
          } else {
            // 面板流会随后推同一份状态；先按写入结果更新，避免等待一拍才看到角标变化。
            const target: WorktreeFacts = {
              request: pending ? null : { from: null },
              created: facts?.created ?? null,
            }
            worktreeOverride = { sessionId, baseline: facts ?? EMPTY_WORKTREE_FACTS, target }
            data.set({ actionPending: null, worktree: target })
          }
        } catch (error) {
          if (!actionResponseIsCurrent(sessionId, action)) {
            dropStaleActionResponse()
            return
          }
          data.set({
            actionPending: null,
            error: t('errActionFailed', { action: pending ? t('worktreeCancel') : t('worktreeTitle'), message: messageOf(error) }),
          })
        }
        syncRows()
        return
      }
      const team = data.getSnapshot().team
      const remote = agentTeamsRemote
      const setEnabled = remote?.setEnabled
      if (remote === undefined || typeof setEnabled !== 'function') {
        data.set({ error: t('errTeamUnavailable') })
        return
      }
      const next = !(team?.enabled ?? false)
      data.set({ actionPending: action, error: null })
      syncRows()
      try {
        const result = await setEnabled.call(remote, sessionId, next)
        // 同工作树：会话已经切走就不把团队状态 / 错误写进新会话。
        if (!actionResponseIsCurrent(sessionId, action)) {
          dropStaleActionResponse()
          return
        }
        if (!result.ok) {
          data.set({ actionPending: null, error: t('errTeamSaveFailed', { message: describeRemoteFailure(result.error) }) })
        } else {
          const target: TeamFacts = { enabled: next }
          teamOverride = { sessionId, baseline: team ?? EMPTY_TEAM_FACTS, target }
          data.set({ actionPending: null, team: target })
        }
      } catch (error) {
        if (!actionResponseIsCurrent(sessionId, action)) {
          dropStaleActionResponse()
          return
        }
        data.set({ actionPending: null, error: t('errTeamSaveFailed', { message: messageOf(error) }) })
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
      paletteEpoch += 1
      palette.close()
      stage = 'models'
      stageChoice = null
      stageEfforts = []
      if (data.getSnapshot().stage !== 'models') data.set({ stage: 'models', stageModel: null })
    }

    /** 进入第二步：候选换成这个模型的思考等级，并选中目录里最大的一档。 */
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
      }, initialEffortIndex(efforts))
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
      // 在 await 前记下这次确认属于哪一代浮层 / 哪条会话：等待期间用户关掉或重开浮层时，
      // 成功返回也不能把用户刚打开的那张关掉（同一会话里的正常成功不受影响）。
      const epoch = paletteEpoch
      const sessionId = data.getSnapshot().sessionId
      // 一份目录都没有时才等：不知道这个模型有没有思考等级，就不能贸然跳过第二步。
      // 已经有目录（哪怕正在后台刷新）就直接用上一次的读数 —— 刷新不该把 Enter 卡住。
      const state = data.getSnapshot()
      if (state.catalog.length === 0 && state.groups.length === 0
        && (state.catalogStatus === 'idle' || state.catalogStatus === 'loading')) {
        await loadCatalog()
      }
      // 等目录期间用户可能已经切会话或关掉/重开浮层：这次确认只属于发起时的会话与那一代浮层。
      if (epoch !== paletteEpoch || data.getSnapshot().sessionId !== sessionId) return
      const efforts = effortChoices(choice, findCatalogModel(data.getSnapshot().catalog, choice), modelTexts)
      if (efforts.length <= 1) {
        const selected = await selectChoice(choice)
        if (selected && epoch === paletteEpoch && data.getSnapshot().sessionId === sessionId) closePalette()
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
      // 同 confirmModel：成功只关掉发起这次确认的那一代浮层。
      const epoch = paletteEpoch
      const sessionId = data.getSnapshot().sessionId
      const selected = await selectChoice(selectionOfEffort(stageChoice, effort))
      if (selected && epoch === paletteEpoch && data.getSnapshot().sessionId === sessionId) closePalette()
    }

    /** 第二步按 Esc：退回模型列表，并回到刚才确认的那一行。 */
    const backToModels = (): void => {
      if (stage !== 'efforts') return
      // 退回也是一代新的浮层：第二步在途的确认回来时不能再关掉这张列表。
      paletteEpoch += 1
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
      // 重开就是新一代：上一次打开时在途的确认成功返回后不能关掉这一张。
      paletteEpoch += 1
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
        data.set({ error: t('errNoSessionSwitch') })
      }
      // 有目录时这是一次后台刷新（不回落到 loading、去抖），确认模型不必等它回来。
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
        data.set({ writeError: t('errSettingsUnavailable') })
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
        if (!accepted) data.set({ writeError: t('errSettingsRejected') })
        return accepted
      } catch (error) {
        data.set({ writeError: t('errSaveFailed', { message: messageOf(error) }) })
        return false
      } finally {
        data.set({ writing: false })
      }
    }

    const actions: SettingsActions = {
      // 设置页的刷新是用户手动发起的：跳过打开浮层用的新鲜度窗口，真正向 Host 要一次。
      loadCatalog: () => loadCatalog({ force: true }),
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
        label: () => t('fixedLabel'),
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
            inject: () => ({ store: palette, data, view: modelPaletteView, effortView: effortPaletteView, onBack: backToModels, t }),
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
            label: () => t('settingsLabel'),
            inject: () => ({ data, actions, t }),
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
        data.set({
          catalogStatus: 'error',
          catalogRefreshing: false,
          catalogError: t('errCatalogDisconnected'),
        })
      }, `${name}: remote session release`)
      // 设置页/浮层可能先因为链路未就绪落到 error：链路一到就补拉一次。新链路可能换了一份
      // 目录（Host 换代），所以这一拉跳过去抖，不拿旧窗口里的读数当数。
      if (data.getSnapshot().catalogStatus !== 'ready') void loadCatalog({ force: true })
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
        worktreeOverride = null
        data.set({ actionPending: null, checkout: null, worktree: null })
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
        teamOverride = null
        data.set({ actionPending: null, team: null })
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

/** 测试与产物检查用的再导出：组件与浮层文案仍从入口取。 */
export { ModelOverlay, ModelSettingsSection } from './components.tsx'
export type { OverlayProps, SettingsActions, SettingsProps } from './components.tsx'
export {
  EFFORT_VIEW,
  MODEL_VIEW,
  PALETTE_OPTION_ATTR,
  PALETTE_ROOT_ATTR,
  SETTINGS_ROOT_ATTR,
  countLabel,
  effortView,
  modelView,
  optionDomId,
  paletteCountLabel,
} from './views.ts'
