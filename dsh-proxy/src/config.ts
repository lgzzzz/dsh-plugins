/** 插件配置与运行时路径。 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** 工具的暴露策略：`skill` 在 `proxy-routing` 技能加载后才给出改写类工具，`always` 全部常驻。 */
export type ToolExposure = 'skill' | 'always'

/** `cordis.patch.yml` 里这一行的 config。全部可省略。 */
export interface ProxyConfig {
  /** xray 可执行文件的绝对路径或 PATH 上的名字；空字符串 = 自动探测 `xray`。 */
  coreBinary?: string
  socksPort?: number
  httpPort?: number
  /** `geosite.dat` / `geoip.dat` 所在目录；空 = `<dataDir>/geo`。 */
  geoDir?: string
  /** 工具暴露策略；默认 `skill`。 */
  toolExposure?: ToolExposure
}

/** 解析后的配置：路径都是绝对路径，端口都有默认值。 */
export interface ResolvedConfig {
  coreBinary: string
  socksPort: number
  httpPort: number
  /** 运行时文件目录（配置、日志），权限 0700。 */
  dataDir: string
  /** geo 数据目录。 */
  geoDir: string
  /** 工具暴露策略：`skill` 或 `always`。 */
  toolExposure: ToolExposure
}

function portOr(value: unknown, fallback: number): number {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback
}

/** DSH 的 home；宿主进程环境里一定有，缺失时退回 `~/.dsh`。 */
export function dshHome(): string {
  const fromEnv = process.env['DSH_HOME']
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

/**
 * 归一化插件配置。
 * @param raw - 行 config 的原样值。
 */
export function resolveConfig(raw: unknown): ResolvedConfig {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as ProxyConfig
  const dataDir = join(dshHome(), 'proxy')
  const geoDir = typeof input.geoDir === 'string' && input.geoDir !== '' ? resolve(input.geoDir) : join(dataDir, 'geo')
  return {
    coreBinary: typeof input.coreBinary === 'string' ? input.coreBinary.trim() : '',
    socksPort: portOr(input.socksPort, 10808),
    httpPort: portOr(input.httpPort, 10809),
    dataDir,
    geoDir,
    // 认识的只有 'always'；拼错或省略都落到默认的按需暴露。
    toolExposure: input.toolExposure === 'always' ? 'always' : 'skill',
  }
}

/** 建好运行时目录并收紧权限；已存在时只补权限。 */
export function ensureDataDir(config: ResolvedConfig): void {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  mkdirSync(config.geoDir, { recursive: true, mode: 0o700 })
}
