/**
 * 浏览器半部的纯格式化：状态/原因词汇、首 Token 与吞吐读数。
 *
 * 规则重点：已知码走字典、未知码原样显示、`none` 不显示、100 秒以内的秒保留一位小数。
 *
 * 运行：`node test/format.test.mjs`（或 pnpm test 跑全部）。
 */
import { formatSeconds, formatTps, reasonText, statusText, statusValue } from '../src/format.ts'
import { zh } from '../src/locales.ts'
import { check, finish, translator } from './helpers.mjs'

const t = translator(zh)

console.log('--- F① 状态码 ---')
check('operational', statusText('operational', t), '正常')
check('degraded', statusText('degraded', t), '降级')
check('unknown', statusText('unknown', t), '未知')
check('未知码原样显示', statusText('outage', t), 'outage')

console.log('--- F② 原因码 ---')
check('latency', reasonText('latency', t), '延迟')
check('errors', reasonText('errors', t), '错误')
check('availability', reasonText('availability', t), '可用性')
check('monitoring', reasonText('monitoring', t), '监控中')
check('upstream', reasonText('upstream', t), '上游异常')
check('none 不显示', reasonText('none', t), null)
check('空串不显示', reasonText('', t), null)
check('未知码原样显示', reasonText('throttled', t), 'throttled')

console.log('--- F③ 状态行 ---')
check('有原因', statusValue('degraded', 'latency', t), '降级 · 延迟')
check('无原因', statusValue('operational', 'none', t), '正常')
check('未知码组合', statusValue('outage', 'throttled', t), 'outage · throttled')

console.log('--- F④ 读数 ---')
check('9058ms', formatSeconds(9058), '9.1')
check('4208ms', formatSeconds(4208), '4.2')
check('500ms', formatSeconds(500), '0.5')
check('15822ms', formatSeconds(15822), '15.8')
check('120000ms', formatSeconds(120000), '120')
check('999ms 进位', formatSeconds(999), '1')
check('吞吐取整', formatTps(148), '148')
check('吞吐小数取整', formatTps(147.6), '148')

finish()
