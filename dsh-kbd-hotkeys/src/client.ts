/**
 * dsh-kbd-hotkeys — 浏览器半部入口(TypeScript 真源;由 scripts/build-client.mjs
 * 用 esbuild 打包为 lib/client.js)。
 *
 * 功能:降低鼠标依赖的全局快捷键(键位设计见 docs/dsh-hotkeys-proposal.md):
 * - 态 A(审批 / ask_user_question / 计划评审卡片打开):⌘/Ctrl+Alt+Enter 允许、
 *   ⌘/Ctrl+Alt+Backspace 拒绝、数字键 1–9 选选项、Enter 确认提交;
 * - 全态:⌘/ 速查表、⌘⌥↑/↓ 在活跃会话间跳转(活跃 = 运行中 ∪ 有待回应 ∪
 *   刚完成未查看,按最近活动时间定位)、⌘⌥←/→ 在会话视图标签间切换;
 * - 态 C(输入框失焦):⌘B 开关侧栏。
 *
 * 实现:document 捕获阶段单一 keydown 监听,按三态分发(态 A 卡片 → 态 B 输入框
 * → 态 C 浏览),消费 sessions / uiSession / layout / workspaces 既有服务,
 * 会话跳转 = 活跃会话扫描(running ∪ pending 交互 ∪ completed,锚点定向跳跃);
 * 审批优先走 uiSession.pendingSnapshot 服务级 answer(),DOM 结构仅作回退。
 * 不消费 react,无 external;Esc 中断回合由 dsh-new-session 插件继续承担。
 */
import {
  answerApproval,
  detectStateA,
  focusComposer,
  isEditableTarget,
  openNeighborSession,
  openModelSelector,
  openSettings,
  pickQuestionOption,
  submitQuestion,
  switchView,
  toggleSidebar,
} from './actions.ts'
import { ACTION_BY_ID, comboActionMap, comboOf, loadConfig, type HotkeyConfig } from './config.ts'
import { createOverlays, type OverlayHost } from './overlay.ts'
import type { ClientContext, LayoutLike, SessionsLike, Services, UiSessionLike, WorkspacesLike } from './types.ts'

export const name = 'dsh-kbd-hotkeys'

/** 浏览器半部注入的服务(模块加载器读取)。workspaces 供会话切换复刻侧栏顺序。 */
export const inject = ['sessions', 'uiSession', 'layout', 'workspaces']

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
      case 'approval.allow':
        return answerApproval(services, 'allowed-once')
      case 'approval.reject':
        return answerApproval(services, 'rejected')
      case 'question.option':
        return false // 数字键走固定分发逻辑,不作为可执行动作
      case 'question.submit':
        return submitQuestion()
      case 'sidebar.toggle':
        return toggleSidebar(services)
      case 'session.prev':
        return openNeighborSession(services, -1)
      case 'session.next':
        return openNeighborSession(services, 1)
      case 'view.prev':
        return switchView(-1)
      case 'view.next':
        return switchView(1)
      case 'settings.open':
        return openSettings()
      case 'model.open':
        return openModelSelector()
      case 'composer.focus':
        return focusComposer()
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
    workspaces: getService(ctx, 'workspaces') as WorkspacesLike | undefined,
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
    const stateA = detectStateA()
    const state = stateA ? 'A' : editable ? 'B' : 'C'

    // 固定行为:问答/计划评审卡片的数字键与 Enter(仅态 A 且焦点不在编辑框)
    if (state === 'A' && !editable) {
      if (/^[1-9]$/.test(combo) && pickQuestionOption(Number(combo))) {
        swallow(event)
        return
      }
      if (combo === 'enter' && submitQuestion()) {
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
