/**
 * 浏览器入口：固定键组 + 免聚焦桥接组。
 *
 * 固定键组把八条快捷键注册成官方快捷键服务的只读固定行，命中后调用官方命令注册表，
 * 由官方命令自己的 `resolve()` / `run()` 执行动作；面板全屏与关闭当前页面在 Web 上
 * 另走一层免聚焦回退（`sidebarRight.commandTarget()`），焦点不在右栏时也能执行。
 *
 * 免聚焦桥接组处理内置命令够不着的状态与键位：连按两下 `Esc` 停止、审批面板
 * `Enter` / `Esc`、提问卡片 `Esc`、全屏右栏 `Esc` 关栏、`⌘⌥J` 聚焦输入框、
 * `⌘⌥K` 聚焦右栏当前页面、`⌘⌥←/→` 切换右栏页面、`⌘↑/↓` 与 `⌘⌥↑/↓` 导航会话，
 * 以及 `⌘\` 分屏。它们各自打开固定输入观察者，在可配置派发之前消费按键；落在
 * `.xterm` 内的按键由各桥的捕获阶段监听接管。
 *
 * 各桥的机制与边界见 docs/dsh-keyboard-shortcuts/ 下的分册。
 */
import { installApprovalBridge } from './approval-keys.ts'
import { installFixedKeyBridge, type ClientContext } from './fixed-keys.ts'
import { installFocusComposerBridge } from './focus-composer.ts'
import { installFocusPageBridge } from './focus-page.ts'
import { installFullscreenDismissBridge } from './fullscreen-dismiss.ts'
import { installPageCycleBridge } from './page-cycle.ts'
import { installPaneSplitBridge } from './pane-split.ts'
import { installQuestionBridge } from './question-keys.ts'
import { installSessionCycleBridge } from './session-cycle.ts'
import { installStopBridge } from './stop-sequence.ts'
import { name } from './runtime.ts'
import type {Context} from '@deepseek-ai/cordis'

export { name }

/** 固定输入由键盘服务提供；没有该服务就没有可桥接的内容。 */
export const inject = ['shortcuts']

/** 客户端插件主体：依次安装各分组。 */
export function apply(ctx: Context): void {
  // 免聚焦桥先装：它们各自消费自己的按键，固定键组只处理另外八条组合。
  installStopBridge(ctx)
  installApprovalBridge(ctx)
  installQuestionBridge(ctx)
  installFullscreenDismissBridge(ctx)
  installFocusComposerBridge(ctx)
  installFocusPageBridge(ctx)
  installPageCycleBridge(ctx)
  installSessionCycleBridge(ctx)
  installPaneSplitBridge(ctx)
  installFixedKeyBridge(ctx as unknown as ClientContext)
}
