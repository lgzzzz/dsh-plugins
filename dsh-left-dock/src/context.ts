/**
 * dsh-left-dock — 运行时结构类型切片。
 *
 * 依据 AGENTS.md「类型解析约定」：`dsh-client-ui-slots` / `dsh-client-ui-primitives`
 * 等类型包不在内置 bundle 中，因此这里自行声明**仅覆盖本插件实际消费字段**的
 * 结构切片；每一处都以上游（tag `dsh-v0.1.5-rc.1`）源码与已安装 `lib/*.d.ts` 为
 * 核实依据，且判空一律 `=== null || === undefined` 双重判断。
 */
import type { ReactNode } from 'react'

/** apply(ctx) 的运行时上下文最小面。 */
export interface ClientContext {
  get(name: string): unknown
  effect(callback: () => void | (() => void), label?: string): void
  /**
   * cordis 的动态依赖（registry.inject → 子 plugin）：deps 就绪时在**带该 inject 的
   * 子 fiber** 里运行回调，缺失时本插件照常激活。回调接收作用域上下文，可在其中
   * 访问被声明的服务。
   */
  inject?(
    dependencies: readonly string[],
    callback: (scoped: InjectedClientContext) => void,
  ): unknown
}

/**
 * 动态依赖作用域里的上下文。
 *
 * **为什么必须有这一层**：cordis 的服务代理对「派生命名空间」要求 inject 声明
 * ——`ctx.get('remote')` 能拿到 Remote 面，但紧接着访问 `.workspaceFiles` 会抛
 * `cannot get property "remote.workspaceFiles" without inject`。内置
 * `dsh-api-workspace-files` / `dsh-client-ui-sidebar-files` 都是在静态 `inject` 里
 * 声明 `'remote.workspaceFiles'` 之后才访问的；本插件改用动态 inject 达到同样效果，
 * 但不把整条插件的激活绑在这一个能力上（本插件还要渲染会话面板）。
 */
export interface InjectedClientContext extends ClientContext {
  /** Remote 面（同一 inject 里声明 `remote.workspaceFiles` 后其命名空间才可访问）。 */
  remote?: RemoteLike
}

/** 宿主侧观察源（inject face 的 `hooks` 条目：getSnapshot + subscribe）。 */
export interface HostObservable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** slots 注册项：`store` 是注册时挂上的 store handle（LayoutState 那份）。 */
export interface SlotEntryLike {
  store?: unknown
  options?: { id?: string; order?: number; label?: unknown; key?: string }
}

/** store 实例的动作面（defineStore 烘焙后的 draft-stripped 回调）。 */
export interface StoreActionsLike {
  setSidebar?(px: number): void
}

/** slots.resolveStore(handle, binding) 的产物。 */
export interface StoreInstanceLike {
  getSnapshot?(): unknown
  actions?: StoreActionsLike
}

/**
 * slots 服务（SlotRegistry）消费面：
 * - `register` / `inject`：注册槽位占用与「声明就绪后再注册」；
 * - `entries(key)` / `entriesOfSlot(key)`：读某槽位的注册项；
 * - `subscribe(key, fn)`：槽位变更通知（用于 sidebar.panellist 行）；
 * - `resolveStore(handle, binding)`：解析注册项 store handle 的活实例（root 作用域
 *   无需 scopeBinding）——本插件用它取 ui-layout 那份 root store 的 `setSidebar`。
 */
export interface SlotsLike {
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void
  entries?(key: string): readonly SlotEntryLike[]
  entriesOfSlot?(key: string): readonly SlotEntryLike[]
  subscribe?(key: string, listener: () => void): () => void
  resolveStore?(handle: unknown, scopeBinding: unknown): StoreInstanceLike | undefined
}

/** layout 服务消费面（ctx.reflect.provide("layout", …) 的 LayoutController）。 */
export interface LayoutLike {
  toggleSidebar?(): void
  selectPanel?(panelId: string | null): void
}

/** uiWorkspace 服务消费面（ui-workspace 提供）。 */
export interface UiWorkspaceLike {
  startSession?(workspaceId?: string): void
}

/** Remote 结果（dsh-api-remotes：调用不 reject，失败随结果返回）。 */
export interface RemoteFailureLike {
  code?: string
  message?: string
}

export type RemoteResultLike<T> =
  | { ok: true; value: T }
  | { ok: false; error: RemoteFailureLike }

/** 一个目录条目（dsh-api-workspace-files 的 WorkspaceDirectoryEntry）。 */
export interface DirectoryEntryLike {
  name: string
  /** 'file' | 'directory' | 'other'（符号链接等）。 */
  type?: string
}

/** 一次目录列表（只取本插件用到的两个字段）。 */
export interface DirectoryListingLike {
  entries?: readonly DirectoryEntryLike[]
  truncated?: boolean
}

/**
 * `remote.<namespace>` 命名空间面（`dsh-api-gateway` 的客户端以
 * `remoteServiceKey(namespace) = 'remote.' + namespace` 把每个 Host 能力命名空间注册成
 * **一个已提供的服务**，见其 `RemoteNamespaceService extends Service`）。
 * 因此 `ctx.get('remote.workspaceFiles')` 直接可用（`ctx.get` 不做 inject 检查）。
 */
export interface RemoteNamespaceLike {
  list?(sessionId: string, path: string, signal: AbortSignal): Promise<RemoteResultLike<DirectoryListingLike>>
}

/** remote 服务消费面：只用到 workspaceFiles 命名空间。 */
export interface RemoteLike {
  workspaceFiles?: RemoteNamespaceLike
}

/** 已绑定的 `remote.workspaceFiles.list`（`this` 已锁定到该命名空间）。 */
export type WorkspaceList = (
  sessionId: string,
  path: string,
  signal: AbortSignal,
) => Promise<RemoteResultLike<DirectoryListingLike>>

/** dsh-text-editor 能力面（仓库内 dsh-text-editor 通过 ctx.provide 提供）。 */
export interface TextEditorLike {
  openFile?(request: { path: string; cwd?: string; sessionId?: string }): void
}

/** locale 服务消费面。 */
export interface LocaleLike {
  register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(namespace: string): Translate
}

/** 文案函数（{name} 占位由框架或本插件回退实现插值）。 */
export type Translate = (key: string, params?: Record<string, unknown>) => string

/** 会话摘要（只取 cwd）。 */
export interface SessionSummaryLike {
  cwd?: string
}

/** sessions.list 快照（只取 current / byId）。 */
export interface SessionListSnapshotLike {
  current?: string
  byId?: Record<string, SessionSummaryLike | undefined>
}

/** 框架标准 props 里的会话选择器 hook（useSessions(selector)）。 */
export type SessionsSelector = <T>(selector: (snapshot: SessionListSnapshotLike) => T) => T

/** renderSlot(name, ownerProps, { only, fallback })。 */
export type RenderSlot = (
  name: string,
  props?: Record<string, unknown>,
  options?: { only?: string; fallback?: ReactNode },
) => ReactNode

/** sidebar.panellist 行元数据（ui-sidebar 的 SidebarPanelMetadata）。 */
export interface PanelMeta {
  id: string
  order: number
  label: string
}
