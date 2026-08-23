/**
 * UI → 编排层的命令总线。
 *
 * ui.ts（React 组件）不能反向 import controller.ts（否则依赖成环，而构建器
 * 拒绝环），所以组件只触发命令；controller.bind() 注册真正的处理函数。
 *
 * save/close 命令可携带文件 key：多个文件 tab 并存时，组件知道自己属于哪个
 * 文件（requestSave(fileKey) / requestClose(fileKey)）；不带 key 时按
 * 「当前活动文件」处理（如全局 Ctrl+S）。
 */
let saveHandler: ((key?: string) => void) | null = null
let closeHandler: ((key?: string) => void) | null = null
let diffNextHandler: (() => void) | null = null
let diffPrevHandler: (() => void) | null = null
let diffCloseHandler: (() => void) | null = null
let diffHunkNextHandler: (() => void) | null = null
let diffHunkPrevHandler: (() => void) | null = null

export function setSaveHandler(fn: ((key?: string) => void) | null): void { saveHandler = fn }
export function setCloseHandler(fn: ((key?: string) => void) | null): void { closeHandler = fn }
export function setDiffNextHandler(fn: (() => void) | null): void { diffNextHandler = fn }
export function setDiffPrevHandler(fn: (() => void) | null): void { diffPrevHandler = fn }
export function setDiffCloseHandler(fn: (() => void) | null): void { diffCloseHandler = fn }
export function setDiffHunkNextHandler(fn: (() => void) | null): void { diffHunkNextHandler = fn }
export function setDiffHunkPrevHandler(fn: (() => void) | null): void { diffHunkPrevHandler = fn }

/** 请求保存（缺省保存当前活动文件）。 */
export function requestSave(key?: string): void {
  if (saveHandler !== null) saveHandler(key)
}

/** 请求关闭编辑器（标签 × 被点击时；缺省关闭当前活动文件）。 */
export function requestClose(key?: string): void {
  if (closeHandler !== null) closeHandler(key)
}

/** 请求差异视图显示下一个文件。 */
export function requestDiffNext(): void {
  if (diffNextHandler !== null) diffNextHandler()
}

/** 请求差异视图显示上一个文件。 */
export function requestDiffPrev(): void {
  if (diffPrevHandler !== null) diffPrevHandler()
}

/** 请求关闭差异视图（标签 × 被点击时）。 */
export function requestDiffClose(): void {
  if (diffCloseHandler !== null) diffCloseHandler()
}

/** 请求差异视图内跳到「下一处修改」（当前文件内；到最后一处时跨到下一个文件的第一处）。 */
export function requestDiffHunkNext(): void {
  if (diffHunkNextHandler !== null) diffHunkNextHandler()
}

/** 请求差异视图内跳到「上一处修改」（当前文件内；到第一处时跨到上一个文件的最后一处）。 */
export function requestDiffHunkPrev(): void {
  if (diffHunkPrevHandler !== null) diffHunkPrevHandler()
}
