/**
 * 宿主半部：`models` 字段是可即时编辑的（volatile），并声明本插件自带设置页（`auto: false`）。
 *
 * 这两条是设置页能读到、写回列表的前提：`dsh-settings` 只投影带 volatile 字段的命名空间；
 * `auto: false` 则避免再生成一张按 schema 自动排布的通用表单页。
 *
 * 运行：`node test/host.test.mjs`（或 pnpm test 跑全部）。
 */
import { Config, name, apply } from '../index.ts'
import { check, checkTrue, finish } from './helpers.mjs'

console.log('--- H① 命名空间与默认值 ---')
{
  check('包名就是命名空间', name, 'dsh-model-quick-switch')
  check('默认空列表', Config({}).models.get(), [])
  check('收下合法列表', Config({
    models: [
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
    ],
  }).models.get(), [
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
  ])
  checkTrue('缺 provider 会被拒绝', (() => {
    try {
      Config({ models: [{ model: 'deepseek-chat' }] })
      return false
    } catch {
      return true
    }
  })())
  checkTrue('缺 model 会被拒绝', (() => {
    try {
      Config({ models: [{ provider: 'deepseek' }] })
      return false
    } catch {
      return true
    }
  })())
}

console.log('--- H② models 字段带 volatile(设置文档才会投影它) ---')
{
  const schema = Config.toJSON()
  const volatileRef = Object.entries(schema.refs).find(([, node]) => node.meta?.volatile === true)
  checkTrue('schema 里标了 volatile', volatileRef !== undefined)
  check('volatile 落在数组字段上', volatileRef?.[1].type, 'array')
  check('models 指向那个 volatile 节点', schema.refs[schema.refs[schema.uid].dict.models]?.meta?.volatile, true)
}

console.log('--- H③ apply 只声明自带设置页 ---')
{
  const calls = []
  const cleanups = []
  const settings = {
    configure(presentation, owner) {
      calls.push({ presentation, owner })
      return () => {}
    },
  }
  const scope = {
    settings,
    effect(callback) {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return () => {}
    },
  }
  const ctx = {
    fiber: 'plugin-fiber',
    requested: undefined,
    inject(names, setup) {
      ctx.requested = names
      setup(scope)
    },
  }
  apply(ctx)
  check('只等 settings', ctx.requested, ['settings'])
  check('关闭自动生成页', calls.map((call) => call.presentation), [{ auto: false }])
  check('策略挂在本插件 fiber 上', calls.map((call) => call.owner), ['plugin-fiber'])
  check('交出了清理函数', cleanups.length, 1)
}

finish()
