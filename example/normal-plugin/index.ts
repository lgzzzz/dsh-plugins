/**
 * 最小插件示例:注册一个 greet 工具,并用 `ctx.get` 可选地读 metrics 服务。
 *
 * 导出 `name`(日志名)与 `inject`(激活时机)在五种「名字」里的位置见 docs/plugin-naming.md。
 */
import type {Context} from '@deepseek-ai/cordis'
import {defineTool} from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'

export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))

  const metrics = ctx.get('metrics')
  metrics?.record('plugin_loaded', 1)
}
