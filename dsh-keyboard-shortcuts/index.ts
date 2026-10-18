/**
 * 宿主半部：没有宿主侧行为，全部功能在浏览器侧（见 `src/client.ts`）。
 *
 * 该入口让 bundle patch 挂载一行；客户端半部由 `dsh.client.platform = "web"` 与
 * `immediately` 注册进浏览器 roster。启用与撤销见
 * docs/dsh-keyboard-shortcuts.md。
 */
export const name = 'dsh-keyboard-shortcuts'

export function apply(): void {}
