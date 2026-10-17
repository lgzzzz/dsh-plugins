// 宿主半部:空实现;实际行为全在浏览器半部(src/client.ts)。
// 保留 package.json 的 dsh.bundle.patch 挂载行,让浏览器 roster 能拿到 lib/client.js。
export const name = 'dsh-ui-chat-verbose-fold'
export function apply(): void {}
