/**
 * C 产物：`lib/client.js` 的模块 id / 插件名 / 无 external 依赖，并用真产物在假 DOM 上
 * 走一遍「折叠窗口内补回阅读位置」。
 */
import {
  buildChat,
  check,
  checkTrue,
  finish,
  loadClientArtifact,
  markCollapsing,
  moveUpForFold,
  withFakeDom,
} from './helpers.mjs'

console.log('--- C① lib/client.js 注册与声明 ---')
{
  const registration = loadClientArtifact()
  checkTrue('registration 非空', registration !== null)
  check('模块 id', registration?.id, 'dsh-ui-chat-fold-anchor')
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应有任何 external')
  })
  check('插件名', plugin.name, 'dsh-ui-chat-fold-anchor')
  checkTrue('apply 是函数', typeof plugin.apply === 'function')
  // 没有 DOM 的环境（宿主侧装配）里 apply 是空操作，不抛错。
  check('无 DOM 时 no-op', plugin.apply({ effect: () => undefined }), undefined)
}

console.log('--- C② 真产物在假 DOM 上补回阅读位置 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const registration = loadClientArtifact()
  const plugin = registration.factory(() => {
    throw new Error('产物要求了外部模块:本插件不应有任何 external')
  })
  const disposers = []
  plugin.apply({
    effect: (run) => {
      const dispose = run()
      disposers.push(dispose)
      return dispose
    },
  })
  // 滚动口上挂着两条属性观察：折叠窗口的 `style` 与即时折叠的 `hidden`。
  check('装配后挂上属性观察', chat.scroller.observers.length, 2)

  markCollapsing(chat)
  chat.scroller.style.overflowAnchor = 'none'
  moveUpForFold(chat)
  chat.column.notifyResize()
  check('折叠窗口内补回阅读位置', chat.scroller.scrollTop, 700)

  for (const dispose of disposers) dispose()
  check('清理后摘掉观察', chat.scroller.observers.length, 0)
})

finish()
