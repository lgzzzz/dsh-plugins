/**
 * 解析本机安装的 DSH 包根。`check-css.mjs` 与 `test/cascade.test.mjs` 共用,
 * 保证静态契约校验与级联测试找到的是同一份上游产物。
 *
 * 顺序:显式参数 > `$DSH_ROOT` > `npm root -g` > 常见全局安装路径。
 * 找不到时返回 null,由调用方决定是告警跳过还是失败。
 */
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { execSync } from 'node:child_process'

/**
 * @param {string} [opt] 显式传入的 DSH 包路径(优先于环境变量)。
 * @returns {string | null} `@deepseek-ai/dsh` 包的绝对路径;找不到时为 null。
 */
export function resolveDshRoot(opt) {
  if (opt) return resolve(opt)
  if (process.env.DSH_ROOT) return resolve(process.env.DSH_ROOT)

  const candidates = []
  try {
    const g = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (g) candidates.push(g)
  } catch { /* spawn 被拒(受限环境下为 EPERM)时,继续走下面的纯路径回退 */ }

  // 纯路径回退:不 spawn 任何子进程。
  if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'npm', 'node_modules'))
  const execDir = dirname(process.execPath) // <prefix>/bin/node
  candidates.push(join(execDir, '..', 'lib', 'node_modules'))
  candidates.push(join(execDir, 'node_modules'))
  if (process.env.PNPM_HOME) candidates.push(join(process.env.PNPM_HOME, 'global', '5', 'node_modules'))

  for (const root of candidates) {
    const p = join(root, '@deepseek-ai', 'dsh')
    if (existsSync(p)) return p
  }
  return null
}
