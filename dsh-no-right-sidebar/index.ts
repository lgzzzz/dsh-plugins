/**
 * dsh-no-right-sidebar — 宿主半部入口(Node 22+ Type Stripping 直接加载)。
 *
 * 功能:占位空宿主,使组合行可解析为合法插件入口供 dsh-client-modules 扫描
 * (其检查 package.json 声明 `dsh.client.platform: "web"` 的条目);实际工作在
 * 浏览器半部 src/client.ts(提供 sidebarRight 桩服务)与 cordis.patch.yml
 * (停用右侧边栏三行)。
 */
export const name = 'dsh-no-right-sidebar'
export function apply(): void {}
