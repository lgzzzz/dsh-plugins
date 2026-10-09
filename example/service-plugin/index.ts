/**
 * 最小服务插件示例:以 cordis `Service` 形式提供名为 metrics 的服务,并用 `static inject`
 * 声明它依赖 llm。
 *
 * 接线与加载顺序:`super(ctx, 'metrics')` 是服务名的登记点,决定 `ctx.metrics` 与别人的
 * `inject: ['metrics']` 能不能解析到它;`static inject = ['llm']` 让 cordis 等 llm 就绪后才
 * 构造本服务 —— 服务名是全局的,第二个提供 metrics 的插件会以「同名已注册」失败。
 * 服务名与插件名无关,五种「名字」的分工见 docs/plugin-naming.md。
 *
 * 例外与可能误用:类默认导出后它就是插件本身,日志名取类名 `MetricsService`,同模块再写
 * `export const name` 也是死代码;`record()` 是空实现,示例只演示接线,真服务必须自己实现行为。
 */
import {Service, type Context} from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}

export default class MetricsService extends Service {
  static inject = ['llm']

  constructor(ctx: Context) {
    super(ctx, 'metrics')
  }

  record(event: string, value: number) {

  }
}