/**
 * dsh-code-card-fonts — 宿主半部入口(Node 22+ Type Stripping 直接加载)。
 *
 * 功能:占位空宿主,使组合行可解析为合法插件入口供 dsh-client-modules 扫描
 * (其检查 package.json 声明 `dsh.client.platform: "web"` 的条目);实际补丁在
 * 浏览器半部 src/client.ts。
 */
export const name = 'dsh-code-card-fonts'
export function apply(): void {}
