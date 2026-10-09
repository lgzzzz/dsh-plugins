/**
 * 最小插件示例:注册一个 greet 工具,并用 `ctx.get` 可选地读 metrics 服务。
 *
 * 接线与加载顺序:`export const inject = ['tools']` 让 apply 等到 tools 服务就绪才运行,
 * 与 patch 文件里各行的先后无关;`ctx.get('metrics')` 只是一次可选读取 —— 它不等待服务,
 * 服务缺席就是 undefined,插件照常激活,所以本示例在没有 metrics 的 profile 里也能加载。
 * `ctx.tools.register` 把注册挂在调用方 fiber 上,插件卸载时自动撤销,不必自己保存 disposer。
 *
 * 例外与可能误用:`greet` 是全局工具名,同一层里重名会注册失败(上游还禁止占用保留名
 * `run_code`);真要强制依赖某个服务(而不是有则用、没有就算)必须把它写进 `inject`,
 * 不能靠 `ctx.get` 兜。导出 `name` 只是日志名,与包名 / patch `name` 互不派生 ——
 * 五种「名字」的分工见 docs/plugin-naming.md。
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
