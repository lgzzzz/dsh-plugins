/**
 * 把上游 `sidebar.left.toggle`（「展开／收起左侧栏」）的可配置绑定清空。
 *
 * 这个命令由 `ui-layout` 在 `⌘B`（Desktop）/ `⌘⌥B`（Web macOS）/ `Ctrl+Alt+B`
 * （Web Windows、Linux）上注册。本插件原先又给它挂了一条 `Ctrl+Alt+B` 固定行；两者一起
 * 让左栏可以被键盘收起。现在左栏只允许因窗口变窄自动收起（守卫在
 * `dsh-ui-css-patches/src/sidebar.ts`），所以：
 *
 *   1. 固定行已经从 `TARGETS` 移除，按键不会再被本插件占用；
 *   2. 这里按官方设置页「清除快捷键」的同一操作 `edit({type:'set', binding:null})` 把
 *      官方绑定写成显式未绑定，快捷键目录里的键帽、按钮提示与设置页条目一起变空。
 *
 * 写入是持久的（`localStorage['dsh.keybindings.v1']` 的当前 runtime:platform 档），与用户在
 * 设置页手动清除等价；本插件卸载后不会自动恢复，需要到快捷键设置里重置。只在目录里该行
 * 仍有绑定时写一次，`stale` 用最新 revision 重试，其余失败只告警、不重试。
 *
 * 注意：清空绑定只影响可配置派发；若有别处直接调 `registry.invoke('sidebar.left.toggle')`，
 * 动作仍会执行——左栏的「不收起」由布局守卫兜底，不依赖这里。
 */
import type { Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { name } from './runtime.ts'

/** 上游左栏开关命令的 id。 */
export const LEFT_SIDEBAR_TOGGLE_ID = 'sidebar.left.toggle' as ShortcutCommandId

/** 一次解绑最多重试几次 revision 过期。 */
const MAX_STALE_RETRIES = 3

/** 默认告警：统一加插件前缀。 */
function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}

/**
 * 目录里这一行是否仍有一个生效的绑定。
 * @param shortcuts - 快捷键服务面。
 * @returns 行不存在或绑定为空（`null` / `undefined`）时 false。
 */
export function leftSidebarShortcutBound(shortcuts: Shortcuts): boolean {
  const row = shortcuts.catalog.getSnapshot().find((entry) => entry.id === LEFT_SIDEBAR_TOGGLE_ID)
  return row !== undefined && row.binding != null
}

/**
 * 清空左栏开关的官方绑定，并在配置 / 目录更新时补做（例如用户在设置页重置了快捷键）。
 * @param shortcuts - 快捷键服务面。
 * @param report - 诊断输出，默认 `console.warn`。
 * @returns 取消订阅的清理函数。
 */
export function removeLeftSidebarShortcut(
  shortcuts: Shortcuts,
  report: (message: string, detail?: unknown) => void = warn,
): () => void {
  // 服务面可能来自测试替身或旧版本，缺少订阅 / 写入能力时整项不装。
  if (typeof shortcuts.catalog?.subscribe !== 'function'
    || typeof shortcuts.config?.subscribe !== 'function'
    || typeof shortcuts.edit !== 'function') return () => {}

  let disposed = false
  let inFlight = false
  let failed = false
  let staleRetries = 0

  const attempt = (): void => {
    if (disposed || inFlight || failed) return
    const config = shortcuts.config.getSnapshot()
    if (config.status !== 'ready') return
    if (!leftSidebarShortcutBound(shortcuts)) return
    inFlight = true
    shortcuts.edit({ type: 'set', id: LEFT_SIDEBAR_TOGGLE_ID, binding: null }, config.revision)
      .then((result) => {
        inFlight = false
        if (disposed) return
        if (result.status === 'saved') return
        if (result.status === 'stale' && staleRetries < MAX_STALE_RETRIES) {
          staleRetries += 1
          attempt()
          return
        }
        failed = true
        report(`左侧栏快捷键解绑失败（${result.status}）`)
      }, (error: unknown) => {
        inFlight = false
        if (disposed) return
        failed = true
        report('左侧栏快捷键解绑失败', error)
      })
  }

  const offCatalog = shortcuts.catalog.subscribe(attempt)
  const offConfig = shortcuts.config.subscribe(attempt)
  attempt()
  return () => {
    disposed = true
    offCatalog()
    offConfig()
  }
}
