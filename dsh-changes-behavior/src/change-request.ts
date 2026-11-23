/**
 * 把「变更请求」键解析成右栏变更页的地址。
 *
 * 右栏的变更页由 forge 客户端包注册的 `forge-changes` 页类型提供，地址是
 * `dsh-resource://forge-changes/<session>/change/<url>`（某个变更请求）或 `.../local`（本地变更）。
 * 会话绑定了哪些变更请求只有面板流 `forgePanel.follow` 知道：它的第一帧按「首次记录顺序」
 * 列出已绑定项，第一张卡片就是键要打开的页面；没有绑定时调用方回落到本地变更页，键总能
 * 打开一个变更页。
 *
 * 读流带超时：Host 第一次被关注时要先检查检出与登录状态，慢的时候不值得让按键一直悬着 ——
 * 超时、读取失败与调用抛错一样按「没有绑定」处理。
 */

/** 变更页地址前缀；后面依次是组件编码的会话 id 与 `/change/<编码后的 URL>` 或 `/local`。 */
export const CHANGES_PAGE_PREFIX = 'dsh-resource://forge-changes/'

/** 等待面板流第一帧的上限（毫秒）。 */
export const CHANGE_REQUEST_TIMEOUT_MS = 1500

/** 面板流一帧里本模块读取的最小面。 */
export interface ForgePanelFrame {
  /** 该会话已绑定的变更请求，按首次记录顺序排列。 */
  readonly changeRequests?: readonly ForgePanelChangeRequest[]
}

/** 一条绑定；本模块只用它的 `url`。 */
export interface ForgePanelChangeRequest {
  /** 代码托管平台上的变更请求链接。 */
  readonly url?: unknown
}

/** `ctx.remote.forgePanel` 里本模块用到的唯一方法。 */
export interface ForgePanelSource {
  follow(sessionId: string, signal?: AbortSignal): AsyncIterable<ForgePanelFrame>
}

/**
 * 某个变更请求的变更页地址。
 * @param sessionId - 右栏当前会话。
 * @param url - 变更请求链接。
 * @returns `dsh-resource://forge-changes/<sessionId>/change/<url>`，两段都做 URI 编码。
 */
export function changeRequestAddress(sessionId: string, url: string): string {
  return `${CHANGES_PAGE_PREFIX}${encodeURIComponent(sessionId)}/change/${encodeURIComponent(url)}`
}

/**
 * 第一帧里第一个可用绑定变更请求的 URL。
 * @param source - 面板流（`ctx.remote.forgePanel`）。
 * @param sessionId - 右栏当前会话。
 * @param timeoutMs - 等待第一帧的上限，超时后中止流并返回 undefined。
 * @returns 变更请求链接；没有绑定、读取失败或超时时为 undefined。
 */
export async function firstChangeRequestUrl(
  source: ForgePanelSource,
  sessionId: string,
  timeoutMs: number = CHANGE_REQUEST_TIMEOUT_MS,
): Promise<string | undefined> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(undefined)
    }, timeoutMs)
  })
  let handle: AsyncIterable<ForgePanelFrame>
  try {
    handle = source.follow(sessionId, controller.signal)
  } catch {
    clearTimeout(timer)
    return undefined
  }
  const first = (async (): Promise<string | undefined> => {
    for await (const frame of handle) {
      const url = frame?.changeRequests?.[0]?.url
      return typeof url === 'string' && url.length > 0 ? url : undefined
    }
    return undefined
  })().catch(() => undefined)
  try {
    return await Promise.race([first, timeout])
  } finally {
    clearTimeout(timer)
    const { dispose } = handle as { dispose?: () => void }
    if (typeof dispose === 'function') dispose.call(handle)
  }
}
