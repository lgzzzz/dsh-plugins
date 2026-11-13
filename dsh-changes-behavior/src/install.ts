/**
 * 改动面板行为的总装：把六条彼此独立的默认行为装到同一个客户端插件里。
 *
 *   1. **打开呈现策略**（`presentation.ts`）：指定入口默认全屏，其余打开一律非全屏；
 *   2. **改动卡片入口**（`card.ts`）：标题打开「本地变更」并切全屏，右键回到本轮快照 diff；
 *   3. **审查分栏默认**（`split-default.ts`）：非全屏单栏、全屏左右对比；
 *   4. **审查换行默认**（`wrap-default.ts`）：新审查标签页默认自动换行；
 *   5. **卡片悬停浮层关闭**（`hover-gate.ts`）与**字号 14px**（`font-14.ts`）；
 *   6. **文件树宽度记忆**（`tree-width.ts`）：拖动 / 键盘调整后把「本地变更」「变更请求」
 *      的文件树宽度写进 localStorage，新挂载的文件树恢复上次的宽度。
 *
 * 这些行为原先分在五个插件里（文件树宽度是后加的一条），彼此都只依赖上游 DOM 锚点与右栏公开面，没有共享服务或
 * 配置；合并后仍然各自独立安装、独立失败：某一条的锚点失效只影响它自己，不会阻止其余
 * 行为。总装上只多一个文档根标记 `data-dsh-changes-behavior`，卸载时逆序清理全部监听、
 * 观察器、样式、菜单贡献与服务包层。
 *
 * 上游锚点、覆盖边界与手工验证方式见 docs/dsh-changes-behavior.md。
 */
import type { Context } from '@deepseek-ai/cordis'
import { installCardBehavior, serviceOf } from './card.ts'
import { installFont14 } from './font-14.ts'
import { installHoverGate } from './hover-gate.ts'
import { installOpenPolicy } from './presentation.ts'
import { installReviewSplitDefault } from './split-default.ts'
import { installTreeWidthMemory } from './tree-width.ts'
import { installReviewWrapDefault } from './wrap-default.ts'
import type { DocumentLike } from './dom.ts'

/** 插件 id：诊断前缀、文档标记与客户端模块 id 都用它。 */
export const name = 'dsh-changes-behavior'

/** 文档根上的总生效标记：装上时写入，卸载时移除。 */
export const MARKER_ATTRIBUTE = 'data-dsh-changes-behavior'

/** 右栏服务面（`ctx.sidebarRight`）。 */
type Sidebar = Context['sidebarRight']

/** 运行期可注入项（测试接缝）：上游没有对应类型，测试用它替换告警输出。 */
export interface BehaviorRuntime {
  /** 输出一条带插件前缀的诊断。 */
  readonly warn?: (message: string) => void
}

/** 默认告警：统一加插件前缀。 */
function defaultWarn(message: string): void {
  console.warn(`[${name}] ${message}`)
}

/** 提取错误消息，避免把 `unknown` 直接拼进诊断。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 装上全部改动面板行为。
 *
 * @param ctx - 浏览器 Context（或其注入子作用域），已具备 `sidebarRight`。
 * @param runtime - 测试可注入的告警输出。
 * @param doc - 目标文档；非浏览器环境省略时整体为空操作。
 * @returns 卸载函数：逆序清理全部行为与文档标记。
 */
export function installChangesBehavior(
  ctx: Context,
  runtime: BehaviorRuntime = {},
  doc: DocumentLike | undefined = typeof document === 'undefined'
    ? undefined
    : document as unknown as DocumentLike,
): () => void {
  if (doc === undefined) return () => {}
  const warn = runtime.warn ?? defaultWarn
  const disposers: Array<() => void> = []

  /**
   * 安装一条行为；单条失败只告警，不阻断其余行为。
   * @param label - 诊断用名称。
   * @param install - 安装函数。
   */
  const add = (label: string, install: () => (() => void)): void => {
    try {
      disposers.push(install())
    } catch (error) {
      warn(`${label} install failed: ${messageOf(error)}`)
    }
  }

  doc.documentElement?.setAttribute(MARKER_ATTRIBUTE, '')

  const sidebar = serviceOf<Sidebar>(ctx, 'sidebarRight')
  if (sidebar === undefined) {
    warn('sidebarRight is unavailable; the open presentation policy is not installed')
  } else {
    add('open policy', () => installOpenPolicy(sidebar, doc, { warn }))
  }
  add('card behavior', () => installCardBehavior(ctx, { warn }, doc))
  add('review split default', () => installReviewSplitDefault(doc as unknown as Parameters<typeof installReviewSplitDefault>[0], { warn }))
  add('review wrap default', () => installReviewWrapDefault(doc as unknown as Parameters<typeof installReviewWrapDefault>[0], { warn }))
  add('hover gate', () => installHoverGate(doc as unknown as Parameters<typeof installHoverGate>[0]))
  add('font 14', () => installFont14(doc as unknown as Parameters<typeof installFont14>[0]))
  add('tree width', () => installTreeWidthMemory(doc as unknown as Parameters<typeof installTreeWidthMemory>[0], { warn }))

  return () => {
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try {
        disposers[index]?.()
      } catch (error) {
        warn(`dispose failed: ${messageOf(error)}`)
      }
    }
    disposers.length = 0
    doc.documentElement?.removeAttribute(MARKER_ATTRIBUTE)
  }
}
