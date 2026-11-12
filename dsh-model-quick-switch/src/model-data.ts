/**
 * 浏览器半部的数据快照：设置里的列表、Host 模型目录、当前会话、写回状态。
 *
 * 浮层与设置页读同一个 store —— 设置页里增删一条，浮层下一次打开（以及开着的那张）立刻跟着
 * 变；切换模型成功后「当前」角标也立刻跟着走。状态只在整份快照替换时通知订阅者
 * （`useSyncExternalStore` 需要引用稳定）。
 *
 * 本文件不 import React。
 */
import type { CheckoutState, QuickAction, TeamFacts, WorktreeFacts } from './actions.ts'
import type { CatalogFailure, CatalogGroup, CatalogModelRow, ModelChoice, ModelSelectionLike } from './model.ts'
import { flattenCatalog } from './model.ts'

/** 模型目录的加载生命周期。 */
export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 本插件设置命名空间在配置表单里的状态。 */
export type ConfigStatus = 'loading' | 'ready' | 'unavailable'

/** 浮层当前停在哪一步：选模型，还是选思考等级。 */
export type PaletteStage = 'models' | 'efforts'

/** 一张快照里的全部读数。 */
export interface ModelDataState {
  /** 浮层当前步骤；设置页不读它。 */
  readonly stage: PaletteStage
  /** 进入思考等级步骤时选中的模型；还在模型步骤时为 null。 */
  readonly stageModel: ModelSelectionLike | null
  /** 设置里保存的列表（顺序即浮层顺序）。 */
  readonly choices: readonly ModelChoice[]
  /** 模型目录展开后的模型行；目录还没加载时为空数组。 */
  readonly catalog: readonly CatalogModelRow[]
  /** 模型目录原始分组（设置页按提供方渲染）。 */
  readonly groups: readonly CatalogGroup[]
  /** 目录里加载失败的提供方。 */
  readonly failures: readonly CatalogFailure[]
  /** 目录里未配置模型时的默认选择。 */
  readonly defaultSelection: ModelSelectionLike | null
  /** 目录加载状态。 */
  readonly catalogStatus: CatalogStatus
  /** 目录加载失败的原因。 */
  readonly catalogError: string | null
  /** 主视图会话当前的选择（来自 `modelSelection` 投影；可能为 null）。 */
  readonly current: ModelSelectionLike | null
  /** 主视图会话 id；没有打开的会话时为 null。 */
  readonly sessionId: string | null
  /** 主视图会话的 `forgeWorktree` 投影；没有会话或投影缺席时为 null。 */
  readonly worktree: WorktreeFacts | null
  /** 主视图会话的 `agentTeam` 投影；没有会话或投影缺席时为 null。 */
  readonly team: TeamFacts | null
  /** 当前目录的 Git 检查结果（来自 forge 面板流）；还没读到时为 null。 */
  readonly checkout: CheckoutState | null
  /** 正在执行的快捷操作（工作树 / 团队协作）。 */
  readonly actionPending: QuickAction | null
  /** 配置表单状态。 */
  readonly configStatus: ConfigStatus
  /** 当前配置是否可写。 */
  readonly writable: boolean
  /** 一次模型切换正在进行。 */
  readonly pending: boolean
  /** 一次设置写入正在进行。 */
  readonly writing: boolean
  /** 浮层里的最后一次错误（切换失败 / 没有会话）。 */
  readonly error: string | null
  /** 设置页里的最后一次写入错误。 */
  readonly writeError: string | null
}

/** 快照存储。 */
export interface ModelDataStore {
  getSnapshot(): ModelDataState
  subscribe(listener: () => void): () => void
  /** 合并一段状态；返回替换后的快照。 */
  set(patch: Partial<ModelDataState>): ModelDataState
}

/** 初始快照：什么都还没读到。 */
export const INITIAL_MODEL_DATA: ModelDataState = {
  stage: 'models',
  stageModel: null,
  choices: [],
  catalog: [],
  groups: [],
  failures: [],
  defaultSelection: null,
  catalogStatus: 'idle',
  catalogError: null,
  current: null,
  sessionId: null,
  worktree: null,
  team: null,
  checkout: null,
  actionPending: null,
  configStatus: 'loading',
  writable: false,
  pending: false,
  writing: false,
  error: null,
  writeError: null,
}

/**
 * 造一个模型数据存储。
 *
 * 订阅回调按微任务批量合并：同一拍里的多次 `set` 只通知一次，订阅者读到的永远是最后一次写入
 * 之后的快照。单个订阅者抛错不影响其余订阅者。
 * @returns 存储。
 */
export function createModelDataStore(): ModelDataStore {
  let state: ModelDataState = INITIAL_MODEL_DATA
  const listeners = new Set<() => void>()
  let notifyScheduled = false

  const notify = (): void => {
    if (notifyScheduled) return
    notifyScheduled = true
    queueMicrotask(() => {
      notifyScheduled = false
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch (error) {
          console.warn('[dsh-model-quick-switch] data listener failed:', error)
        }
      }
    })
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(patch) {
      const merged: ModelDataState = { ...state, ...patch }
      // 目录分组与展开结果一起更新，避免调用方每次都要自己同步两份。
      const next: ModelDataState = patch.groups !== undefined && patch.catalog === undefined
        ? { ...merged, catalog: flattenCatalog(patch.groups) }
        : merged
      state = next
      notify()
      return state
    },
  }
}

/** 把 Remote 失败折成一句可读的错误。 */
export function describeRemoteFailure(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const failure = error as { readonly code?: unknown; readonly message?: unknown }
    const code = typeof failure.code === 'string' ? failure.code : undefined
    const message = typeof failure.message === 'string' ? failure.message : undefined
    if (code !== undefined && message !== undefined) return `${code}: ${message}`
    if (message !== undefined) return message
    if (code !== undefined) return code
  }
  return messageOf(error)
}

/** 把任意抛出的值折成一句可读的错误。 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
