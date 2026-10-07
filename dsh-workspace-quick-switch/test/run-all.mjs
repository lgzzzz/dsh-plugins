/**
 * 按 A–E 的主题顺序跑完 test/ 下所有 `*.test.mjs`,并汇总各文件结果。
 *
 *   node test/run-all.mjs            # 全部
 *   node test/run-all.mjs install    # 只跑文件名匹配 "install" 的
 *
 * 受限沙箱里 spawn 子进程会被拒(EPERM),此时逐个直接跑:
 *   node test/palette.test.mjs && node test/keys.test.mjs && …
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// A–E 的主题顺序;不在表内的测试文件按名字排在其后。
const ORDER = [
  'palette.test.mjs',
  'keys.test.mjs',
  'overlay.test.mjs',
  'install.test.mjs',
  'artifact-client.test.mjs',
]

const filters = process.argv.slice(2)
const all = readdirSync(here).filter((name) => name.endsWith('.test.mjs'))
const ordered = [
  ...ORDER.filter((name) => all.includes(name)),
  ...all.filter((name) => !ORDER.includes(name)).sort(),
]
const files = filters.length === 0 ? ordered : ordered.filter((name) => filters.some((filter) => name.includes(filter)))

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
    console.log(`全部通过(${files.length} 个测试文件)`)
  } else {
    console.log(`${failed.length}/${files.length} 个测试文件失败:${failed.join(', ')}`)
  }
  process.exitCode = failed.length === 0 ? 0 : 1
}
