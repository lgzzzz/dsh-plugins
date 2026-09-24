import {Service, type Context} from '@deepseek-ai/cordis'

// Typescript声明合并
declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}


export default class MetricsService extends Service {
  static inject = ['llm']  // A service may depend on other services.

  constructor(ctx: Context) {
    super(ctx, 'metrics')  // 'metrics' is the service name.
  }

  // Public service method.
  record(event: string, value: number) {
  }
}