/**
 * C 产物:校验 `lib/client.js` 的模块 id / 插件名 / `inject` 声明,并用真产物装配
 * 一遍端到端走线(产物零 external,不应要求任何外部模块)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chatEntry, check, checkTrue, FakeSlots, finish, makeSource, pluginRoot } from './helpers.mjs'

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
  check('模块 id', registration?.id, 'dsh-ui-chat-verbose-fold')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-ui-chat-verbose-fold')
  check('inject 声明', plugin.inject, ['slots'])

  const { source } = makeSource('verbose')
  const entry = chatEntry(source)
  const slots = new FakeSlots([entry])
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  check('产物装配后 verbose 折叠', entry.inject().hooks.presentation.getSnapshot().foldCompletedTurns, true)
}

finish()
