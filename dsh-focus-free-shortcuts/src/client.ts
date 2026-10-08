/**
 * 浏览器入口：为每个快捷键分组安装一个免聚焦桥接。
 *
 * keydown 派发给当前聚焦元素（没有聚焦元素时派给 `<body>`），内置占用者据此判断归属，
 * 因此它们在用户点进具体区域前都不响应。固定输入通道在每个 keydown 上先于可配置派发
 * 运行且可消费按键，所以每个桥接各自打开固定观察者，不依赖 DOM 焦点解析归属。
 *
 * 各桥接与它们跟随的键位：
 *
 *   - pane 命令（`⌘⌥Enter` / `⌘\`）→ `pane-keys.ts`；
 *   - page close（`page.close`，Web/macOS 为 `⌘⌥W`、Web/Windows/Linux 为 `Ctrl+Alt+W`）→
 *     `page-close.ts`；
 *   - stop（`Esc` `Esc`）→ `stop-sequence.ts`；
 *   - approval（`Enter` / `Esc`）→ `approval-keys.ts`；
 *   - question 取消（`Esc`）→ `question-keys.ts`；
 *   - focus composer（`⌘⌥J`，Windows/Linux 为 `Ctrl+Alt+J`）→ `focus-composer.ts`；
 *   - focus page（`⌘⌥K`，Windows/Linux 为 `Ctrl+Alt+K`）→ `focus-page.ts`：在 Web 上与内置
 *     `session.search` 的默认键位相撞，本桥有意保留该冲突；
 *   - page cycle（`⌘⌥←` / `⌘⌥→`，Windows/Linux 为 `Ctrl+Alt+←/→`）→ `page-cycle.ts`：
 *     含展开侧栏后的焦点交接与右栏页签行的滚动补偿（`strip-scroll.ts`）；
 *   - session cycle（`⌘↑` / `⌘↓`，Windows/Linux 为 `Ctrl+↑/↓`）与 session active cycle（`⌘⌥↑` /
 *     `⌘⌥↓`，Windows/Linux 为 `Ctrl+Alt+↑/↓`）→ `session-cycle.ts`；
 *   - session new（内置 `session.new`，Web/macOS 为 `⌘⌥N`、Web/Windows·Linux 为 `Ctrl+Alt+N`）→
 *     `session-new.ts`：不注册固定行、也不开固定输入观察者，只补内置命令够不着的终端那一格。
 *
 * `binding.ts` 提供两个快捷键目录共用的手势/绑定匹配，`capture.ts` 提供捕获阶段读数，
 * `focus-ring.ts` 提供 outline 抑制，`runtime.ts` 提供插件名、固定输入收窄与主视图
 * Session。内置命令不在快捷键目录里注册，桥接只跟随生效目录行或已挂载固定行。
 *
 * 各桥的机制与边界见 docs/dsh-focus-free-shortcuts/01-behavior-difference.md 与
 * docs/dsh-focus-free-shortcuts/03-fixed-input-and-pane-keys.md。
 */
import { installApprovalBridge } from './approval-keys.ts'
import { installFocusComposerBridge } from './focus-composer.ts'
import { installFocusPageBridge } from './focus-page.ts'
import { installPageCloseBridge } from './page-close.ts'
import { installPageCycleBridge } from './page-cycle.ts'
import { installPaneBridge } from './pane-keys.ts'
import { installQuestionBridge } from './question-keys.ts'
import { installSessionCycleBridge } from './session-cycle.ts'
import { installSessionNewBridge } from './session-new.ts'
import { installStopBridge } from './stop-sequence.ts'
import { name } from './runtime.ts'
import type {Context} from '@deepseek-ai/cordis'

export { name }

/** 固定输入由键盘服务提供；没有该服务就没有可桥接的内容。 */
export const inject = ['shortcuts']

/** 客户端插件主体：依次安装各分组的桥接。 */
export function apply(ctx: Context): void {
  installPaneBridge(ctx)
  installPageCloseBridge(ctx)
  installStopBridge(ctx)
  installApprovalBridge(ctx)
  installQuestionBridge(ctx)
  installFocusComposerBridge(ctx)
  installFocusPageBridge(ctx)
  installPageCycleBridge(ctx)
  installSessionCycleBridge(ctx)
  installSessionNewBridge(ctx)
}
