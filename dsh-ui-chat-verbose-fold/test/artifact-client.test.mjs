/**
 * C 产物：校验 lib/client.js 的模块 id / 插件名 / inject 声明，并用真产物装配
 * 一条端到端走线：策略投影仍生效，滚动补偿在假 DOM 上补回阅读位置，`ctx.effect`
 * 的清理能摘掉观察者。
 */
import { buildChat, loadClientArtifact, withFakeDom } from './fake-dom.mjs'
import { chatEntry, check, checkTrue, FakeSlots, finish, makeSource } from './helpers.mjs'

console.log('--- C① lib/client.js 注册与声明 ---')
{
  const registration = loadClientArtifact()
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-ui-chat-verbose-fold')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块：本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-ui-chat-verbose-fold')
  check('inject 声明', plugin.inject, ['slots'])

  const { source } = makeSource('verbose', 'next-input')
  const entry = chatEntry(source)
  const slots = new FakeSlots([entry])
  plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  const policy = entry.inject().hooks.presentation.getSnapshot()
  check('产物装配后 verbose 折叠', policy.foldCompletedTurns, true)
  check('产物装配后保留收起时机', policy.collapseTiming, 'next-input')
}

console.log('--- C② 产物装配滚动补偿并由 ctx.effect 清理 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.scroller)
  chat.scroller.scrollTop = 1000

  const { source } = makeSource('verbose', 'completion')
  const entry = chatEntry(source)
  const slots = new FakeSlots([entry])
  const registration = loadClientArtifact()
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块：本插件不应有任何 external')
  })
  let cleanup = null
  plugin.apply({
    get: (name) => (name === 'slots' ? slots : undefined),
    effect: (run) => {
      cleanup = run()
      return () => cleanup?.()
    },
  })

  check('滚动口挂上 hidden 观察', chat.scroller.observers.length, 1)
  check('策略投影仍生效', entry.inject().hooks.presentation.getSnapshot().foldCompletedTurns, true)

  chat.group.setAttribute('hidden', 'until-found')
  check('收起后补回阅读位置', chat.scroller.scrollTop, 700)
  checkTrue('effect 返回清理函数', typeof cleanup === 'function')
  if (typeof cleanup === 'function') cleanup()
  check('清理后摘掉观察', chat.scroller.observers.length, 0)
})

finish()
