/**
 * UI → 编排层的命令总线（只剩「差异」tab 的命令）。
 *
 * ui.ts（React 组件）不能反向 import controller.ts（否则依赖成环，而构建器
 * 拒绝环），所以组件只触发命令；controller.bind() 注册真正的处理函数。
 *
 * 文件面（右栏编辑器）不需要总线：正文组件直接调用 file-io.ts 的读写函数，
 * 该模块不 import 任何视图模块，构不成环。
 */
let diffNextHandler: (() => void) | null = null
let diffPrevHandler: (() => void) | null = null
let diffCloseHandler: (() => void) | null = null
let diffHunkNextHandler: (() => void) | null = null
let diffHunkPrevHandler: (() => void) | null = null

export function setDiffNextHandler(fn: (() => void) | null): void { diffNextHandler = fn }
export function setDiffPrevHandler(fn: (() => void) | null): void { diffPrevHandler = fn }
export function setDiffCloseHandler(fn: (() => void) | null): void { diffCloseHandler = fn }
export function setDiffHunkNextHandler(fn: (() => void) | null): void { diffHunkNextHandler = fn }
export function setDiffHunkPrevHandler(fn: (() => void) | null): void { diffHunkPrevHandler = fn }

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
