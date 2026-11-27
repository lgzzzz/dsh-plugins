/**
 * 浏览器入口：固定键组 + 免聚焦桥接组。
 *
 * 固定键组把七条快捷键注册成官方快捷键服务的只读固定行，命中后调用官方命令注册表，
 * 由官方命令自己的 `resolve()` / `run()` 执行动作；面板全屏与关闭当前页面在 Web 上
 * 另走一层免聚焦回退（`sidebarRight.commandTarget()`），焦点不在右栏时也能执行。
 *
 * 免聚焦桥接组处理内置命令够不着的状态与键位：连按两下 `Esc` 停止、审批面板
 * `Enter` / `Esc`、提问卡片 `Esc`、全屏右栏 `Esc` 关栏、`⌘⌥J` 聚焦输入框、
 * `⌘⌥K` 聚焦右栏当前页面、`⌘⌥←/→` 切换右栏页面、`⌘↑/↓` 与 `⌘⌥↑/↓` 导航会话、
 * `⌘\` 分屏。它们各自打开固定输入观察者，
 * 在可配置派发之前消费按键；落在 `.xterm` 内的按键由各桥的捕获阶段监听接管。
 * 全屏关栏桥最先安装：它要用 `stopImmediatePropagation()` 把这一按收口，必须排在本插件
 * 其他 window 捕获钩子之前。
 *
 * 另装一条与固定键无关的 DOM 补偿：消息滚动口的 PageUp/PageDown 按“可见消息带”
 * 翻页，Space 的原生翻页在滚动口内被吞掉（见 `chat-paging.ts`）。
 *
 * 还把上游 `sidebar.left.toggle` 的官方绑定从快捷键偏好里清掉（本插件不再注册它的固定行）：
 * 左栏只允许因窗口变窄自动收起，手动收起在 `dsh-ui-css-patches` 的守卫里被拦住，快捷键也
 * 不再占用任何组合。见 `remove-sidebar-toggle.ts`。
 *
 * 各桥的机制与边界见 docs/dsh-keyboard-shortcuts/ 下的分册。
 */
import { installApprovalBridge } from './approval-keys.ts'
import { installChatPaging } from './chat-paging.ts'
import { installFixedKeyBridge } from './fixed-keys.ts'
import { installFocusComposerBridge } from './focus-composer.ts'
import { installFocusPageBridge } from './focus-page.ts'
import { installFullscreenDismissBridge } from './fullscreen-dismiss.ts'
import { installPageCycleBridge } from './page-cycle.ts'
import { installPaneSplitBridge } from './pane-split.ts'
import { installQuestionBridge } from './question-keys.ts'
import { removeLeftSidebarShortcut } from './remove-sidebar-toggle.ts'
import { installSessionCycleBridge } from './session-cycle.ts'
import { installStopBridge } from './stop-sequence.ts'
import { name } from './runtime.ts'
import type {Context} from '@deepseek-ai/cordis'

export { name }

/** 固定输入由键盘服务提供；没有该服务就没有可桥接的内容。 */
export const inject = ['shortcuts']

/** 客户端插件主体：依次安装各分组。 */
export function apply(ctx: Context): void {
  // 全屏关栏桥最先装：它在 window 捕获阶段用 stopImmediatePropagation() 收口这一按，
  // 必须排在本插件其他捕获钩子之前；关栏后的宽限期也由它记时（见 fullscreen-dismiss.ts）。
  installFullscreenDismissBridge(ctx)
  // 消息滚动口的翻页补偿不依赖固定键服务，先装；它只接管裸 PageUp/PageDown/Space。
  installChatPaging(ctx)
  // 免聚焦桥：它们各自消费自己的按键，固定键组只处理另外七条组合。
  installStopBridge(ctx)
  installApprovalBridge(ctx)
  installQuestionBridge(ctx)
  installFocusComposerBridge(ctx)
  installFocusPageBridge(ctx)
  installPageCycleBridge(ctx)
  installSessionCycleBridge(ctx)
  installPaneSplitBridge(ctx)
  installFixedKeyBridge(ctx)
  // 左栏快捷键整条移除：固定行已从 TARGETS 拿掉，这里再把官方可配置绑定清空。
  ctx.inject(['shortcuts'], (scope) => {
    scope.effect(() => removeLeftSidebarShortcut(scope.shortcuts), `${name}: left sidebar shortcut removed`)
  })
}
