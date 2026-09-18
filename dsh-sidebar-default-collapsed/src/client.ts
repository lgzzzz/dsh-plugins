/** 浏览器半部入口:启动时把左栏置为收起(上游初值硬编码 280px,既无 config 键也无持久化)。 */
import { collapseSidebarOnBoot } from './boot-collapse.ts'
import type { ClientContext, LayoutLike, Services, SlotsLike, WindowLike } from './types.ts'

export const name = 'dsh-sidebar-default-collapsed'

/** 浏览器半部注入的服务(模块加载器读取):layout 走服务面,slots 读活布局 store。 */
export const inject = ['layout', 'slots']

/** 双重判空后取服务(缺失时返回 undefined)。 */
function getService(ctx: ClientContext, serviceName: string): unknown {
  if (ctx.get === undefined || ctx.get === null) return undefined
  const value = ctx.get(serviceName)
  return value === null || value === undefined ? undefined : value
}

/**
 * apply 在 Web shell 挂载之前运行(ui-layout 的 root 注册已提交、React 尚未 render),
 * 故首帧即为收起态,不存在「先展开再收起」的闪动。本插件不持有资源,无 disposer。
 */
export function apply(ctx: ClientContext): void {
  if (typeof window === 'undefined') return
  const services: Services = {
    layout: getService(ctx, 'layout') as LayoutLike | undefined,
    slots: getService(ctx, 'slots') as SlotsLike | undefined,
  }
  collapseSidebarOnBoot(services, window as unknown as WindowLike)
}
