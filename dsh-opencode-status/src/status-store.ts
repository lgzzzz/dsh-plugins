/**
 * 浏览器半部的进程内读数：整页只轮询一次，面板挂载点与后续会话共用同一份。
 *
 * 面板分区在打开会话时会卸载重挂，把轮询放在组件里就意味着每次重挂都从「还没有数据」开始，
 * 面板先空一阵再出现。这里把「轮询 + 最近一份响应」提到模块级：
 *
 *   - 页面装载（插件 `apply`）就启动后台轮询，之后不管面板挂没挂载都按 5 秒节奏取数；
 *   - 面板挂载时同步读 {@link StatusStore.current}，第一帧就有读数；
 *   - 订阅只影响通知，不启停轮询；后台标签页由 `pollStatus` 自己跳过请求。
 *
 * 失败策略与原来一致：一次成功之后刷新失败，保留最后一份成功读数，不清空整栏；从未成功过
 * 才把 `{ ok: false }` 交给排版层画「暂时无法获取」。
 */

import { pollStatus } from './status-client.ts'
import type { PollStatusOptions } from './status-client.ts'
import type { OpencodeStatusReply } from './wire.ts'

/** 读数监听函数：每次共享读数变化时调用。 */
export type StatusListener = (reply: OpencodeStatusReply) => void

/** 进程内共享的读数仓。 */
export interface StatusStore {
  /** 最近一份读数；还没有任何响应时为 undefined。 */
  current(): OpencodeStatusReply | undefined
  /** 订阅读数变化；返回取消订阅。不会启停轮询。 */
  subscribe(listener: StatusListener): () => void
  /** 启动后台轮询；重复调用无副作用。 */
  start(): void
  /** 停止后台轮询；内存里的读数保留，重新挂载时仍然立即可用。 */
  stop(): void
}

/**
 * 创建一个读数仓。
 * @param pollOptions - 轮询参数（测试注入假 fetch / 短间隔；页面用默认值）。
 * @returns 读数仓。
 */
export function createStatusStore(pollOptions: PollStatusOptions = {}): StatusStore {
  let reply: OpencodeStatusReply | undefined
  let stopPolling: (() => void) | undefined
  const listeners = new Set<StatusListener>()

  /**
   * 接受一份轮询结果。
   *
   * 成功响应照单全收；一次成功之后再失败就丢弃（保留最后一次成功读数），
   * 从未成功过时才把失败交给排版层。
   * @param next - 刚取到的响应。
   */
  const accept = (next: OpencodeStatusReply): void => {
    if (reply !== undefined && reply.ok && !next.ok) return
    reply = next
    for (const listener of [...listeners]) {
      try {
        listener(next)
      } catch {
        // 单个订阅者（例如正在卸载的组件）失败不影响其它订阅者与轮询。
      }
    }
  }

  return {
    current: () => reply,

    subscribe(listener: StatusListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    start(): void {
      if (stopPolling !== undefined) return
      stopPolling = pollStatus(accept, pollOptions)
    },

    stop(): void {
      stopPolling?.()
      stopPolling = undefined
    },
  }
}

/** 页面共用的读数仓：页面装载后由 `client.ts` 启动，组件只读取与订阅。 */
export const statusStore = createStatusStore()
