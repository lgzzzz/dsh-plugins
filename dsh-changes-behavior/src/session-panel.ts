/**
 * 会话面板里那行「本地变更」：从这一行打开本地变更页时按指定入口处理，打开即全屏。
 *
 * 上游 forge 客户端包在会话面板的「环境」分区里注册了一行本地变更
 * （`[data-session-panel-row][data-forge-local]`）：行主体是整行的主操作按钮
 * （`data-row-part="body"`），右侧「⋯」菜单里还有一项「查看变更」。两处最后都走
 * `openChanges(sessionId,{kind:'local'})` → `sidebarRight.openResourceIn(sessionId, <本地变更地址>)`，
 * 行主体与菜单项各自还会收起浮层版的面板。
 *
 * 本模块不拦点击：那一行点完还要收起浮层版面板，吞掉点击会让面板留在原地；而且同一行有两个
 * 入口（行主体、「⋯」菜单），菜单 portal 到 `document.body`，没有稳定锚点。判定放在打开入口
 * 上更稳：**打开的是当前会话的「本地变更」页、且此刻会话面板可见**，就算这一行的打开，交给
 * `installOpenPolicy` 的 `designated` 判定跳过「切回推挤」并切成全屏。
 *
 * 「会话面板可见」只读面板根的 `data-session-panel`（上游只在面板真正画出来时才输出，取值是
 * `docked` / `overlay`）。这一行就在面板里，所以只要用户点得到它，这个属性一定在；反过来，
 * 面板收起时既没有入口可点，也不会误判别的打开。
 *
 * 由此得到的行为：
 *
 *   - 行主体、行内「⋯」菜单的「查看变更」→ 打开本地变更页并切成全屏；
 *   - 右栏已经是全屏时从这一行打开 → 保持全屏（不会像「其余入口」那样被推回推挤）；
 *   - 会话面板不可见时打开本地变更页（例如其它插件经 `forgeChanges.open`）→ 仍按非全屏处理；
 *   - 打开的不是本地变更页（例如变更请求、文件、审查页）→ 与本行无关，不受影响。
 *
 * 上游锚点与边界见 docs/dsh-changes-behavior.md。
 */
import { localChangesAddress } from './card.ts'
import type { DocumentLike } from './dom.ts'

/** 插件 id：诊断前缀都用它。 */
export const name = 'dsh-changes-behavior'

/** 会话面板根元素的属性：只有面板真正画出来时才由上游输出（值 `docked` / `overlay`）。 */
export const PANEL_ATTRIBUTE = 'data-session-panel'

/**
 * 会话面板此刻是否可见。
 *
 * 面板按会话各画一份，其它会话的视图仍留在 DOM 里（带 `hidden`），先排除掉。读不到
 * `querySelectorAll`（测试替身 / 非浏览器环境）时按不可见处理。
 * @param doc - 目标文档。
 * @returns 是否存在一块可见的会话面板。
 */
export function sessionPanelVisible(doc: DocumentLike): boolean {
  const panels = doc.querySelectorAll?.(`[${PANEL_ATTRIBUTE}]`)
  if (panels === undefined) return false
  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index]
    if (panel === undefined) continue
    if (panel.closest?.('[hidden]') != null) continue
    return true
  }
  return false
}

/**
 * 这次打开是不是会话面板那行的「本地变更」。
 *
 * 只看两条事实：地址正好是这次打开所属会话的本地变更页，且会话面板此刻可见。地址里带会话
 * id，所以别的会话的本地变更页不会命中；按 kind 打开（没有地址）时直接返回 false。
 * @param address - 即将打开的地址；按 kind 打开时为 undefined。
 * @param sessionId - 这次打开所属的会话。
 * @param doc - 目标文档。
 * @returns 是否按指定入口处理。
 */
export function isSessionPanelLocalOpen(
  address: string | undefined,
  sessionId: string,
  doc: DocumentLike,
): boolean {
  if (address === undefined) return false
  if (address !== localChangesAddress(sessionId)) return false
  return sessionPanelVisible(doc)
}
