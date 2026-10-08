/**
 * 最小服务插件示例:以 cordis `Service` 形式提供名为 metrics 的服务,并用 `static inject`
 * 声明它依赖 llm。
 *
 * 服务名如何落成 `ctx.metrics` 与 `inject: ['metrics']`,以及五种「名字」的分工见
 * docs/plugin-naming.md。
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