/**
 * 跑完 test/ 下所有 `*.test.mjs` 并汇总结果；命令行参数是文件名过滤子串，
 * 例如 `node test/run-all.mjs apply` 只跑文件名匹配 "apply" 的。
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// 先跑这三个测试文件，其余按名字排在后面。
const ORDER = ['bump-plan.test.mjs', 'plugin-apply.test.mjs', 'cordis-integration.test.mjs']

const filters = process.argv.slice(2)
const all = readdirSync(here).filter((entry) => entry.endsWith('.test.mjs'))
const ordered = [
  ...ORDER.filter((entry) => all.includes(entry)),
  ...all.filter((entry) => !ORDER.includes(entry)).sort(),
]
const files =
  filters.length === 0 ? ordered : ordered.filter((entry) => filters.some((filter) => entry.includes(filter)))

if (files.length === 0) {
  console.error(filters.length === 0 ? 'test/: 没有找到 *.test.mjs' : `test/: 没有匹配 ${filters.join(', ')} 的测试文件`)
  process.exitCode = 1
} else {
  const failed = []
  for (const file of files) {
    console.log(`\n=== ${file} ===`)
    const result = spawnSync(process.execPath, [join(here, file)], { cwd: here, encoding: 'utf8' })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error) console.error(result.error.message)
    if (result.status !== 0) failed.push(file)
  }

  console.log('')
  if (failed.length === 0) {
    console.log(`全部通过（${files.length} 个测试文件）`)
  } else {
    console.log(`${failed.length}/${files.length} 个测试文件失败：${failed.join(', ')}`)
  }
  process.exitCode = failed.length === 0 ? 0 : 1
}
