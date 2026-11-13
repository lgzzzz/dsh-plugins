/**
 * 启动期把上游「单文件紧凑卡」改成汇总形制的补丁逻辑。
 *
 * 上游 `@deepseek-ai/dsh-client-ui-deliverables` 的 `ChangedFiles` 用一行初始化
 * 分出两条渲染路径：
 *
 *   const singleFile = changes.total === 1 ? changes.files[0] : undefined
 *
 * 有值时走紧凑卡（标题 `已编辑 <文件名>`、无文件行），为空时走汇总卡
 * （标题 `已编辑 N 个文件`、一份文件行列表）。上游没有开关，本插件在宿主启动时
 * 把该初始化改成恒为 `void 0`，单文件于是也走汇总形制。
 *
 * 必须写在启动期的原因与边界（`rebuilt()` 的必要性、标记幂等、失败只告警、
 * 卸载恢复）见 docs/dsh-changes-behavior.md。
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** 上游包名，同时也是 `clientModules` 表里的 entry id。 */
export const UPSTREAM_ID = '@deepseek-ai/dsh-client-ui-deliverables'

/** 补丁标记：识别人工 / 旧版插件写过的状态，也用作诊断前缀。 */
export const MARKER = 'dsh-changes-single-card'

/** 补丁后的初始化行；标记放在同一行，便于在产物里一眼认出。 */
export const PATCHED = `const singleFile=void 0;/*${MARKER}*/`

/**
 * 上游那条初始化的锚点。
 *
 * 容忍打包器的空白差异与 `void 0` / `undefined` 两种擦除结果；只命中第一处
 * （产物里只有这一处），不做全局替换。
 */
const ANCHOR = /const singleFile\s*=\s*changes\.total\s*===\s*1\s*\?\s*changes\.files\[0\]\s*:\s*(?:void 0|undefined)\s*;/

/** 补丁结果：写明三种状态，调用方据此决定要不要写文件。 */
export type PatchStatus = 'patched' | 'already' | 'missing'

/** `patchBundleText` 的返回值。 */
export interface PatchResult {
  readonly status: PatchStatus
  /** 打过补丁的全文；仅 `status === 'patched'` 时有值。 */
  readonly text?: string
}

/**
 * 在 bundle 文本上做纯函数补丁。
 * @param source - `lib/client.js` 的全文。
 * @returns 三种状态之一；`patched` 时附带新全文。
 */
export function patchBundleText(source: string): PatchResult {
  if (source.includes(MARKER)) return { status: 'already' }
  if (!ANCHOR.test(source)) return { status: 'missing' }
  return { status: 'patched', text: source.replace(ANCHOR, PATCHED) }
}

/** 宿主 `clientModules` 服务里本插件用到的两个方法。 */
export interface ClientModulesFace {
  /** 客户端 entry 的产物绝对路径。 */
  clientPath(id: string): string | undefined
  /** 重读产物、发布新的 rev 并通知订阅者。 */
  rebuilt(id: string): string | undefined
}

/** 诊断输出（默认 `console`；测试可替换）。 */
export interface Diagnostics {
  info(message: string): void
  warn(message: string): void
}

/** 重试参数：产物还没登记进 `clientModules` 时轮询，直到登记或超时。 */
export interface RetryOptions {
  /** 轮询间隔（毫秒）。省略时只尝试一次。 */
  readonly retryMs?: number
  /** 总超时（毫秒），默认 15 秒。 */
  readonly timeoutMs?: number
}

/**
 * 安装启动期补丁并返回卸载函数。
 *
 * 任何一步失败都收敛为「只记一条告警、不动上游」，因此可以在 `apply` 里直接调用：
 * 插件挂载不应因为上游产物不可写而失败。
 *
 * `clientModules` 服务刚注册时表可能还没填完（`clientPath` 返回 undefined），
 * 传 `retryMs` 后会在超时前轮询，等 entry 登记好再打补丁。
 * @param modules - 宿主 `clientModules` 服务。
 * @param diagnostics - 诊断输出。
 * @param options - 轮询参数；省略时只尝试一次。
 * @returns 卸载函数：文件仍是本插件写下的那份时恢复原内容。
 */
export function installSingleCardPatch(
  modules: ClientModulesFace,
  diagnostics: Diagnostics = console,
  options: RetryOptions = {},
): () => void {
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = options.retryMs === undefined ? 0 : Date.now() + (options.timeoutMs ?? 15_000)
  /** 打完补丁后的原文与补丁文，供卸载恢复。 */
  let patchedState: { path: string, original: string, patched: string } | undefined

  const attempt = (): void => {
    timer = undefined
    if (disposed) return
    let path: string | undefined
    try {
      path = modules.clientPath(UPSTREAM_ID)
    } catch (error) {
      diagnostics.warn(`[${MARKER}] clientPath(${UPSTREAM_ID}) failed: ${messageOf(error)}`)
      return
    }
    if (path === undefined) {
      if (options.retryMs !== undefined && Date.now() < deadline) {
        timer = setTimeout(attempt, options.retryMs)
        return
      }
      diagnostics.warn(`[${MARKER}] ${UPSTREAM_ID} 没有已登记的客户端产物，跳过单文件卡片补丁`)
      return
    }

    let original: string
    try {
      original = readFileSync(path, 'utf8')
    } catch (error) {
      diagnostics.warn(`[${MARKER}] 读取 ${path} 失败：${messageOf(error)}`)
      return
    }

    const result = patchBundleText(original)
    if (result.status === 'missing') {
      diagnostics.warn(`[${MARKER}] ${UPSTREAM_ID} 里找不到 singleFile 初始化，单文件卡片保持上游形制；锚点可能已变`)
      return
    }
    if (result.status === 'already') {
      diagnostics.info(`[${MARKER}] 单文件卡片补丁已在 ${path} 上，跳过`)
      return
    }

    const patched = result.text as string
    try {
      writeFileSync(path, patched)
    } catch (error) {
      diagnostics.warn(`[${MARKER}] 写入 ${path} 失败：${messageOf(error)}；单文件卡片保持上游形制`)
      return
    }
    try {
      modules.rebuilt(UPSTREAM_ID)
    } catch (error) {
      diagnostics.warn(`[${MARKER}] rebuilt(${UPSTREAM_ID}) 失败：${messageOf(error)}；刷新后可能仍是旧产物`)
    }
    patchedState = { path, original, patched }
    diagnostics.info(`[${MARKER}] 单文件卡片已改为汇总形制：${path}`)
  }

  attempt()

  return () => {
    disposed = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    const state = patchedState
    if (state === undefined) return
    try {
      if (readFileSync(state.path, 'utf8') !== state.patched) return
      writeFileSync(state.path, state.original)
    } catch {
      // 卸载期恢复失败不改变退出结果；下次启动仍会重新检测。
    }
  }
}

/** 提取错误消息，避免把 `unknown` 直接拼进诊断。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
