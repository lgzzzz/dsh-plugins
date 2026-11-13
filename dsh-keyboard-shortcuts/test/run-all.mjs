/**
 * 按主题顺序跑完 test/ 下所有 `*.test.mjs` 并汇总结果；可传参按文件名过滤。
 *
 *   node test/run-all.mjs            # 全部
 *   node test/run-all.mjs focus-bridge # 只跑文件名匹配 "focus-bridge" 的测试
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// 先固定键与判定，再各桥，最后产物与补偿；其余文件按名字补在后面。
const ORDER = [
  'bridge.test.mjs',
  'install.test.mjs',
  'fullscreen.test.mjs',
  'page-close.test.mjs',
  'focus-decide-binding.test.mjs',
  'focus-decide-escape.test.mjs',
  'focus-decide-ownership.test.mjs',
  'focus-decide-stop-sequence.test.mjs',
  'focus-decide-approval.test.mjs',
  'focus-decide-question.test.mjs',
  'focus-decide-focus-composer.test.mjs',
  'focus-decide-focus-page.test.mjs',
  'focus-decide-page-cycle.test.mjs',
  'focus-decide-session-cycle.test.mjs',
  'focus-decide-fullscreen-dismiss.test.mjs',
  'focus-bridge-pane-split.test.mjs',
  'focus-bridge-stop-sequence.test.mjs',
  'focus-bridge-approval-keys.test.mjs',
  'focus-bridge-question-keys.test.mjs',
  'focus-bridge-focus-composer.test.mjs',
  'focus-bridge-focus-page.test.mjs',
  'focus-bridge-page-cycle.test.mjs',
  'focus-bridge-session-cycle.test.mjs',
  'focus-bridge-fullscreen-dismiss.test.mjs',
  'focus-bridge-platform-keys.test.mjs',
  'focus-strip-scroll.test.mjs',
  'chat-paging.test.mjs',
  'artifact-client.test.mjs',
  'focus-artifact-client.test.mjs',
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
    console.log(`全部通过（${files.length} 个测试文件）`)
  } else {
    console.log(`${failed.length}/${files.length} 个测试文件失败：${failed.join(', ')}`)
  }
  process.exitCode = failed.length === 0 ? 0 : 1
}
