/**
 * 宿主半部：没有宿主侧行为，功能全在浏览器侧（见 `src/client.ts`）。
 * 该入口让 bundle patch 挂载一行，客户端 roster 按 `dsh.client.platform = "web"` 解析到它。
 */
export const name = 'dsh-focus-free-shortcuts'
export function apply(): void {}
