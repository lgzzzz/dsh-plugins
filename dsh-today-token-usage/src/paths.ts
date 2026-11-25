/**
 * 本插件的落盘位置：DSH home 下 `state` 分类里的插件自有目录。
 *
 * 解析规则与 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()` 一致（`$DSH_HOME`，否则
 * `~/.dsh`），但本插件不为此引入运行时依赖：宿主半部只用到这一个路径。
 *
 * 目录分类用 `state`：这里存的是「跨运行保留、丢了只重置统计」的记录（日志/索引一类），
 * 不是用户工作数据；`requests-YYYY-MM-DD.jsonl` 每天一个文件。
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** DSH home 的环境变量名（与 DSH 自身一致）。 */
export const DSH_HOME_ENV = 'DSH_HOME'

/** 本插件在 `$DSH_HOME/state/` 下的目录名（包名去掉 `dsh-` 前缀）。 */
export const JOURNAL_OWNER_DIR = 'today-token-usage'

/** 展开 `~`、`~/`、`~\` 三种写法；其他值原样返回。 */
function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * 解析 DSH home：`$DSH_HOME`（去空白后非空）优先，否则 `~/.dsh`；结果规范化为绝对路径。
 * @param env - 环境变量表（测试可注入）。
 * @returns 绝对路径。
 */
export function resolveDshHome(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env[DSH_HOME_ENV]
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(expandHome(selected))
}

/**
 * 本插件的 journal 目录：`<DSH home>/state/today-token-usage`。
 * @param dshHome - 显式 home（测试用）；省略时按 {@link resolveDshHome} 解析。
 * @returns 绝对目录路径（不创建）。
 */
export function journalDirectory(dshHome: string = resolveDshHome()): string {
  return join(resolve(dshHome), 'state', JOURNAL_OWNER_DIR)
}
