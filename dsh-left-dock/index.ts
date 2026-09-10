/**
 * dsh-left-dock — 宿主半部入口（Node 22+ Type Stripping 直接加载）。
 *
 * 功能：占位空宿主，使组合行可解析为合法插件入口供 dsh-client-modules 扫描
 * （其检查 package.json 中声明 `dsh.client.platform: "web"` 的条目）；实际实现
 * 全在浏览器半部（src/client.ts → lib/client.js）。本插件不消费任何宿主服务，
 * 因此挂载行不声明 inject。
 */
export const name = 'dsh-left-dock'

export function apply(): void {}
