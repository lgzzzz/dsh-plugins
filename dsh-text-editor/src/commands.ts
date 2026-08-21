/**
 * UI → 编排层的命令总线。
 *
 * ui.ts（React 组件）不能反向 import controller.ts（否则依赖成环，而构建器
 * 拒绝环），所以组件只触发命令；controller.bind() 注册真正的处理函数。
 */
let saveHandler: (() => void) | null = null
let closeHandler: (() => void) | null = null
let diffNextHandler: (() => void) | null = null
let diffPrevHandler: (() => void) | null = null
let diffCloseHandler: (() => void) | null = null

export function setSaveHandler(fn: (() => void) | null): void { saveHandler = fn }
export function setCloseHandler(fn: (() => void) | null): void { closeHandler = fn }
export function setDiffNextHandler(fn: (() => void) | null): void { diffNextHandler = fn }
export function setDiffPrevHandler(fn: (() => void) | null): void { diffPrevHandler = fn }
export function setDiffCloseHandler(fn: (() => void) | null): void { diffCloseHandler = fn }

/** 请求保存当前编辑器内容。 */
export function requestSave(): void {
  if (saveHandler !== null) saveHandler()
}

/** 请求关闭编辑器（标签 × 被点击时）。 */
export function requestClose(): void {
  if (closeHandler !== null) closeHandler()
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
