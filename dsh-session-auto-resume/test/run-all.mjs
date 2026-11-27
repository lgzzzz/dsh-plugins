/**
 * 跑完 test/ 下所有 `*.test.mjs` 并汇总；命令行参数是文件名过滤子串。
 *
 * 运行：`node test/run-all.mjs`，或 `node test/run-all.mjs decide` 只跑纯判定。
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// 纯判定在前，假宿主集成在后，读起来是“先规则、后接线”。
const ORDER = ['decide.test.mjs', 'plugin-apply.test.mjs']

const filters = process.argv.slice(2)
const all = readdirSync(here).filter((entry) => entry.endsWith('.test.mjs'))
const ordered = [
  ...ORDER.filter((entry) => all.includes(entry)),
  ...all.filter((entry) => !ORDER.includes(entry)).sort(),
]
const files = filters.length === 0
  ? ordered
  : ordered.filter((entry) => filters.some((filter) => entry.includes(filter)))

if (files.length === 0) {
  console.error(filters.length === 0
    ? 'test/: 没有找到 *.test.mjs'
    : `test/: 没有匹配 ${filters.join(', ')} 的测试文件`)
  process.exitCode = 1
} else {
  const failed = []
  for (const file of files) {
    console.log(`\n=== ${file} ===`)
    const result = spawnSync(process.execPath, [join(here, file)], { cwd: here, encoding: 'utf8' })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.status !== 0) failed.push(file)
  }
  if (failed.length > 0) {
    console.error(`\n失败: ${failed.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log(`\n${files.length} 个测试文件全部通过`)
  }
}
