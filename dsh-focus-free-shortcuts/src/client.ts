/**
 * 浏览器入口：为每个快捷键分组安装一个免聚焦桥接。
 *
 * keydown 派发给当前聚焦元素（没有聚焦元素时派给 `<body>`），内置占用者据此判断归属，
 * 因此它们在用户点进具体区域前都不响应。固定输入通道在每个 keydown 上先于可配置派发
 * 运行且可消费按键，所以每个桥接各自打开固定观察者，不依赖 DOM 焦点解析归属：
 *
 *   - pane 命令（`⌘⌥Enter` / `⌘\`）→ `pane-keys.ts`；
 *   - stop（`Esc` `Esc`）→ `stop-sequence.ts`；
 *   - approval（`Enter` / `Esc`）→ `approval-keys.ts`：额外挂 window 捕获阶段监听，
 *     在卡片自身的 React 处理器 `preventDefault()` 之前取走按键；
 *   - question 取消（`Esc`）→ `question-keys.ts`：读 `pendingInteraction` 槽并调用
 *     卡片自己的 `dismiss()`；
 *   - focus composer（`Ctrl+Alt+J`）→ `focus-composer.ts`：自挂固定行；
 *   - page cycle（`Ctrl+Alt+←` / `Ctrl+Alt+→`）→ `page-cycle.ts`：自挂固定行，另含
 *     展开侧栏后的焦点交接。
 *
 * `binding.ts` 提供两个快捷键目录共用的手势/绑定匹配，`capture.ts` 提供捕获阶段读数，
 * `focus-ring.ts` 提供 outline 抑制，`runtime.ts` 提供插件名、固定输入收窄与主视图
 * Session。内置命令不在快捷键目录里注册，桥接只跟随生效目录行或已挂载固定行。
 */
import { installApprovalBridge } from './approval-keys.ts'
import { installFocusComposerBridge } from './focus-composer.ts'
import { installPageCycleBridge } from './page-cycle.ts'
import { installPaneBridge } from './pane-keys.ts'
import { installQuestionBridge } from './question-keys.ts'
import { installStopBridge } from './stop-sequence.ts'
import { name } from './runtime.ts'
import type {Context} from '@deepseek-ai/cordis'

export { name }

/** 固定输入由键盘服务提供；没有该服务就没有可桥接的内容。 */
export const inject = ['shortcuts']

/** 客户端插件主体：依次安装各分组的桥接。 */
export function apply(ctx: Context): void {
  installPaneBridge(ctx)
  installStopBridge(ctx)
  installApprovalBridge(ctx)
  installQuestionBridge(ctx)
  installFocusComposerBridge(ctx)
  installPageCycleBridge(ctx)
}
