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
 *   ⌘⌥B 开关右侧栏。
 *
 * 实现:document 捕获阶段单一 keydown 监听,按三态分发(`card` 卡片 → `editing`
 * 输入框 → `browse` 浏览),消费 sessions / uiSession / layout / sidebarRight /
 * workspaces / slots 既有服务,会话跳转 = 活跃会话扫描(running ∪ pending 交互 ∪
 * completed,锚点定向跳跃),导航轴为侧栏顺序(工作区分组 + slots 中 workspace 视图
 * store 的本地会话顺序,每次按键重新取数);
 * 审批与问答/计划评审全部走 uiSession 待处理交互的服务级 answer()/cancel(),
 * 通用问答的选项/切题/提交直接读写**卡片自己的 Session 级 slot store**
 * (`conversation.composer` 注册项,见 question-drafts.ts),卡片实时高亮并翻题;
 * `card` 态由该待处理交互表判定(不依赖卡片渲染与 DOM 结构);
 * Esc 停止当前会话交互树(sessions.binding(id).session.cancel(),含直系子代理,
 * 无运行中会话时不吞键)。不消费 react,无 external。
 */
import {
  answerApproval,
  hasPendingCard,
  isEditableTarget,
  moveQuestion,
  openNeighborSession,
  pickQuestionOption,
  submitQuestion,
  stopCurrentSessionTree,
  toggleRightSidebar,
  toggleSidebar,
} from './actions.ts'
import { ACTION_BY_ID, comboActionMap, comboOf, loadConfig, type HotkeyConfig } from './config.ts'
import { createOverlays, type OverlayHost } from './overlay.ts'
import type { ClientContext, LayoutLike, Services, SessionsLike, SidebarRightLike, SlotsLike, UiSessionLike, WorkspacesLike } from './types.ts'

export const name = 'dsh-kbd-hotkeys'

/**
 * 浏览器半部注入的服务(模块加载器读取)。
 * workspaces 供会话切换复刻侧栏分组,slots 供读取侧栏视图 store(会话顺序),
 * layout 供 ⌘/Ctrl+B 开关左侧栏,sidebarRight 供 ⌘/Ctrl+Alt+B 开关右侧栏。
 */
export const inject = ['sessions', 'uiSession', 'layout', 'sidebarRight', 'workspaces', 'slots']

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
  }

  const config: HotkeyConfig = loadConfig()
  // 反向索引(combo → 动作 id):config.bindings 语义是「动作 id → 组合键」,
  // 按键分发必须按 combo 反查动作;config 加载后不变(自定义键位在 localStorage,
  // 刷新后重载)。
  const actionByCombo: Map<string, string> = comboActionMap(config.bindings)
  const overlays = createOverlays({
    getConfig: () => config,
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
