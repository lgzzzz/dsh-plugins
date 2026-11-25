/**
 * 跑完 test/ 下的全部 `*.test.mjs`，逐个文件独立进程执行并汇总。
 *
 *   node test/run-all.mjs             # 全部
 *   node test/run-all.mjs nodes       # 只跑文件名匹配 "nodes" 的
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ORDER = ['ir.test.mjs', 'compile.test.mjs', 'explain.test.mjs', 'nodes.test.mjs', 'labels.test.mjs', 'core.test.mjs', 'e2e.test.mjs', 'host.test.mjs']

const filters = process.argv.slice(2)
const all = readdirSync(here).filter((name) => name.endsWith('.test.mjs'))
const ordered = [...ORDER.filter((name) => all.includes(name)), ...all.filter((name) => !ORDER.includes(name)).sort()]
const files = filters.length === 0 ? ordered : ordered.filter((name) => filters.some((filter) => name.includes(filter)))

if (files.length === 0) {
  console.error(filters.length === 0 ? 'test/: 没有找到 *.test.mjs' : `test/: 没有匹配 ${filters.join(', ')} 的测试文件`)
  process.exitCode = 1
} else {
  let failed = 0
  for (const file of files) {
    console.log(`\n▶ ${file}`)
    const result = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' })
    if (result.status !== 0) failed += 1
  }
  console.log('')
  if (failed === 0) console.log(`全部 ${files.length} 个测试文件通过`)
  else {
    console.error(`${failed} / ${files.length} 个测试文件失败`)
    process.exitCode = 1
  }
}
