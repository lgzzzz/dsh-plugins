/**
 * 评论框键盘约定：按键映射、归属判定、Enter 走「添加到输入框」按钮、Esc 走取消、输入法与
 * 空文本的放行、结构对不上时的降级，以及捕获监听的安装 / 卸载。
 *
 * 运行：`node test/comment-keys.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  ADD_LABEL_KEY,
  COMPOSER_SELECTOR,
  MARKER_ATTRIBUTE,
  addButtonOf,
  addLabelOf,
  composerOf,
  composerPropsOf,
  handleComposerKey,
  installCommentKeys,
  keyAction,
} from '../src/comment-keys.ts'
import {
  FakeDocument,
  FakeElement,
  check,
  checkTrue,
  composerFixture,
  finish,
  keyEvent,
} from './comment-helpers.mjs'

console.log('--- K① 按键映射 ---')
{
  check('Enter → 添加', keyAction(keyEvent(null)), 'add')
  check('Esc → 取消', keyAction(keyEvent(null, { key: 'Escape' })), 'cancel')
  check('Shift+Enter 放行（浏览器换行）', keyAction(keyEvent(null, { shiftKey: true })), null)
  check('⌘Enter 放行', keyAction(keyEvent(null, { metaKey: true })), null)
  check('Ctrl+Enter 放行', keyAction(keyEvent(null, { ctrlKey: true })), null)
  check('Alt+Enter 放行', keyAction(keyEvent(null, { altKey: true })), null)
  check('其它键放行', keyAction(keyEvent(null, { key: 'a' })), null)
  check('输入法组合中放行', keyAction(keyEvent(null, { isComposing: true })), null)
  check('keyCode 229 放行', keyAction(keyEvent(null, { keyCode: 229 })), null)
  check('长按重复放行', keyAction(keyEvent(null, { repeat: true })), null)
  check('已经被人拦下的放行', keyAction(keyEvent(null, { defaultPrevented: true })), null)
  check('锚点选择器', COMPOSER_SELECTOR, '[data-forge-comment]')
  check('默认文案 key', ADD_LABEL_KEY, 'review.addToInput')
}

console.log('--- K② 归属判定：只认评论框里的 textarea ---')
{
  const { section, field, title } = composerFixture()
  checkTrue('评论框 textarea 认出来', composerOf(field)?.section === section)
  checkTrue('评论框里的标题节点不算', composerOf(title) === null)
  checkTrue('评论框外的 textarea 不算', composerOf(new FakeElement('textarea', {}, { value: 'x' })) === null)
  checkTrue('非元素目标不算', composerOf(null) === null)

  const detached = composerFixture()
  detached.section.isConnected = false
  checkTrue('已脱离文档的评论框不再响应', composerOf(detached.field) === null)
}

console.log('--- K③ props、文案与按钮识别 ---')
{
  const plain = composerFixture()
  const props = composerPropsOf(plain.section)
  checkTrue('从 section 向上一层取到 props', props !== null)
  check('默认 key 的文案', addLabelOf(props), '添加到输入框')
  checkTrue('按文案认出「添加到输入框」', addButtonOf(plain.section, props) !== null)

  const rewrite = composerFixture({ withQuoteCopy: true, addKey: 'thread.addToInput', label: '添加到输入框' })
  const rewriteProps = composerPropsOf(rewrite.section)
  check('quoteCopy.add 优先', addLabelOf(rewriteProps), '添加到输入框')
  checkTrue('按 quoteCopy 的 key 同样认得出', addButtonOf(rewrite.section, rewriteProps) !== null)

  const german = composerFixture({ label: 'Zum Eingabefeld hinzufügen' })
  const germanProps = composerPropsOf(german.section)
  check('其它语言按当前 t 翻', addLabelOf(germanProps), 'Zum Eingabefeld hinzufügen')
  checkTrue('其它语言同样认得出按钮', addButtonOf(german.section, germanProps) !== null)

  const noFiber = composerFixture({ withProps: false })
  check('没有 fiber：props 为 null', composerPropsOf(noFiber.section), null)
  const noTranslate = composerFixture({ withTranslate: false })
  check('没有 t：文案为 null', addLabelOf(composerPropsOf(noTranslate.section)), null)
}

console.log('--- K④ Enter / Esc 的执行路径 ---')
{
  const { field, calls } = composerFixture()
  const event = keyEvent(field)
  check('Enter 执行「添加到输入框」', handleComposerKey(event), 'applied')
  checkTrue('Enter 拦掉换行', event.prevented)
  check('只点了一次添加', calls, ['add'])
}
{
  const { field, calls } = composerFixture()
  const event = keyEvent(field, { shiftKey: true })
  check('Shift+Enter 放行', handleComposerKey(event), 'skipped')
  check('Shift+Enter 不拦换行', event.prevented, false)
  check('Shift+Enter 什么都不点', calls, [])
}
{
  const { field, calls } = composerFixture()
  const event = keyEvent(field, { key: 'Escape' })
  check('Esc 关闭评论框', handleComposerKey(event), 'applied')
  checkTrue('Esc 拦默认', event.prevented)
  checkTrue('Esc 收口冒泡', event.stopped)
  check('Esc 走 close，不点按钮', calls, ['close'])
}
{
  const { field, calls } = composerFixture({ text: '   ' })
  const event = keyEvent(field)
  check('空文本 Enter 不提交', handleComposerKey(event), 'skipped')
  checkTrue('空文本也拦掉换行', event.prevented)
  check('空文本什么都不点', calls, [])
}
{
  const { field, calls } = composerFixture()
  const event = keyEvent(field, { isComposing: true })
  check('输入法选词时放行', handleComposerKey(event), 'skipped')
  check('输入法不拦默认', event.prevented, false)
  check('输入法不提交', calls, [])
}
{
  const { field, calls } = composerFixture({ addEnabled: false })
  const event = keyEvent(field)
  check('按钮禁用时不动', handleComposerKey(event), 'skipped')
  checkTrue('按钮禁用时仍拦掉换行', event.prevented)
  check('按钮禁用时不点', calls, [])
}
{
  const { title, calls } = composerFixture()
  const event = keyEvent(title)
  check('评论框标题上的 Enter 不管', handleComposerKey(event), 'skipped')
  check('标题上不拦默认', event.prevented, false)
  check('标题上什么都不点', calls, [])
}

console.log('--- K⑤ 结构对不上时的降级 ---')
{
  const { field, calls } = composerFixture({ withProps: false })
  const warnings = []
  const event = keyEvent(field)
  check('取不到 props：不可用', handleComposerKey(event, (message) => { warnings.push(message) }), 'unavailable')
  check('取不到 props 时放行换行', event.prevented, false)
  check('取不到 props 告警一句', warnings.length, 1)
  check('取不到 props 时什么都不点', calls, [])
}
{
  const { field } = composerFixture({ withTranslate: false })
  const warnings = []
  const event = keyEvent(field)
  check('翻不出文案：不可用', handleComposerKey(event, (message) => { warnings.push(message) }), 'unavailable')
  check('翻不出文案时放行换行', event.prevented, false)
  check('翻不出文案告警一句', warnings.length, 1)
}
{
  const { field } = composerFixture({ addThrows: true })
  const warnings = []
  const event = keyEvent(field)
  check('按钮抛错：不可用', handleComposerKey(event, (message) => { warnings.push(message) }), 'unavailable')
  check('按钮抛错告警一句', warnings.length, 1)
}

console.log('--- K⑥ 捕获监听的安装与卸载 ---')
{
  const doc = new FakeDocument()
  const warnings = []
  const uninstall = installCommentKeys(doc, { warn: (message) => { warnings.push(message) } })
  check('只挂 keydown', doc.types, ['keydown'])
  check('捕获阶段', (doc.listeners.get('keydown') ?? []).every((item) => item.capture === true), true)
  check('装上了生效标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), '')

  const { field, calls } = composerFixture()
  const event = keyEvent(field)
  doc.dispatch('keydown', event)
  check('文档捕获层直接生效', calls, ['add'])
  checkTrue('文档捕获层拦掉换行', event.prevented)

  // 同一个结构错误只报一次，长按 / 连按不会刷屏。
  const broken = composerFixture({ withProps: false })
  doc.dispatch('keydown', keyEvent(broken.field))
  doc.dispatch('keydown', keyEvent(broken.field))
  check('同一句告警只报一次', warnings.length, 1)

  uninstall()
  check('卸载后无监听', doc.types, [])
  check('卸载后标记移除', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
  const after = composerFixture()
  doc.dispatch('keydown', keyEvent(after.field))
  check('卸载后不再接管', after.calls, [])
}
{
  const uninstall = installCommentKeys(undefined, {})
  checkTrue('没有文档：空操作', typeof uninstall === 'function')
  uninstall()
}

finish()
