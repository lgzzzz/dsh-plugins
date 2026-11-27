/**
 * 计价：模型价目表（官方名 / 旧名 / 带前缀写法）、峰谷判定（北京时间、周末、法定节假日）
 * 与逐请求计价（缓存命中、缓存写入、未知模型）。
 *
 * 时间戳一律用 `beijing()` 构造（北京 = UTC+8），断言与跑测试的机器时区无关；最后再起两个
 * `TZ` 不同的子进程复算一次，钉住「峰谷只看北京时间」这条口径。
 *
 * 运行：`node test/pricing.test.mjs`（或 pnpm test 跑全部）。直接 import `src/pricing.ts`。
 */
import { execFileSync } from 'node:child_process'
import { isPeakTime, normalizeModelId, priceUsage, resolveModelPrice } from '../src/pricing.ts'
import { check, checkTrue, finish } from './helpers.mjs'

/**
 * 北京时间的某个钟点 → 毫秒时间戳。
 * @param {number} year - 年。
 * @param {number} month - 月（1–12）。
 * @param {number} day - 日。
 * @param {number} hour - 时（0–23，北京时间）。
 * @param {number} minute - 分。
 * @returns {number} 毫秒时间戳。
 */
function beijing(year, month, day, hour, minute = 0) {
  return Date.UTC(year, month - 1, day, hour - 8, minute)
}

/**
 * 断言两个浮点数足够接近。
 * @param {string} label - 断言名。
 * @param {number} actual - 实际值。
 * @param {number} expected - 期望值。
 * @param {number} tolerance - 允许误差。
 */
function checkClose(label, actual, expected, tolerance = 1e-12) {
  const ok = Math.abs(actual - expected) <= tolerance
  if (!ok) {
    // 复用 check 的失败计数与输出格式。
    check(`${label}（≈${expected}）`, actual, expected)
    return
  }
  check(label, true, true)
}

console.log('--- P① 价目表：官方名、旧名与带前缀写法 ---')
check('官方名 deepseek-flash', resolveModelPrice('deepseek-flash')?.name, 'DeepSeek V4.1 Flash')
check('用户常写的 v4.1 名', resolveModelPrice('deepseek-v4.1-flash')?.name, 'DeepSeek V4.1 Flash')
check('旧名 deepseek-v4-flash', resolveModelPrice('deepseek-v4-flash')?.name, 'DeepSeek V4.1 Flash')
check('带厂商前缀', resolveModelPrice('deepseek/deepseek-v4.1-flash')?.name, 'DeepSeek V4.1 Flash')
check('大小写与空白', resolveModelPrice('  DeepSeek-V4.1-Flash  ')?.name, 'DeepSeek V4.1 Flash')
check('v4-pro', resolveModelPrice('deepseek-v4-pro')?.name, 'DeepSeek V4 Pro')
check('未知模型没有价目表', resolveModelPrice('gpt-5-nano'), undefined)
check('规范化只取最后一个斜杠之后', normalizeModelId('openrouter/deepseek/deepseek-v4.1-flash'), 'deepseek-v4.1-flash')

console.log('--- P② 峰谷：工作日两个窗口，12:00 与 18:00 起算空闲 ---')
// 2026-11-25 是周三。
check('周三 09:00 高峰', isPeakTime(beijing(2026, 11, 25, 9)), true)
check('周三 08:59 空闲', isPeakTime(beijing(2026, 11, 25, 8, 59)), false)
check('周三 11:59 高峰', isPeakTime(beijing(2026, 11, 25, 11, 59)), true)
check('周三 12:00 空闲', isPeakTime(beijing(2026, 11, 25, 12)), false)
check('周三 13:59 空闲', isPeakTime(beijing(2026, 11, 25, 13, 59)), false)
check('周三 14:00 高峰', isPeakTime(beijing(2026, 11, 25, 14)), true)
check('周三 17:59 高峰', isPeakTime(beijing(2026, 11, 25, 17, 59)), true)
check('周三 18:00 空闲', isPeakTime(beijing(2026, 11, 25, 18)), false)
check('周三 23:30 空闲', isPeakTime(beijing(2026, 11, 25, 23, 30)), false)

console.log('--- P③ 峰谷：周末与调休上班的周末都算空闲 ---')
check('周六 10:00 空闲', isPeakTime(beijing(2026, 11, 28, 10)), false)
check('周日 15:00 空闲', isPeakTime(beijing(2026, 11, 29, 15)), false)
// 2026-01-04（周日）是元旦调休上班日；官方口径下周末全天仍按空闲计价。
check('调休上班的周日 10:00 空闲', isPeakTime(beijing(2026, 1, 4, 10)), false)

console.log('--- P④ 峰谷：法定节假日全天空闲，节后恢复正常 ---')
check('国庆 10-01（周四）10:00 空闲', isPeakTime(beijing(2026, 10, 1, 10)), false)
check('春节 02-17（周二）10:00 空闲', isPeakTime(beijing(2026, 2, 17, 10)), false)
check('春节假期最后一天 02-23（周一）10:00 空闲', isPeakTime(beijing(2026, 2, 23, 10)), false)
check('春节后第一个工作日 02-24（周二）10:00 高峰', isPeakTime(beijing(2026, 2, 24, 10)), true)
check('国庆后第一个工作日 10-08（周四）10:00 高峰', isPeakTime(beijing(2026, 10, 8, 10)), true)

console.log('--- P⑤ 峰谷只看北京时间，与宿主时区无关 ---')
{
  const instant = beijing(2026, 11, 25, 10) // 北京时间周三 10:00
  const source = new URL('../src/pricing.ts', import.meta.url).href
  const probe = `import { isPeakTime } from ${JSON.stringify(source)}; process.stdout.write(String(isPeakTime(${instant})))`
  for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
      encoding: 'utf8',
      env: { ...process.env, TZ: zone },
    })
    check(`TZ=${zone} 仍是高峰`, out, 'true')
  }
}

console.log('--- P⑥ 计价：峰时单价 ---')
const million = (usage) => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...usage })
checkClose('峰时未命中输入 2 元/M', priceUsage('deepseek-v4.1-flash', beijing(2026, 11, 25, 10), million({ inputTokens: 1_000_000 })).total, 2)
checkClose('峰时缓存命中 0.04 元/M', priceUsage('deepseek-flash', beijing(2026, 11, 25, 10), million({ cacheReadTokens: 1_000_000 })).total, 0.04)
checkClose('峰时输出 8 元/M', priceUsage('deepseek-v4.1-flash', beijing(2026, 11, 25, 10), million({ outputTokens: 1_000_000 })).total, 8)
checkClose('缓存写入按未命中输入计', priceUsage('deepseek-v4.1-flash', beijing(2026, 11, 25, 10), million({ cacheWriteTokens: 1_000_000 })).total, 2)
checkClose('v4-pro 峰时输出 27 元/M', priceUsage('deepseek-v4-pro', beijing(2026, 11, 25, 10), million({ outputTokens: 1_000_000 })).total, 27)

console.log('--- P⑦ 计价：空闲价是峰时的一半，拆分随峰谷落位 ---')
{
  const offPeak = priceUsage('deepseek-v4.1-flash', beijing(2026, 11, 25, 23), million({ outputTokens: 1_000_000 }))
  checkClose('空闲输出 4 元/M', offPeak.total, 4)
  check('空闲整笔落在 offPeak', [offPeak.peak, offPeak.offPeak, offPeak.priced], [0, 4, true])
  const peak = priceUsage('deepseek-v4.1-flash', beijing(2026, 11, 25, 10), million({ outputTokens: 1_000_000 }))
  check('峰时整笔落在 peak', [peak.peak, peak.offPeak], [8, 0])
  checkTrue('peak + offPeak = total', Math.abs(peak.total - (peak.peak + peak.offPeak)) < 1e-12)
}

console.log('--- P⑧ 计价：四桶混合与未知模型 ---')
{
  const mixed = priceUsage('deepseek/deepseek-v4.1-flash', beijing(2026, 11, 25, 10), {
    inputTokens: 500_000,
    cacheReadTokens: 2_000_000,
    cacheWriteTokens: 0,
    outputTokens: 250_000,
  })
  // 0.5M × 2 + 2M × 0.04 + 0.25M × 8 = 1 + 0.08 + 2
  checkClose('混合四桶', mixed.total, 3.08)
  const unknown = priceUsage('some-other-model', beijing(2026, 11, 25, 10), million({ inputTokens: 1_000_000 }))
  check('未知模型只计 Token', [unknown.total, unknown.priced], [0, false])
}

finish()
