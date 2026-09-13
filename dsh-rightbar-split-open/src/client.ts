/**
 * dsh-rightbar-split-open — 浏览器半部入口(TypeScript 真源;由
 * scripts/build-client.mjs 用 esbuild 打包为 lib/client.js)。
 *
 * 功能:在**右侧栏文件浏览器**里点开一个文件时,让这个文件落在文件树**旁边的另一个
 * 分栏**里,并且「文件树 : 文件」= **1 : 4**(树 20%、文件 80%)。
 *
 * 实现全链路都是上游公开面,零 DOM、零猴子补丁、零轮询:
 *
 * 1. **接线**:包装一次 `uiSession.resolve` —— 上游唯一能观察到「某会话右侧栏 store
 *    何时可解析」的公开信号(见 rightbar.ts 的说明);
 * 2. **观察**:订阅该会话右栏 store 的提交,与上一份快照比对,认出「文件树所在面板里
 *    刚多出一个 `dsh-resource://file/…` 标签」(见 split-open.ts 的 planSplitOpen);
 * 3. **改造**(见 session-split.ts):
 *    `sidebarRight.split(树面板)` → store `placeTab(文件标签, 新面板, 0)` →
 *    store `resizeSplit(分栏, [0.2, 0.8])` → store `focusTab(树标签)`。
 *
 * 上游把树里点开的文件落进「当前停靠面板」(即文件树自己那一格),所以「开在另一个
 * 分栏」这件事必须由这一层改造;而 `split()` 自带**实测空间判定**——面板宽度不够两个
 * 格时它返回 `undefined`,本插件随即不动作,文件照上游默认行为留在树面板里(不会出现
 * 放不下的分栏,也不会把文件树压成死格)。
 *
 * 比例 0.2 / 0.8 与上游 `minPaneFraction = 0.2` 同源(见 split-open.ts),不需要任何
 * 私有实现或样式注入。不消费 react,无 external。
 */
import { installSessionWiring, type SidebarRightSplitLike } from './rightbar.ts'
import { createSplitHandler } from './session-split.ts'
import type { ClientContext, SlotsLike, UiSessionLike } from './types.ts'

export const name = 'dsh-rightbar-split-open'

/**
 * 浏览器半部注入的服务(模块加载器读取)。
 * - `uiSession`:取会话物化时机(`resolve`)并为该会话解析右栏 store(会话级作用域绑定);
 * - `slots`:`slots.entries('rightbar.session')` 取 store handle、
 *   `slots.resolveStore(handle, binding)` 取活实例;
 * - `sidebarRight`:只用公开的 `split(paneId?)` 分栏(带实测可行性判定)。
 */
export const inject = ['uiSession', 'slots', 'sidebarRight']

/** null 与 undefined 双重判空后取服务(缺失时返回 undefined)。 */
function getService(ctx: ClientContext, serviceName: string): unknown {
  if (ctx.get === undefined || ctx.get === null) return undefined
  const value = ctx.get(serviceName)
  return value === null || value === undefined ? undefined : value
}

/**
 * 安装右栏「分栏打开」改造。
 *
 * @param ctx - Client root context。
 */
export function apply(ctx: ClientContext): void {
  const uiSession = getService(ctx, 'uiSession') as UiSessionLike | undefined
  const slots = getService(ctx, 'slots') as SlotsLike | undefined
  const sidebarRight = getService(ctx, 'sidebarRight') as SidebarRightSplitLike | undefined

  // 缺任一项即整体不动作(不降级、不猜):没有 sidebarRight 无从分栏,没有 slots /
  // uiSession 读不到右侧栏那份会话级布局。
  if (uiSession === undefined || slots === undefined || sidebarRight === undefined) {
    console.warn('[dsh-rightbar-split-open] services unavailable; split-open disabled')
    return
  }

  const handle = installSessionWiring({ uiSession, slots }, createSplitHandler(sidebarRight))
  if (handle === undefined) {
    console.warn('[dsh-rightbar-split-open] uiSession.resolve unavailable; split-open disabled')
    return
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => () => { handle.dispose() })
}
