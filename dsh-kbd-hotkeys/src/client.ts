/**
 * 浏览器半部入口:单个 keydown 捕获监听,按 card / editing / browse 三态分发;全走服务,无降级、不回退 DOM。
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
import { openRecentSession, recentSessionsView } from './recent-sessions.ts'
import { closeRightSidebarTab, cycleRightSidebarTab, revealRightSidebarFiles, revealRightSidebarTerminal } from './sidebar-tabs.ts'
import { switchWorkspace, workspaceRows } from './workspace-switcher.ts'
import type { ClientContext, ConversationLike, LayoutLike, ModelDirectoryResolverLike, Services, SessionsLike, SidebarRightLike, SlotsLike, UiSessionLike, UiWorkspaceLike, WorkspacesLike } from './types.ts'

export const name = 'dsh-kbd-hotkeys'

/** 浏览器半部注入的服务(模块加载器读取)。 */
export const inject = ['sessions', 'uiSession', 'layout', 'sidebarRight', 'workspaces', 'slots', 'conversation', 'uiWorkspace', 'modelDirectories']

/** 双重判空后取服务(缺失时返回 undefined)。 */
function getService(ctx: ClientContext, serviceName: string): unknown {
  if (ctx.get === undefined || ctx.get === null) return undefined
  const value = ctx.get(serviceName)
  return value === null || value === undefined ? undefined : value
}

/** 集中动作执行;返回是否实际处理。 */
function runAction(id: string, services: Services, overlays: OverlayHost): boolean {
  try {
    switch (id) {
      case 'question.option':
        return false // 数字键用固定分发,非可执行动作
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
        // 打开文件浏览器并置顶(placeTab 与拖拽同一入口)
        return revealRightSidebarFiles(services)
      case 'sidebarRight.terminal':
        // 终端:上游不去重,认页由 sidebar-tabs 完成
        return revealRightSidebarTerminal(services)
      case 'sidebarRight.closeTab':
        // 关当前标签:上游自带拒绝(独占 guide)时读回布局判定,no-op 不吞键
        return closeRightSidebarTab(services)
      case 'composer.focus':
        return focusComposer(services)
      case 'session.new':
        // 新建会话 = /new(uiWorkspace.startSession)
        return startNewSession(services)
      case 'workspace.pick':
        // 工作区浮窗:打开时现取列表
        overlays.toggleWorkspacePicker()
        return true
      case 'session.recent':
        // 近期对话浮窗:打开时现取快照
        overlays.toggleRecentPicker()
        return true
      case 'model.pick':
        // 模型浮窗:打开时现取目录
        overlays.toggleModelPicker()
        return true
      case 'model.effortNext':
        // 强度循环:no-op 返回 false → 不吞键
        return cycleEffort(services).ok
      case 'session.prev':
        return openNeighborSession(services, -1)
      case 'session.next':
        return openNeighborSession(services, 1)
      case 'session.stop':
        // 只取消运行中的会话树,不吞 Esc
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

/** 安装全局 keydown 分发器与浮层。 */
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
  // combo → 动作 id 反向索引;config 加载后不变
  const actionByCombo: Map<string, string> = comboActionMap(config.bindings)
  const overlays = createOverlays({
    getConfig: () => config,
    // 工作区浮窗:每次打开现取
    listWorkspaces: () => workspaceRows(services),
    selectWorkspace: (workspaceId) => {
      switchWorkspace(services, workspaceId)
    },
    // 近期对话:现取快照;openSession 缺失回退 sessions.open
    listRecentSessions: () => recentSessionsView(services),
    selectRecentSession: (sessionId) => {
      openRecentSession(services, sessionId)
    },
    // 模型浮窗:与上游弹层共用同一 per-session 目录
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

    // 浮层打开:模态分发,面板内输入放行
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

    // card 态:审批 Enter 允许 / Esc 拒绝(卡片无输入框)
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

    // 问答卡片:数字键只选中、←/→ 翻题、Enter 推进/结算
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
    // 态闸门:仅动作声明的状态触发
    if (!def.states.includes(state)) return
    // ⇧Tab 是编辑核心键,editing 仅在 composer 内接管
    if (actionId === 'model.effortNext' && state === 'editing' && !isComposerTarget(services, event.target)) return
    // ⌘J:焦点不在 composer 才聚焦
    // 在 composer 内仍吞键(浏览器 Ctrl+J 是下载页)
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
