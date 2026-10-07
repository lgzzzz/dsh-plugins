/**
 * 宿主半部:空实现。
 *
 * 本插件只在浏览器里动作(快捷键 + `shell.overlay` 浮层),宿主侧不需要任何服务,
 * 因此这里只有名字与空的 apply —— Node Type Stripping 直接加载,没有构建产物。
 */
export const name = 'dsh-workspace-quick-switch'

export function apply(): void {}
