/**
 * 守卫在「环境」分栏里的注册契约：槽键、注册 id、排序与选项构造。
 *
 * 独立成纯模块，测试可以直接 import，不必拉进 React 或浏览器环境。
 */
/** 「环境」分栏的行槽：上游每个 `dsh-*` 插件在这里加自己的行。守卫也借用它取得会话作用域。 */
export const ROW_SLOT = 'conversation.session.panel.environment.row'

/** 本插件的注册 id，与上游 `project`／`forge.checkout`／`forge.connection` 区分开。 */
export const ROW_ID = 'forge-subagent-guard'

/**
 * 紧跟 forge 的连接行（`forge.connection` 是 40）。守卫自己不显示内容，排序只是为了让它
 * 排在环境分栏那一群里的固定位置，便于排查时一眼找到。
 */
export const ROW_ORDER = 41

/** 交给 `slots.register()` 的注册选项（本插件自己的注册契约）。 */
export interface RowRegisterOptions {
  /** 目标槽键。 */
  readonly name: typeof ROW_SLOT
  /** 注册 id。 */
  readonly id: string
  /** 槽内显示顺序。 */
  readonly order: number
}

/**
 * 构造 `slots.register()` 的选项。
 *
 * @returns 注册选项；守卫没有可见文案，因此不声明 `locale` 座位。
 */
export function rowRegisterOptions(): RowRegisterOptions {
  return {
    name: ROW_SLOT,
    id: ROW_ID,
    order: ROW_ORDER,
  }
}
