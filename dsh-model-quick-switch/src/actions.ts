/**
 * `Ctrl+Alt+U` 浮层顶部的快捷操作：新建工作树与团队协作。
 *
 * 这些行不是模型，但和模型共用同一套浮层交互（`↑` / `↓` 选行、`Enter` 执行、`Esc` 关闭），
 * 所以作为普通的 {@link PaletteRow} 投影进来，排在模型行前面。它们作用于**当前主视图会话**：
 *
 *   - **新建工作树**：读同一次会话 forge 面板流（`remote.forgePanel.follow`）里的
 *     `worktree.request` / `worktree.created`，把「请求 / 取消」写成 forge 面板的
 *     `requestWorktree` / `cancelWorktree`。和空白会话行上的同名勾选框一样，请求在发送首条
 *     消息时才真正创建工作树。副标题只报「已开启 / 已关闭」；会话的工作区不是 Git 仓库
 *     （forge 面板的 `checkout.state` 是 `none`）时这一行**整行隐藏**。
 *   - **团队协作**：读 `agentTeam` 投影，写 `remote.agentTeams.setEnabled`；与 hero 行上的开关
 *     行为一致，不做停用确认（首轮前的入口）。
 *
 * 工作树不能读 `forgeWorktree` 投影：它的客户端视图只保留已创建的工作树
 * （`ForgeSessionWorktree | null`），看不到仍处于「请求中」的状态；面板流才是与 hero 勾选框
 * 同源的完整读数。
 *
 * 本文件不 import React、不碰 DOM，也不读上游服务：投影形状在这里收窄成两种事实，`client.ts`
 * 只负责把事实喂进来、把动作接出去，测试可以直接驱动这些规则。Git 检查结果与团队投影的
 * 公开类型直接取上游包（`dsh-experimental-client-ui-forge/types`、`dsh-agent-team/types`），
 * 这里不再各自重写一份字段表。
 */
import type { ForgeCheckoutState } from '@deepseek-ai/dsh-experimental-client-ui-forge/types'
import type { TeamProjection } from '@deepseek-ai/dsh-agent-team/types'
import type { PaletteRow } from './palette.ts'

/** 工作树那一行的稳定 key（不会和模型行的 JSON 数组 key 撞车）。 */
export const ACTION_WORKTREE_KEY = 'action:worktree'

/** 团队协作那一行的稳定 key。 */
export const ACTION_TEAM_KEY = 'action:team'

/** 浮层里快捷操作的标识。 */
export type QuickAction = 'worktree' | 'team'

/** forge 面板对当前目录的 Git 检查结果（上游 `ForgeCheckoutState['state']`，只取状态那一项）。 */
export type CheckoutState = ForgeCheckoutState['state']

/**
 * 工作树开关的两项事实，由 forge 面板流的一帧里 `worktree` 对象收窄而来。
 *
 * 请求可能在首条消息发送前一直开着，此时还不会有创建结果；已创建时请求通常已经清掉。
 * 两项都为空表示当前会话没有工作树（既没请求也没创建）。
 */
export interface WorktreeFacts {
  /** 打开的请求；null 表示没有请求。 */
  readonly request: { readonly from: string | null } | null
  /** 已经创建的工作树；null 表示还没创建。 */
  readonly created: { readonly branch: string | null; readonly path: string | null } | null
}

/** 工作树事实的「未知 / 关闭」基准，用于和迟到投影做同值比较。 */
export const EMPTY_WORKTREE_FACTS: WorktreeFacts = { request: null, created: null }

/** `agentTeam` 投影里本插件读的字段（上游 `TeamProjection` 的 `enabled`）。 */
export type TeamFacts = Pick<TeamProjection, 'enabled'>

/** 团队事实的「未知 / 关闭」基准，用于和迟到投影做同值比较。 */
export const EMPTY_TEAM_FACTS: TeamFacts = { enabled: false }

/** 一行快捷操作的投影输入。 */
export interface QuickActionRowsInput {
  /** 当前有没有打开的主视图会话。 */
  readonly sessionOpen: boolean
  /** `remote.forgePanel` 链路是否就绪。 */
  readonly worktreeAvailable: boolean
  /** `remote.agentTeams` 链路是否就绪。 */
  readonly teamAvailable: boolean
  /** 当前会话 forge 面板流里的工作树事实；还没读到时为 null。 */
  readonly worktree: WorktreeFacts | null
  /** 当前会话的 `agentTeam` 投影；没有投影时为 null。 */
  readonly team: TeamFacts | null
  /** 当前目录的 Git 检查结果；还没读到（或没有 forge 面板流）时为 null。 */
  readonly checkout: CheckoutState | null
}

/** 一个值是不是普通记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 允许 null 的字符串：其余形状一律当 null。 */
function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * 把 forge 面板一帧里的 `worktree` 收窄成 {@link WorktreeFacts}。
 *
 * 投影还没到达、形状不认识时返回 null —— 调用方据此保留上一次读数，而不是假设「没有请求」。
 * @param value - `ForgePanelState.worktree`（或同样带 request / created 的对象）。
 * @returns 收窄后的事实，或 null。
 */
export function worktreeFacts(value: unknown): WorktreeFacts | null {
  if (!isRecord(value)) return null
  const request = isRecord(value.request)
    ? { from: nullableString(value.request.from) }
    : null
  const created = isRecord(value.created)
    ? {
        branch: nullableString(value.created.branch),
        path: nullableString(value.created.path),
      }
    : null
  return { request, created }
}

/**
 * 两份工作树事实是否表示同一个开关状态。
 *
 * 只比较 UI 用到的字段（是否有请求、请求基分支、已创建的分支与路径），不比较服务端可能
 * 额外携带的字段；null 只和 null 相等，调用方在比较迟到投影前先补上「关闭」基准。
 * @param left - 一份事实或 null。
 * @param right - 另一份事实或 null。
 * @returns 相等时为 true。
 */
export function sameWorktreeFacts(left: WorktreeFacts | null, right: WorktreeFacts | null): boolean {
  if (left === null || right === null) return left === right
  return (left.request === null) === (right.request === null)
    && (left.request?.from ?? null) === (right.request?.from ?? null)
    && (left.created === null) === (right.created === null)
    && (left.created?.branch ?? null) === (right.created?.branch ?? null)
    && (left.created?.path ?? null) === (right.created?.path ?? null)
}

/**
 * 把 `agentTeam` 投影收窄成 {@link TeamFacts}。
 * @param value - 会话 `projectionValues.agentTeam`。
 * @returns 收窄后的事实，或 null。
 */
export function teamFacts(value: unknown): TeamFacts | null {
  if (!isRecord(value)) return null
  return { enabled: value.enabled === true }
}

/**
 * 两份团队事实是否表示同一个开关状态。
 *
 * null 只和 null 相等，调用方在比较迟到投影前先补上「关闭」基准。
 * @param left - 一份事实或 null。
 * @param right - 另一份事实或 null。
 * @returns 相等时为 true。
 */
export function sameTeamFacts(left: TeamFacts | null, right: TeamFacts | null): boolean {
  if (left === null || right === null) return left === right
  return left.enabled === right.enabled
}

/**
 * 从 forge 面板流的一帧里读 `checkout.state`。
 *
 * `remote.forgePanel.follow` 每帧是完整的 `ForgePanelState`；这里只关心
 * `checkout.state`。帧形状不认识时返回 null，调用方保留上一次读数。
 * @param frame - 面板流的一帧。
 * @returns Git 检查结果，或 null。
 */
export function checkoutStateOf(frame: unknown): CheckoutState | null {
  if (!isRecord(frame) || !isRecord(frame.checkout)) return null
  const state = frame.checkout.state
  return state === 'ready' || state === 'none' || state === 'pending' || state === 'failed'
    ? state
    : null
}

/**
 * 一行 key 对应哪个快捷操作；模型行返回 null。
 * @param key - 浮层行的 `key`。
 * @returns 快捷操作，或 null。
 */
export function actionOfKey(key: string): QuickAction | null {
  if (key === ACTION_WORKTREE_KEY) return 'worktree'
  if (key === ACTION_TEAM_KEY) return 'team'
  return null
}

/**
 * 一行是不是快捷操作（而不是模型）。
 * @param row - 浮层行。
 * @returns 是快捷操作时为 true。
 */
export function isActionRow(row: PaletteRow): boolean {
  return actionOfKey(row.key) !== null
}

/**
 * 候选里快捷操作的行数（标题右侧的计数用它把操作与模型分开报）。
 * @param rows - 全部候选。
 * @returns 快捷操作的个数。
 */
export function actionRowCount(rows: readonly PaletteRow[]): number {
  return rows.reduce((count, row) => count + (isActionRow(row) ? 1 : 0), 0)
}

/**
 * 第一行模型的绝对下标；没有模型时返回 -1。
 *
 * 打开浮层时如果找不到「当前」模型，选中行要落在第一行模型上，而不是误停在快捷操作上。
 * @param rows - 全部候选。
 * @returns 第一行模型的下标。
 */
export function firstModelRowIndex(rows: readonly PaletteRow[]): number {
  return rows.findIndex((row) => actionOfKey(row.key) === null)
}

/** 工作树这一行是否显示：有会话、forge 面板在，且当前目录确实是 Git 仓库。 */
function showWorktreeRow(input: QuickActionRowsInput): boolean {
  return input.sessionOpen
    && input.worktreeAvailable
    && input.checkout !== 'none'
}

/** 工作树请求当前是否处于开启状态（已请求或已创建）。 */
function worktreeOn(input: QuickActionRowsInput): boolean {
  const facts = input.worktree
  if (facts === null) return false
  return facts.request !== null || facts.created !== null
}

/** 团队协作这一行是否显示：有会话、团队服务在。 */
function showTeamRow(input: QuickActionRowsInput): boolean {
  return input.sessionOpen && input.teamAvailable
}

/** 团队协作请求当前是否处于开启状态。 */
function teamOn(input: QuickActionRowsInput): boolean {
  return input.team !== null && input.team.enabled
}

/**
 * 投影出浮层顶部的快捷操作。
 *
 * 两行的显示规则与排版保持一致：都在「有会话 + 对应服务在」时出现（工作树额外要求目录是
 * Git 仓库，即 `checkout` 不是 `none`），副标题都只报「已开启 / 已关闭」，角标都只有「操作」。
 * @param input - 会话、服务与投影事实。
 * @returns 快捷操作行（工作树在前且可能缺席，团队协作在后）。
 */
export function quickActionRows(input: QuickActionRowsInput): PaletteRow[] {
  const rows: PaletteRow[] = []
  if (showWorktreeRow(input)) {
    rows.push({
      key: ACTION_WORKTREE_KEY,
      title: '新建工作树',
      subtitle: worktreeOn(input) ? '已开启' : '已关闭',
      badges: ['操作'],
    })
  }
  if (showTeamRow(input)) {
    rows.push({
      key: ACTION_TEAM_KEY,
      title: '团队协作',
      subtitle: teamOn(input) ? '已开启' : '已关闭',
      badges: ['操作'],
    })
  }
  return rows
}
