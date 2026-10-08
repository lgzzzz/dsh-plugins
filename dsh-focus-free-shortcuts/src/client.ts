/**
 * 浏览器入口：为每个快捷键分组安装一个免聚焦桥接。
 *
 * keydown 派发给当前聚焦元素（没有聚焦元素时派给 `<body>`），内置占用者据此判断归属，
 * 因此它们在用户点进具体区域前都不响应。固定输入通道在每个 keydown 上先于可配置派发
 * 运行且可消费按键，所以每个桥接各自打开固定观察者，不依赖 DOM 焦点解析归属：
 *
 *   - pane 命令（`⌘⌥Enter` / `⌘\`）→ `pane-keys.ts`；
 *   - page close（`page.close`，Web/macOS 为 `⌘⌥W`、Web/Windows/Linux 为 `Ctrl+Alt+W`）→
 *     `page-close.ts`：同一条活动 dock pane 回退，只关页面、不关窗口；
 *   - stop（`Esc` `Esc`）→ `stop-sequence.ts`；
 *   - approval（`Enter` / `Esc`）→ `approval-keys.ts`：额外挂 window 捕获阶段监听，
 *     在卡片自身的 React 处理器 `preventDefault()` 之前取走按键；
 *   - question 取消（`Esc`）→ `question-keys.ts`：读 `pendingInteraction` 槽并调用
 *     卡片自己的 `dismiss()`；
 *   - focus composer（`⌘⌥J`，Windows/Linux 为 `Ctrl+Alt+J`）→ `focus-composer.ts`：自挂固定行，
 *     另含终端内的捕获拦截；
 *   - focus page（`⌘⌥K`，Windows/Linux 为 `Ctrl+Alt+K`）→ `focus-page.ts`：自挂固定行，把键盘交给
 *     右栏**当前显示**的那一页（通常是终端，落到 `.xterm-helper-textarea`），另含终端内的捕获拦截；
 *     该键在 Web 上本属内置 `session.search`，本桥有意把它挤成冲突（理由见该模块的说明）；
 *   - page cycle（`⌘⌥←` / `⌘⌥→`，Windows/Linux 为 `Ctrl+Alt+←/→`）→ `page-cycle.ts`：自挂固定行，另含
 *     展开侧栏后的焦点交接，以及右栏页签行的滚动（`strip-scroll.ts`：注入一条作用域限定在右侧栏的
 *     `scroll-behavior: auto` 规则消掉换页签时的动画，并在切页前后记住 / 还原观察窗口 —— 相邻来回切
 *     时整行完全不动，只有目标芯片不在窗口里时才最小推移）；
 *   - session cycle（`⌘↑` / `⌘↓`，Windows/Linux 为 `Ctrl+↑/↓`）与 session active cycle（`⌘⌥↑` /
 *     `⌘⌥↓`，Windows/Linux 为 `Ctrl+Alt+↑/↓`）→ `session-cycle.ts`：自挂两条固定行，候选取左侧栏前三个工作区当前
 *     渲染出来的会话行，前者在全部候选里环状走、后者只走活跃会话，另有终端内的捕获拦截；
 *   - session new（内置 `session.new`，Web/macOS 为 `⌘⌥N`、Web/Windows·Linux 为 `Ctrl+Alt+N`）→
 *     `session-new.ts`：不注册固定行、也不开观察者，只补内置命令够不着的终端那一格 —— 捕获阶段
 *     拦下 `.xterm` 内的这一按并调用同一个 `uiWorkspace.startSession()`。
 *
 * `binding.ts` 提供两个快捷键目录共用的手势/绑定匹配，`capture.ts` 提供捕获阶段读数，
 * `focus-ring.ts` 提供 outline 抑制，`runtime.ts` 提供插件名、固定输入收窄与主视图
 * Session。内置命令不在快捷键目录里注册，桥接只跟随生效目录行或已挂载固定行。
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
