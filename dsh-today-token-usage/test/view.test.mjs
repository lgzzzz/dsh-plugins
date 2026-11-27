/**
 * 视图状态与分区标题：切到本月时标题 thunk 读到「本月 Token 用量」，id 与排序不变。
 *
 * 标题由面板从注册项读，所以这里测的是「同一份注册选项在切换视图后读到新标题」——宿主半部据此
 * 重新注册一次（见 `src/client.ts`）。
 *
 * 运行：`node test/view.test.mjs`（或 pnpm test 跑全部）。直接 import 纯模块。
 */
import { SECTION_ID, SECTION_ORDER, sectionRegisterOptions } from '../src/registration.ts'
import { getUsageView, setUsageView, subscribeUsageView } from '../src/view.ts'
import { check, finish } from './helpers.mjs'

/** 只回显键的翻译函数。 */
const t = (key) => key

console.log('--- V① 默认是今天，标题是「今日 Token 用量」 ---')
check('默认视图', getUsageView(), 'today')
const options = sectionRegisterOptions(t)
check('标题键', options.label(), 'section.title')
check('id 与排序固定', [options.id, options.order], [SECTION_ID, SECTION_ORDER])

console.log('--- V② 切到本月：订阅者收到一次，标题 thunk 读到新标题 ---')
const seen = []
const unsubscribe = subscribeUsageView(() => seen.push(getUsageView()))
setUsageView('month')
check('订阅者收到一次', seen, ['month'])
check('标题跟着换（同一份选项）', options.label(), 'section.monthTitle')
setUsageView('month')
check('重复切到同一视图不通知', seen.length, 1)

console.log('--- V③ 取消订阅后不再通知，能切回今日 ---')
unsubscribe()
setUsageView('today')
check('取消后不再收到', seen.length, 1)
check('回到今日标题', sectionRegisterOptions(t).label(), 'section.title')

finish()
