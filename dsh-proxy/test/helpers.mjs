/**
 * 测试装置：断言、计数、汇总。
 *
 * 直接 `import '../src/*.ts'` —— 依赖 Node 24 的 Type Stripping，不需要先构建。
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本插件的包根目录。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failed = 0
const failures = []

/** 断言条件为真。 */
export function check(condition, message) {
  if (condition) {
    passed += 1
    return
  }
  failed += 1
  failures.push(message)
  console.error(`  ✗ ${message}`)
}

/** 断言两个值相等（按 JSON 比较）。 */
export function checkEqual(actual, expected, message) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  check(same, `${message}${same ? '' : `\n      实际：${JSON.stringify(actual)}\n      期望：${JSON.stringify(expected)}`}`)
}

/** 断言两个值不相等。 */
export function checkNotEqual(actual, unexpected, message) {
  check(JSON.stringify(actual) !== JSON.stringify(unexpected), message)
}

/** 断言诊断里存在指定 code。 */
export function checkHasCode(diagnostics, code, message) {
  const found = diagnostics.some((entry) => entry.code === code)
  check(found, `${message}${found ? '' : `\n      实际 code：${diagnostics.map((entry) => entry.code).join(', ') || '(空)'}`}`)
}

/** 断言诊断里没有 error。 */
export function checkNoError(diagnostics, message) {
  const errors = diagnostics.filter((entry) => entry.severity === 'error')
  check(errors.length === 0, `${message}${errors.length === 0 ? '' : `\n      error：${errors.map((entry) => `${entry.code} ${entry.message}`).join(' / ')}`}`)
}

/** 结束一个测试文件：打印结果并设置退出码。 */
export function finish(label) {
  if (failed === 0) {
    console.log(`  ✓ ${label}：${passed} 项断言通过`)
    process.exitCode = 0
    return
  }
  console.error(`  ✗ ${label}：${failed} 项失败 / ${passed} 项通过`)
  for (const failure of failures) console.error(`    - ${failure}`)
  process.exitCode = 1
}

/** 已失败的断言数。 */
export function failureCount() {
  return failed
}
