/** 右栏「变更审阅」diff 与文档预览的视图开关(⌘/Ctrl+D 自动换行;⌘/Ctrl+Alt+D 等改绑后的 diff 分栏)。
 *
 * 目标 = **当前面板的当前标签**(布局取自 `rightbar.session` store 的 `bySession[id].layout`;
 * `activePaneId` 由上游 dockkit `focusPane` 写入,**浮窗被聚焦时就是那个浮窗**);
 * 按标签记录上的 `kind` 映射到承载该页视图状态的注册项 key,再经三步取数
 * (entries → 会话作用域绑定 → resolveStore)拿活实例,调上游 store 动作 ——
 * 与页头工具条按钮调的是同一个动作、同一份内存态,故鼠标与快捷键看到的开关状态一致。
 *
 * 无降级:链路任一环缺失、动作不是函数或调用抛错即 no-op(分发器据此不吞键),不回退 DOM 点击。
 * 目前只有变更审阅有分栏(`toggledSplit`),变更审阅与文档预览都有换行(`toggledWrap`)。
 * 分栏**没有默认键位**:⌘/Ctrl+S 只切全屏、不再顺带设置分栏,分栏只在键位改绑后由
 * `toggleRightSidebarDiffSplit` 手动切换(「分栏持续跟随全屏」由 dsh-rightbar-diff-split 负责)。
 * **吞键由分发器决定**:⌘/Ctrl+D(换行)恒吞(浏览器默认是「添加书签」,见 client.ts)。
 */
import type { RightbarViewActionsLike, RightbarViewStateLike, RightbarViewStoreLike, Services, SidebarRightLayoutLike, SlotEntryLike, SlotsLike } from './types.ts'
import { currentRightbarLayout } from './rightbar-layout.ts'
import { currentSessionId } from './session-view.ts'
import { sessionScopeBinding } from './scope-binding.ts'

/** 页 body 注册的 slot(右栏每种页把自己的 store handle 声明在注册项上)。 */
const PANE_TAB_SLOT = 'sidebar.right.pane.tab'

/** 变更审阅页的注册项 key(分栏与换行都在它的 store 上)。 */
const REVIEW_ENTRY_KEY = '@deepseek-ai/dsh-client-ui-deliverables'

/** 标签 kind → 承载该 kind 视图状态的注册项 cell key(注册项自己声明的实现身份)。 */
const VIEW_ENTRY_BY_KIND: Readonly<Record<string, string>> = {
  // ui-deliverables:变更审阅(左右 / 单栏对比 + 换行)
  'changes-review': REVIEW_ENTRY_KEY,
  // ui-sidebar-documentpreview:文件 / 文本 / 代码 / Markdown 预览(换行)
  text: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview',
}

/** 当前面板的当前标签(id + 记录)。 */
interface ActiveTab {
  readonly tabId: string
  readonly kind: string | undefined
}

/** 变更审阅 diff 分栏的 toggle 入口(默认不绑键位,只在 localStorage 改绑后可用)。 */
export function toggleRightSidebarDiffSplit(services: Services): boolean {
  return toggleActiveTabView(services, 'toggledSplit')
}

/** ⌘/Ctrl+D:当前标签(变更审阅 diff / 文件预览)切换自动换行。 */
export function toggleRightSidebarWrap(services: Services): boolean {
  return toggleActiveTabView(services, 'toggledWrap')
}

/**
 * 对当前面板的当前标签执行一个视图动作。
 * @param services - 插件解析后的服务集合。
 * @param action - 视图 store 动作名(该页没有这个动作即 no-op)。
 * @returns 动作是否真的调到了(分发器据此决定吞键)。
 */
function toggleActiveTabView(services: Services, action: 'toggledSplit' | 'toggledWrap'): boolean {
  const active = activeRightbarTab(services)
  if (active === undefined) return false
  const entryKey = active.kind === undefined ? undefined : VIEW_ENTRY_BY_KIND[active.kind]
  if (entryKey === undefined) return false
  const actions = resolveViewActions(services, entryKey)
  if (actions === undefined) return false
  const toggle = actions[action]
  if (typeof toggle !== 'function') return false
  try {
    ;(toggle as (tabId: string) => void).call(actions, active.tabId)
    return true
  } catch {
    // 上游对该标签还没有视图状态桶(页 body 未挂载)时会抛;保持 no-op
    return false
  }
}

/** 当前会话右栏当前面板的当前标签;布局 / 面板 / 标签记录任一层不可用即 undefined。 */
function activeRightbarTab(services: Services): ActiveTab | undefined {
  const layout = currentRightbarLayout(services)
  if (layout === undefined) return undefined
  const pane = activePane(layout)
  if (pane === undefined) return undefined
  const tabId = pane.activeTabId
  if (typeof tabId !== 'string' || tabId === '') return undefined
  const record = layout.tabs?.[tabId]
  if (record === undefined || record === null) return undefined
  return { tabId, kind: typeof record.kind === 'string' ? record.kind : undefined }
}

/** 按 id 取当前面板(节点缺失 / 非 pane 即 undefined)。 */
function activePane(layout: SidebarRightLayoutLike): { activeTabId?: string } | undefined {
  const paneId = layout.activePaneId
  if (typeof paneId !== 'string' || paneId === '') return undefined
  const node = layout.nodes?.[paneId]
  if (node === undefined || node === null || node.kind !== 'pane') return undefined
  return node
}

/** 取指定注册项的视图 store 动作面:按 cell key 认注册项,再经会话作用域绑定 resolveStore 到活实例。 */
function resolveViewActions(services: Services, entryKey: string): RightbarViewActionsLike | undefined {
  const slots = services.slots
  if (slots === null || slots === undefined) return undefined
  if (typeof slots.entries !== 'function' || typeof slots.resolveStore !== 'function') return undefined
  const sessionId = currentSessionId(services)
  if (sessionId === undefined) return undefined
  const binding = sessionScopeBinding(services, sessionId)
  if (binding === undefined) return undefined

  for (const entry of entriesOf(slots)) {
    if (entry === undefined || entry === null) continue
    // 注册项的 cell key = 实现包身份;slots 已按 priority 升序返回,故首个匹配即渲染胜出项
    if (entry.options?.key !== entryKey) continue
    const handle = entry.store
    if (handle === undefined || handle === null) continue
    let instance: unknown
    try {
      instance = slots.resolveStore(handle, binding)
    } catch {
      continue
    }
    const actions = asViewActions(instance)
    if (actions !== undefined) return actions
  }
  return undefined
}

/** slot 注册项列表(服务异常 / 形状不符即空)。 */
function entriesOf(slots: SlotsLike): readonly SlotEntryLike[] {
  try {
    const entries = slots.entries?.(PANE_TAB_SLOT)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** 活实例形状校验:快照必须是 { byTab } 对象且实例带 actions(否则视为没取到 store)。 */
function asViewActions(instance: unknown): RightbarViewActionsLike | undefined {
  if (typeof instance !== 'object' || instance === null) return undefined
  const getSnapshot = (instance as { getSnapshot?: unknown }).getSnapshot
  if (typeof getSnapshot !== 'function') return undefined
  let snapshot: unknown
  try {
    snapshot = (getSnapshot as () => unknown).call(instance)
  } catch {
    return undefined
  }
  if (typeof snapshot !== 'object' || snapshot === null) return undefined
  const byTab = (snapshot as RightbarViewStateLike).byTab
  if (typeof byTab !== 'object' || byTab === null || Array.isArray(byTab)) return undefined
  const actions = (instance as RightbarViewStoreLike).actions
  if (typeof actions !== 'object' || actions === null) return undefined
  return actions
}
