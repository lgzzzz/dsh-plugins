/**
 * 产物装配:`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名 / inject 声明,
 * 装配后把上游注册项排成目标序,后到注册也归位。
 *
 * 运行:`node test/artifact-client.test.mjs`(或 pnpm test 跑全部)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { EXPECTED, FakeSlots, check, checkTrue, entry, finish, pluginRoot, upstreamEntries } from './helpers.mjs'

console.log('--- C① lib/client.js 注册与声明 ---')
{
  let registration = null
  globalThis.window = {
    __ModuleLoader__: {
      load: (reg) => {
        registration = reg
      },
    },
  }
  try {
    // eslint-disable-next-line no-eval
    ;(0, eval)(readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8'))
  } finally {
    delete globalThis.window
  }
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-header-action-order')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-header-action-order')
  check('inject 声明', plugin.inject, ['slots'])

  const slots = new FakeSlots(upstreamEntries())
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  check('产物装配后渲染序', slots.renderedOrder(), EXPECTED)
  slots.register(entry('desktop-notify', 120))
  check('产物装配后后到图标也归位', slots.renderedOrder(), [...EXPECTED, 'desktop-notify'])
}

finish()
