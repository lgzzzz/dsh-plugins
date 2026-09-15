/**
 * dsh-kbd-hotkeys — 浏览器半部入口(TypeScript 真源;由 scripts/build-client.mjs
 * 用 esbuild 打包为 lib/client.js)。
 *
 * 功能:降低鼠标依赖的全局快捷键(键位表见 README「键位表」):
 * - `card` 卡片态(审批 / ask_user_question / 计划评审卡片打开):审批卡片
 *   Enter 允许一次、Esc 拒绝(当前会话有审批卡片时不受焦点位置影响——审批卡片
 *   自身没有输入框);问答卡片数字键 1–9 选选项(只选不翻题)、←/→ 上一题/下一题、
 *   Enter 推进(非末题翻到下一题)/ 末题结算(全部题目完成后);
 * - 全态:⌘/ 速查表、⌘⌥↑/↓ 在活跃会话间跳转(活跃 = 运行中 ∪ 有待回应 ∪
 *   刚完成未查看,按**侧栏可见顺序**定位)、
 *   Esc 停止当前会话的整棵运行中交互树(自身 + 直系子代理,one-shot 跳过);
 * - `browse` 浏览态(输入框失焦)与 `editing` 输入态:⌘B 开关左侧栏、
 *   ⌘O 开关右侧栏、⌘⌥←/→ 在右侧栏当前面板的标签之间循环切换
 *   (标签顺序读右栏自己的会话级 slot store,切换调公开的 `sidebarRight.focus`,
 *   见 sidebar-tabs.ts;单个标签时不吞键)、
 *   ⌘\ 打开右栏文件浏览器并把它置于所在标签栏首位(公开的
 *   `sidebarRight.openTab('files')` + 同一份 store 的 `actions.placeTab(…, 0)`,
 *   见 sidebar-tabs.ts 的 revealRightSidebarFiles)、
 *   ⌘L 定位右栏终端(已有终端页就聚焦、没有才 `openTab('terminal')` 新建;
 *   terminal 是 `multiple` 页,上游每次打开都铸新 contentId,认页由插件自己完成;
 *   终端本来就是当前标签、右栏已展开时,上游 TerminalBody 的自动聚焦 effect
 *   不会重跑,故再补一次有界的元素级聚焦把 DOM 焦点移进 xterm,
 *   见 sidebar-tabs.ts 的 revealRightSidebarTerminal / focusTerminalScreen);
 * - 全态:⌘/Ctrl+K 打开**工作区浮窗**(浮窗内 ↑/↓ 移动高亮、Enter 切换、
 *   Esc 关闭),列表取自 `workspaces.list` 快照(宿主顺序),切换调公开的
 *   `uiWorkspace.openWorkspace(workspaceId)`(连接工作区:复用该工作区的空白
 *   会话、没有就新建一个再打开,与侧栏工作区分组的「+」同一条路径),
 *   见 workspace-switcher.ts 与 overlay.ts;
 * - 全态:⌘/Ctrl+M 打开**模型浮窗**(浮窗内 ↑/↓ 选择、Enter 切换、
 *   ⇧Tab 调强度、Esc 关闭),列表 / 当前选择 / 切换都走上游**同一个** per-session
 *   模型目录(`ctx.modelDirectories.directoryFor(sessionId)`——与 `/model` 弹层、
 *   composer 模型座位共用同一份状态),见 model-picker.ts 与 overlay.ts;
 * - `browse` / `editing`:⇧Tab **循环切换当前模型的思考强度**(循环集合 = 上游
 *   composer 座位的 `effortChoices`;模型无推理元数据 / 只有一档 / 目录不可用时
 *   no-op 且不吞键)。`editing` 态另有一道元素级门闸:只有焦点在 composer 自己的
 *   编辑区内才接管(⇧Tab 在别处仍是反向移动焦点 / 反向缩进),见 isComposerTarget;
 * - 全态:⌘/Ctrl+N **新建会话并跳转**(调公开的 `uiWorkspace.startSession()`——
 *   与侧栏「新建会话」按钮、以及 `dsh-new-session` 处理 `command/executed('new')`
 *   后的调用逐字相同,故语义等同于 `/new` 命令;见 actions.ts 的 startNewSession);
 * - `browse` 浏览态,以及 `editing` 输入态中焦点**不在** composer 内的情形(如焦点在
 *   右侧栏终端 / Monaco 的隐藏 textarea 里):⌘/Ctrl+J 把焦点跳回对话输入框
 *   (J = Jump;上游无聚焦服务面,经 conversation.input 取 shell.editor 的宿主元素后调
 *   focus(),见 actions.ts 的 focusComposer;不做选择器查询 / DOM 遍历 / 事件合成)。
 *   `editing` 态另有一道**元素级**门闸(isComposerTarget,与 ⇧Tab 同一取元素链路):
 *   焦点已在 composer 内时不再重复聚焦,但组合键仍被吞掉(见 onKeyDown 内的注释)。
 *
 * 实现:document 捕获阶段单一 keydown 监听,按三态分发(`card` 卡片 → `editing`
 * 输入框 → `browse` 浏览),消费 sessions / uiSession / layout / sidebarRight /
 * workspaces / slots / conversation / uiWorkspace 既有服务,会话跳转 = 活跃会话扫描
 * (running ∪ pending 交互 ∪ completed,锚点定向跳跃),导航轴为侧栏顺序(工作区分组 +
 * slots 中 workspace 视图 store 的本地会话顺序,每次按键重新取数);
 * 右栏标签切换 = `slots.entries('rightbar.session')` 注册项上的 store handle
 * (`uiSession.resolve` 作用域绑定 → `slots.resolveStore`)读 `layout.activePaneId`
 * 面板的标签顺序 + `sidebarRight.focus(tabId)`(见 sidebar-tabs.ts,无降级);
 * 审批与问答/计划评审全部走 uiSession 待处理交互的服务级 answer()/cancel(),
 * 通用问答的选项/切题/提交直接读写**卡片自己的 Session 级 slot store**
 * (`conversation.composer` 注册项,见 question-drafts.ts),卡片实时高亮并翻题;
 * `card` 态由该待处理交互表判定(不依赖卡片渲染与 DOM 结构);
 * Esc 停止当前会话交互树(sessions.binding(id).session.cancel(),含直系子代理,
 * 无运行中会话时不吞键)。不消费 react,无 external。
 */
import {
  answerApproval,
  focusComposer,
  hasPendingCard,
  isComposerTarget,
  isEditableTarget,
  moveQuestion,
  openNeighborSession,
  pickQuestionOption,
  startNewSession,
  submitQuestion,
  stopCurrentSessionTree,
  toggleRightSidebar,
  toggleSidebar,
} from './actions.ts'
import { ACTION_BY_ID, comboActionMap, comboOf, loadConfig, type HotkeyConfig } from './config.ts'
import { cycleEffort, modelPickerView, selectModel } from './model-picker.ts'
import { createOverlays, type OverlayHost } from './overlay.ts'
import { cycleRightSidebarTab, revealRightSidebarFiles, revealRightSidebarTerminal } from './sidebar-tabs.ts'
import { switchWorkspace, workspaceRows } from './workspace-switcher.ts'
import type { ClientContext, ConversationLike, LayoutLike, ModelDirectoryResolverLike, Services, SessionsLike, SidebarRightLike, SlotsLike, UiSessionLike, UiWorkspaceLike, WorkspacesLike } from './types.ts'

export const name = 'dsh-kbd-hotkeys'

/**
 * 浏览器半部注入的服务(模块加载器读取)。
 * workspaces 供会话切换复刻侧栏分组、工作区浮窗取列表,slots 供读取侧栏视图
 * store(会话顺序)与右栏标签 store(标签顺序 + 置顶用的 actions),layout 供
 * ⌘/Ctrl+B 开关左侧栏,sidebarRight 供 ⌘/Ctrl+O 开关右侧栏、
 * ⌘/Ctrl+Alt+←/→ 聚焦右栏标签、⌘/Ctrl+\ 打开文件浏览器、
 * ⌘/Ctrl+L 定位终端(已有则聚焦、缺则新建),
 * conversation 供 ⌘/Ctrl+J 取 composer 的 editor 宿主元素(焦点跳转)与
 * ⇧Tab 的编辑态门闸(宿主元素 contains 事件目标),
 * uiWorkspace 供 ⌘/Ctrl+K 工作区浮窗确认时连接/切换工作区、⌘/Ctrl+N 新建会话
 * (startSession,与 `/new` 同一条服务调用),
 * modelDirectories 供 ⌘/Ctrl+M 模型浮窗与 ⇧Tab 循环思考强度
 * (上游 `/model` 弹层、composer 模型座位的**同一份** per-session 目录实例)。
 */
export const inject = ['sessions', 'uiSession', 'layout', 'sidebarRight', 'workspaces', 'slots', 'conversation', 'uiWorkspace', 'modelDirectories']

/** null 与 undefined 双重判空后取服务(缺失时返回 undefined)。 */
function getService(ctx: ClientContext, serviceName: string): unknown {
  if (ctx.get === undefined || ctx.get === null) return undefined
  const value = ctx.get(serviceName)
  return value === null || value === undefined ? undefined : value
}

/** 集中动作执行:键位分发共用;返回是否实际处理。 */
function runAction(id: string, services: Services, overlays: OverlayHost): boolean {
  try {
    switch (id) {
      case 'question.option':
        return false // 数字键走固定分发逻辑,不作为可执行动作
      case 'question.submit':
        return submitQuestion(services)
      case 'sidebar.toggle':
        return toggleSidebar(services)
      case 'sidebarRight.toggle':
        return toggleRightSidebar(services)
      case 'sidebarRight.tabPrev':
        return cycleRightSidebarTab(services, -1)
      case 'sidebarRight.tabNext':
        return cycleRightSidebarTab(services, 1)
      case 'sidebarRight.files':
        // 打开右栏文件浏览器并置于首位:openTab('files') 打开/聚焦并展开右栏,
        // 置顶走会话级 store 的 actions.placeTab(与标签拖拽同一入口)。
        return revealRightSidebarFiles(services)
      case 'sidebarRight.terminal':
        // 定位右栏终端:已有终端页就只聚焦(折叠时补一步 toggleExpanded)、
        // 并把焦点移进 xterm,没有才 openTab('terminal') 新建——terminal 是
        // multiple 页,上游不会按 (kind, contentId) 去重,认页由 sidebar-tabs.ts
        // 自己完成。
        return revealRightSidebarTerminal(services)
      case 'composer.focus':
        return focusComposer(services)
      case 'session.new':
        // ⌘/Ctrl+N:新建会话并跳转 = `/new` 命令的同一动作
        // (公开的 uiWorkspace.startSession,与侧栏「新建会话」按钮同一条路径)。
        return startNewSession(services)
      case 'workspace.pick':
        // 工作区浮窗:打开时按当前快照现取列表(↑/↓ 与 Enter 在 overlay 内处理)
        overlays.toggleWorkspacePicker()
        return true
      case 'model.pick':
        // 模型浮窗:打开时现取当前会话的模型目录(↑/↓ 与 Enter 在 overlay 内处理)
        overlays.toggleModelPicker()
        return true
      case 'model.effortNext':
        // ⇧Tab:循环切换当前模型的思考强度;no-op(无强度档 / 只有一档 /
        // 目录不可用)返回 false → 不吞键,⇧Tab 交回页面默认行为。
        return cycleEffort(services).ok
      case 'session.prev':
        return openNeighborSession(services, -1)
      case 'session.next':
        return openNeighborSession(services, 1)
      case 'session.stop':
        // 只取消运行中的会话树,不吞 Esc——页面默认 Esc 行为(关弹层 /
        // 退出编辑态)照常执行;浮层打开时已在上方模态分发返回。
        stopCurrentSessionTree(services)
        return false
      case 'help.toggle':
        overlays.toggleHelp()
        return true
      default:
        return false
    }
  } catch (error) {
    console.warn('[dsh-kbd-hotkeys] action failed:', id, error)
    return false
  }
}

/**
 * 安装全局 keydown 分发器与浮层。
 * @param ctx - Client root context。
 */
export function apply(ctx: ClientContext): void {
  if (typeof document === 'undefined') return

  const services: Services = {
    sessions: getService(ctx, 'sessions') as SessionsLike | undefined,
    uiSession: getService(ctx, 'uiSession') as UiSessionLike | undefined,
    layout: getService(ctx, 'layout') as LayoutLike | undefined,
    sidebarRight: getService(ctx, 'sidebarRight') as SidebarRightLike | undefined,
    workspaces: getService(ctx, 'workspaces') as WorkspacesLike | undefined,
    slots: getService(ctx, 'slots') as SlotsLike | undefined,
    conversation: getService(ctx, 'conversation') as ConversationLike | undefined,
    uiWorkspace: getService(ctx, 'uiWorkspace') as UiWorkspaceLike | undefined,
    modelDirectories: getService(ctx, 'modelDirectories') as ModelDirectoryResolverLike | undefined,
  }

  const config: HotkeyConfig = loadConfig()
  // 反向索引(combo → 动作 id):config.bindings 语义是「动作 id → 组合键」,
  // 按键分发必须按 combo 反查动作;config 加载后不变(自定义键位在 localStorage,
  // 刷新后重载)。
  const actionByCombo: Map<string, string> = comboActionMap(config.bindings)
  const overlays = createOverlays({
    getConfig: () => config,
    // 工作区浮窗:数据每次打开时现取(宿主顺序),确认走 uiWorkspace.openWorkspace
    listWorkspaces: () => workspaceRows(services),
    selectWorkspace: (workspaceId) => {
      switchWorkspace(services, workspaceId)
    },
    // 模型浮窗:列表每次打开时现取当前会话的模型目录(与 `/model` 弹层、
    // composer 模型座位同一份状态);确认走同一个 directory.select。
    listModels: () => modelPickerView(services),
    selectModel: (selection) => {
      selectModel(services, selection)
    },
    cycleEffort: () => cycleEffort(services),
  })

  const swallow = (event: KeyboardEvent): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat && event.key === 'Escape') return

    // 浮层打开:模态分发,面板输入框自身的普通输入放行
    if (overlays.isOpen()) {
      const handled = overlays.handleKey(event)
      if (handled) {
        swallow(event)
        return
      }
      const target = event.target
      if (target instanceof Node && overlays.contains(target)) return
      swallow(event)
      return
    }

    if (event.isComposing) return
    const combo = comboOf(event)
    if (combo === 'mod' || combo === 'alt' || combo === 'shift' || combo === 'mod+alt' || combo === 'mod+shift' || combo === 'alt+shift') {
      return
    }

    const editable = isEditableTarget(event.target)
    const cardState = hasPendingCard(services)
    const state = cardState ? 'card' : editable ? 'editing' : 'browse'

    // 固定行为:card 态由 uiSession 待处理交互表判定。
    // 审批卡片(当前会话待处理交互 kind==='approval'):Enter = 允许一次、Esc = 拒绝;
    // 卡片自身没有输入框,故不受焦点位置影响(焦点在对话输入框时同样应答)。
    if (state === 'card') {
      if (combo === 'enter' && answerApproval(services, 'allowed-once')) {
        swallow(event)
        return
      }
      if (combo === 'escape' && answerApproval(services, 'rejected')) {
        swallow(event)
        return
      }
    }

    // 问答/计划评审卡片:数字键只写选中态(不翻题)、←/→ 只改题号、Enter 非末题推进 /
    // 末题结算,动作均为服务级。焦点在编辑框时交回输入框(光标移动 / 文本输入)。
    if (state === 'card' && !editable) {
      if (/^[1-9]$/.test(combo) && pickQuestionOption(services, Number(combo))) {
        swallow(event)
        return
      }
      if (combo === 'arrowleft' && moveQuestion(services, -1)) {
        swallow(event)
        return
      }
      if (combo === 'arrowright' && moveQuestion(services, 1)) {
        swallow(event)
        return
      }
      if (combo === 'enter' && submitQuestion(services)) {
        swallow(event)
        return
      }
    }
    const actionId = actionByCombo.get(combo)
    if (actionId === undefined) return
    const def = ACTION_BY_ID.get(actionId)
    if (def === undefined) return
    // 态闸门:动作声明允许的状态里才触发
    if (!def.states.includes(state)) return
    // ⇧Tab 的**元素级**门闸:⇧Tab 是文本编辑的核心键(反向移动焦点;右侧栏 Monaco
    // 里是反向缩进),所以 `editing` 态只在焦点落在 **composer 自己的编辑区内**时接管
    // ——焦点在设置面板的 input、Monaco 的隐藏 textarea 等其它可编辑元素时一律放行,
    // 交回该处默认行为。判据 = 服务链路取来的宿主元素上做一次 contains
    // (见 actions.ts 的 isComposerTarget),零选择器 / 零 DOM 遍历。
    if (actionId === 'model.effortNext' && state === 'editing' && !isComposerTarget(services, event.target)) return
    // ⌘/Ctrl+J 的**元素级**门闸(方向与 ⇧Tab 相反):`editing` 态 = 焦点在某个可编辑
    // 元素里,但那个元素**不一定**是 composer——右侧栏终端(xterm 的隐藏
    // `.xterm-helper-textarea`)与 Monaco(`.inputarea` textarea)都是真实 <textarea>,
    // 判据只看 tagName,于是它们同样落入 `editing`。焦点在那里时按 ⌘/Ctrl+J 的意图正是
    // 「跳回对话输入框」(J = Jump),所以只在焦点**不在** composer 内时才执行聚焦;
    // 焦点已经在 composer 自己的编辑区里时动作无事可做,但组合键**仍然吞掉**——
    // 旧键位 I 在此放行是为了保住 contenteditable 的「斜体」默认键,J 在 composer 里
    // 没有等价的、值得保留的默认行为,放行只会让 Win/Linux 浏览器的 Ctrl+J(下载页)跑出来。
    if (actionId === 'composer.focus' && state === 'editing' && isComposerTarget(services, event.target)) {
      swallow(event)
      return
    }
    if (runAction(actionId, services, overlays)) swallow(event)
  }

  document.addEventListener('keydown', onKeyDown, true)
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      document.removeEventListener('keydown', onKeyDown, true)
      overlays.destroy()
    })
  }
}
