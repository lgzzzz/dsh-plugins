/**
 * 会话统计气泡的正文还原：把按钮上的最近 5 步读数改回全会话口径。
 *
 * 上游 `ActivityPill` 把同一个 `speed` 字符串同时用在按钮第二段和气泡的「输出速度」行，
 * 标题值又复用第一段 `counts`，所以只改 `t` 时按钮与气泡无法分开。这里在气泡挂到
 * `document.body` 之后，把气泡里的两处文本节点改回全会话读数：
 *
 *   - 标题值：`N 轮 N 步 · 最近时长` → `N 轮 N 步`（气泡标题与正文一起回到全会话）；
 *   - 输出速度行：最近 5 步 TPS → 全会话 TPS（正文的 TTFT 行本来由上游按全会话计算）。
 *
 * 只改文本节点的 `nodeValue`，不替换 React 创建的元素与文本节点：React 下一次重写这
 * 两个节点时包装层会再同步一次。气泡以 `<dl data-session-stats-details>` 为识别标记，
 * 用量按钮的另一个气泡（`data-session-stats-usage`）不受影响。
 *
 * @module dsh-stats-ttft/dialog
 */
import type { DialogTexts } from './ttft.ts'

/** 元素节点。 */
const ELEMENT_NODE = 1

/** 文本节点。 */
const TEXT_NODE = 3

/** 气泡正文的识别标记：上游在会话统计面板的 `<dl>` 上写的 data 属性。 */
export const DIALOG_MARKER = 'dl[data-session-stats-details]'

/**
 * 安装期依赖的最小节点形状（测试接缝；上游没有公开这条 DOM 契约）。
 */
export interface PatchNode {
  /** `Node.nodeType`。 */
  readonly nodeType: number
  /** 文本节点的值；元素节点通常为 null。 */
  nodeValue?: string | null
  /** 子节点；文本节点没有子节点。 */
  readonly childNodes?: ArrayLike<PatchNode>
  /** 找气泡正文标记；只有元素节点有。 */
  querySelector?(selector: string): unknown
  /** 判断节点是否仍在文档里；只有元素/文档节点有。 */
  contains?(node: PatchNode): boolean
}

/** 一条 MutationRecord 里本模块用到的部分。 */
export interface PatchRecord {
  readonly addedNodes?: ArrayLike<PatchNode>
}

/** 安装期依赖的最小 MutationObserver 形状。 */
export interface PatchObserver {
  observe(target: PatchNode, options: { childList: boolean; subtree: boolean }): void
  disconnect(): void
}

/** MutationObserver 的构造器形状。 */
export interface PatchObserverConstructor {
  new (callback: (records: readonly PatchRecord[]) => void): PatchObserver
}

/** 安装期依赖的最小 document 形状。 */
export interface PatchDocument {
  /** 气泡的 portal 容器：上游 `createPortal(..., document.body)` 把面板直接挂到 body 上。 */
  readonly body?: PatchNode | null
  /** 取 MutationObserver；没有时只做手动同步。 */
  readonly defaultView?: { MutationObserver?: PatchObserverConstructor }
}

/** 安装后返回的控制器：`sync()` 重新核对一次，`dispose()` 释放观察。 */
export interface DialogPatchController {
  sync(): void
  dispose(): void
}

/** 没有 document 或没有 body 时的空控制器。 */
const NOOP_CONTROLLER: DialogPatchController = { sync: () => {}, dispose: () => {} }

/** 把一对 from/to 收成可用的改写；任一为空或相同就返回 null。 */
function pair(from: string | null, to: string | null): readonly [string, string] | null {
  if (from === null || to === null || from === to) return null
  return [from, to]
}

/**
 * 改写一个气泡里的标题值与速度行。
 *
 * @param root - 气泡面板（或其祖先）。
 * @param texts - 两对 from/to 文本；为 null 的那对不改。
 * @returns 本次是否改动了文本节点。
 */
export function patchDialogText(root: PatchNode, texts: DialogTexts): boolean {
  if (root.nodeType !== ELEMENT_NODE || typeof root.querySelector !== 'function') return false
  if (root.querySelector(DIALOG_MARKER) === null) return false

  const counts = pair(texts.countsFrom, texts.countsTo)
  const speed = pair(texts.speedFrom, texts.speedTo)
  if (counts === null && speed === null) return false

  let changed = false
  const visit = (node: PatchNode): void => {
    if (node.nodeType === TEXT_NODE) {
      const value = node.nodeValue
      if (value === undefined || value === null) return
      if (counts !== null && value === counts[0]) {
        node.nodeValue = counts[1]
        changed = true
        return
      }
      if (speed !== null && value === speed[0]) {
        node.nodeValue = speed[1]
        changed = true
      }
      return
    }
    const children = node.childNodes
    if (children === undefined) return
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]
      if (child !== undefined) visit(child)
    }
  }
  visit(root)
  return changed
}

/**
 * 装上气泡还原：初始扫一遍 body，之后在气泡插入时补一次，并在包装层每次同步时
 * 重新核对（React 重写文本节点后靠这一步改回来）。
 *
 * @param doc - 文档（默认在客户端传入全局 `document`）。
 * @param read - 读取当前要还原的两对文本。
 * @returns 控制器；没有 body 时是空实现。
 */
export function installDialogPatch(
  doc: PatchDocument | undefined,
  read: () => DialogTexts,
): DialogPatchController {
  const body = doc?.body
  if (doc === undefined || body === undefined || body === null) return NOOP_CONTROLLER

  const dialogs = new Set<PatchNode>()
  let disposed = false

  /** 记住一个带正文标记的气泡面板。 */
  const remember = (node: PatchNode): void => {
    if (node.nodeType !== ELEMENT_NODE || typeof node.querySelector !== 'function') return
    if (node.querySelector(DIALOG_MARKER) === null) return
    dialogs.add(node)
  }

  /** 对已知气泡重新核一遍，顺手淘汰已经从 body 上摘掉的面板。 */
  const sync = (): void => {
    if (disposed) return
    const texts = read()
    for (const dialog of dialogs) {
      if (typeof body.contains === 'function' && body.contains(dialog) === false) {
        dialogs.delete(dialog)
        continue
      }
      patchDialogText(dialog, texts)
    }
  }

  // 插件挂载时气泡可能已经开着（例如遮蔽项在会话切换后重建）。
  const children = body.childNodes
  if (children !== undefined) {
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]
      if (child !== undefined) remember(child)
    }
  }
  sync()

  const Observer = doc.defaultView?.MutationObserver
  let observer: PatchObserver | null = null
  if (typeof Observer === 'function') {
    observer = new Observer((records) => {
      if (disposed) return
      for (const record of records) {
        const added = record.addedNodes
        if (added === undefined) continue
        for (let index = 0; index < added.length; index += 1) {
          const child = added[index]
          if (child !== undefined) remember(child)
        }
      }
      sync()
    })
    observer.observe(body, { childList: true, subtree: true })
  }

  return {
    sync,
    dispose: () => {
      if (disposed) return
      disposed = true
      observer?.disconnect()
      observer = null
      dialogs.clear()
    },
  }
}
