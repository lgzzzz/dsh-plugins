/**
 * dsh-left-dock — 浏览器半部入口（TypeScript 真源；由 scripts/build-client.mjs
 * 用 esbuild 打包成单文件 lib/client.js）。
 *
 * 本插件把内置左栏换成自己的「活动栏 + 两个互斥面板」，只走**公开面**：
 * 槽位系统（`sidebar` 的占位与 6 个子座位的声明）、layout 服务、uiWorkspace 服务、
 * ui-layout 的 root store 动作（写列宽）、Remote（列目录）、以及仓库内
 * dsh-text-editor 的能力面（打开文件到对话区 tab）。上游 `ui-sidebar` 的组件由本
 * bundle 的 cordis.patch.yml 停用，但它声明的那 6 个子座位由本插件**原样声明**，
 * 因此 ui-workspace / ui-settings-general / ui-brand-official / ui-cordis 的注册项
 * 继续生效。
 *
 * 依赖声明只有 `slots`：这是本插件唯一「缺了就不能工作」的服务。其余服务分两类取用：
 *
 *   - 普通提供的服务（`locale` / `layout` / `uiWorkspace` / `dsh-text-editor`）在调用时
 *     `ctx.get` 读取 —— `ctx.get` 不做 inject 检查，缺失只是该功能降级；
 *   - **派生命名空间** `remote.workspaceFiles` 必须出现在 inject 里才能访问，因此改用
 *     cordis 的动态依赖 `ctx.inject(['remote','remote.workspaceFiles'], …)`，在就绪的
 *     子 fiber 里取一次 `list` 函数；能力缺席时本插件照常激活（面板显示服务未就绪）。
 *
 * 这样任何一项缺席都只是对应功能降级，不会让整条插件不激活、左栏反而空白。
 */
import type {
  ClientContext, InjectedClientContext, LayoutLike, LocaleLike, PanelMeta, RemoteNamespaceLike,
  SlotEntryLike, SlotsLike, TextEditorLike, UiWorkspaceLike, WorkspaceList,
} from './context.ts'
import { CSS } from './css.ts'
import { LeftDock } from './dock.ts'
import { clampTrackWidth, rootLayoutActions } from './layout-store.ts'
import { NS, en, zh } from './locales.ts'
import { createObservable } from './observable.ts'

export const name = 'dsh-left-dock'

/** 唯一硬依赖：槽位服务（缺失即无法注册左栏占位）。 */
export const inject = ['slots']

/**
 * 本插件在 `sidebar` 槽位上声明的子座位：与内置 ui-sidebar 的声明逐项一致
 * （名称、kind、scope 全同），这样 ui-workspace 的会话浏览器、ui-settings-general 的
 * 设置入口、ui-brand-official 的品牌位、ui-cordis 的页脚动作都能照旧注册进来。
 * 一个槽位只能有一个声明者，因此 ui-sidebar 行由本 bundle 的补丁停用。
 */
const CHILDREN = {
  'sidebar.brand.mark': { kind: 'single', scope: 'root' },
  'sidebar.brand.name': { kind: 'single', scope: 'root' },
  'sidebar.panellist': { kind: 'list', scope: 'root' },
  'sidebar.workspaces': { kind: 'single', scope: 'root' },
  'sidebar.settings': { kind: 'single', scope: 'root' },
  'sidebar.footer.action': { kind: 'list', scope: 'root' },
}

/**
 * 读一个 panellist 注册项的显示名（label 可能是字符串或惰性函数）。
 * @param entry - slots 注册项。
 * @returns 名字；读不出时回落到 id。
 */
function labelOf(entry: SlotEntryLike): string {
  const raw = entry?.options?.label
  if (typeof raw === 'string') return raw
  if (typeof raw === 'function') {
    try {
      const value = (raw as () => unknown)()
      if (typeof value === 'string') return value
    } catch {
      /* label 抛错：按无名字处理 */
    }
  }
  return String(entry?.options?.id ?? '')
}

/**
 * 直接解析 `remote.workspaceFiles` 命名空间里的 `list`。
 *
 * 该命名空间在客户端是以**已提供的服务** `remote.workspaceFiles` 注册的
 * （`dsh-api-gateway` 的 `remoteServiceKey(namespace)`），而 `ctx.get` 读的是服务表、
 * 不做 inject 检查，因此这条路不需要 inject 声明；只是 `list` 是装在服务实例上的方法，
 * 取用时必须锁 `this`。
 *
 * @param ctx - 插件上下文。
 * @returns 可直接调用的 list；命名空间缺失时 undefined。
 */
function resolveWorkspaceList(ctx: ClientContext): WorkspaceList | undefined {
  let namespace: RemoteNamespaceLike | undefined
  try {
    namespace = ctx.get('remote.workspaceFiles') as RemoteNamespaceLike | undefined
  } catch (error) {
    console.error('[dsh-left-dock] ctx.get(remote.workspaceFiles) failed:', error)
    return undefined
  }
  if (namespace === undefined || namespace === null) return undefined
  const list = namespace.list
  return typeof list === 'function' ? list.bind(namespace) : undefined
}

/**
 * 动态绑定 `remote.workspaceFiles.list`：既是能力就绪的信号（组件据此自动重试），
 * 也让子 fiber 在命名空间下线时自动交还。
 *
 * @param ctx - 插件上下文（无 `ctx.inject` 时返回 undefined）。
 * @param assign - 就绪/失联回调，参数为可调用的 list。
 * @returns 清理函数；无法建立动态依赖时为 undefined。
 */
function bindRemoteList(
  ctx: ClientContext,
  assign: (list: WorkspaceList | undefined) => void,
): (() => void) | undefined {
  if (typeof ctx.inject !== 'function') return undefined
  let fiber: unknown
  try {
    fiber = ctx.inject(['remote', 'remote.workspaceFiles'], (scoped: InjectedClientContext) => {
      scoped.effect(() => {
        const namespace = scoped.remote?.workspaceFiles
        const list = namespace?.list
        assign(typeof list === 'function' ? list.bind(namespace) : undefined)
        return () => { assign(undefined) }
      })
    })
  } catch (error) {
    console.error('[dsh-left-dock] ctx.inject(remote.workspaceFiles) failed:', error)
    return undefined
  }
  return () => {
    assign(undefined)
    const disposable = fiber as { dispose?: () => void } | undefined
    if (disposable !== undefined && disposable !== null && typeof disposable.dispose === 'function') {
      disposable.dispose()
    }
  }
}

/**
 * 插件主体：注入样式、注册字典、把 `sidebar` 槽位换成左坞组件。
 * @param ctx - 客户端根上下文。
 */
function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots') as SlotsLike | undefined
  if (slots === undefined || slots === null) return
  if (typeof slots.register !== 'function' || typeof slots.inject !== 'function') return

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = name
    tag.textContent = CSS
    document.head.appendChild(tag)

    // locale 可选：可用就注册字典（注册项据此拿到合成 `t`），否则组件回退本地字典。
    const locale = ctx.get('locale') as LocaleLike | undefined
    const hasLocale = locale !== undefined && locale !== null
      && typeof locale.register === 'function' && typeof locale.bind === 'function'
    let stopDictionary: (() => void) | undefined
    if (hasLocale) {
      try {
        stopDictionary = locale.register(NS, { zh, en })
      } catch (error) {
        console.error('[dsh-left-dock] locale.register failed:', error)
      }
    }

    // sidebar.panellist 行元数据：读 + 订阅槽位变更，经 inject face 的 hooks 暴露成
    // 组件的 usePanels 选择器 hook。
    const panels = createObservable<readonly PanelMeta[]>([])
    const readPanels = (): readonly PanelMeta[] => {
      let entries: readonly SlotEntryLike[] = []
      try {
        entries = typeof slots.entriesOfSlot === 'function'
          ? slots.entriesOfSlot('sidebar.panellist')
          : (slots.entries?.('sidebar.panellist') ?? [])
      } catch {
        return []
      }
      return entries
        .map((entry): PanelMeta => ({
          id: String(entry?.options?.id ?? ''),
          order: typeof entry?.options?.order === 'number' ? entry.options.order : 0,
          label: labelOf(entry),
        }))
        .filter(panel => panel.id !== '')
        .sort((left, right) => left.order - right.order)
    }
    const syncPanels = (): void => { panels.set(readPanels()) }
    syncPanels()
    let stopPanels: (() => void) | undefined
    if (typeof slots.subscribe === 'function') {
      try {
        stopPanels = slots.subscribe('sidebar.panellist', syncPanels)
      } catch (error) {
        console.error('[dsh-left-dock] subscribe(sidebar.panellist) failed:', error)
      }
    }

    // 文件服务（`remote.workspaceFiles.list`）两条取用路径：
    //
    //   1) **动态 inject**：`ctx.inject(['remote','remote.workspaceFiles'], …)` 起的子
    //      fiber 里取一次并绑定 —— 它同时是「能力就绪」的信号，命名空间下线时子 fiber
    //      被回收、信号自动熄灭（组件据此自动重试/收敛）；
    //   2) **惰性兜底**：该命名空间在客户端就是一个名为 `remote.workspaceFiles` 的
    //      已提供服务（`dsh-api-gateway` 的 `remoteServiceKey`），`ctx.get` 读服务表、
    //      不做 inject 检查，因此每次调用都能重新解析一次，不怕信号迟到或错过。
    //
    // 之所以**不**把 `remote.workspaceFiles` 写进本插件的静态 `inject`：静态声明会让
    // 整条插件（连带会话面板）在该能力缺席时永不激活，而 ui-sidebar 已被本 bundle
    // 停用，左栏会直接空掉。
    const fileService = createObservable<boolean>(false)
    let boundList: WorkspaceList | undefined
    const publishFileService = (): void => {
      fileService.set(boundList !== undefined || resolveWorkspaceList(ctx) !== undefined)
    }
    const bindList = (list: WorkspaceList | undefined): void => {
      boundList = list
      publishFileService()
    }
    const stopRemote = bindRemoteList(ctx, bindList)
    // 命名空间可能在本插件 apply 之前就已挂载：先探一次，别让文件面板白等信号。
    publishFileService()

    // 注入分享：注册项声明的业务面。普通服务一律**调用时**取（`ctx.get` 不走 inject
    // 检查），这样即使某个内置包晚于本插件就绪，按钮也不会永久失效。
    const face = {
      startSession: (workspaceId?: string): void => {
        const uiWorkspace = ctx.get('uiWorkspace') as UiWorkspaceLike | undefined
        uiWorkspace?.startSession?.(workspaceId)
      },
      toggleSidebar: (): void => {
        const layout = ctx.get('layout') as LayoutLike | undefined
        layout?.toggleSidebar?.()
      },
      selectPanel: (panelId: string | null): void => {
        const layout = ctx.get('layout') as LayoutLike | undefined
        try {
          layout?.selectPanel?.(panelId)
        } catch (error) {
          // selectPanel 对未注册的 main 面板 key 会抛错（上游约定）；面板行点击失败不应炸掉左栏。
          console.error('[dsh-left-dock] layout.selectPanel failed:', error)
        }
      },
      setSidebarWidth: (px: number): void => {
        const actions = rootLayoutActions(slots)
        actions?.setSidebar?.(clampTrackWidth(px))
      },
      listDirectory: async (sessionId: string, path: string, signal: AbortSignal) => {
        const list = boundList ?? resolveWorkspaceList(ctx)
        if (list === undefined) {
          return { ok: false as const, error: { code: 'dock/no-service', message: 'remote.workspaceFiles' } }
        }
        return list(sessionId, path, signal)
      },
      openFile: (path: string, cwd: string, sessionId: string | undefined): boolean => {
        // dsh-text-editor 是普通提供的服务（ctx.provide），调用时取用即可，无需 inject。
        const editor = ctx.get('dsh-text-editor') as TextEditorLike | undefined
        if (editor === undefined || editor === null || typeof editor.openFile !== 'function') return false
        try {
          editor.openFile({ path, cwd, sessionId })
          return true
        } catch (error) {
          console.error('[dsh-left-dock] dsh-text-editor.openFile failed:', error)
          return false
        }
      },
      hooks: { panels, fileService },
    }

    const options: Record<string, unknown> = {
      name: 'sidebar',
      children: CHILDREN,
      inject: () => face,
    }
    // 只在 locale 面确实装好时才声明命名空间：声明了却没有 locale 面是装配错误。
    if (hasLocale && stopDictionary !== undefined) options['locale'] = NS

    // 等 `sidebar` 槽位被 ui-layout 声明后再注册（`slots.inject` 两种到达顺序都覆盖）。
    const stopRegistration = slots.inject('sidebar', () => slots.register(options, LeftDock))

    return () => {
      stopRegistration()
      stopRemote?.()
      stopPanels?.()
      stopDictionary?.()
      panels.dispose()
      fileService.dispose()
      tag.remove()
    }
  }, 'dsh-left-dock: left dock occupant')
}

export { apply }
