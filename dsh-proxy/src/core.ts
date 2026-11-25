/**
 * 内核生命周期：生成配置 → `xray -test` → 启动 → 端口就绪 → 运行；失败回滚。
 *
 * 数据面是上游 XTLS/Xray-core。xray 不支持热加载配置，所以「应用规则」等于重启；
 * 重启失败时把上一份好配置写回去再启动一次，语义与 v2rayA 的 ApplyCoreConfig 一致。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import type { ResolvedConfig } from './config.ts'
import type { RingLog } from './log.ts'

/** 内核状态。 */
export type CoreState = 'stopped' | 'starting' | 'running' | 'error'

/** 二进制来源。 */
export type BinarySource = 'config' | 'path' | 'missing'

/** 内核状态快照。 */
export interface CoreStatus {
  state: CoreState
  running: boolean
  binary: string | null
  binarySource: BinarySource
  version: string | null
  socksPort: number
  httpPort: number
  /** 生成配置的绝对路径。 */
  configPath: string
  startedAt: number | null
  lastError: string | null
}

/** 一次配置校验的结果。 */
export interface CoreTestResult {
  ok: boolean
  /** xray 的合并输出（stdout + stderr），失败时就是诊断。 */
  output: string
}

const GRACE_MS = 3000
const TEST_TIMEOUT_MS = 20_000
const COLLECT_BYTES = 64 * 1024

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** 探测某个回环端口是否已经可以连上。 */
export function probePort(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** 内核进程管理。只认一个实例。 */
export class CoreManager {
  private readonly ctx: Context
  private readonly config: ResolvedConfig
  private readonly log: RingLog
  private handle: SubprocessHandle | undefined
  private state: CoreState = 'stopped'
  private binary: string | null = null
  private binarySource: BinarySource = 'missing'
  private version: string | null = null
  private lastError: string | null = null
  private startedAt: number | null = null
  private stopping = false

  constructor(ctx: Context, config: ResolvedConfig, log: RingLog) {
    this.ctx = ctx
    this.config = config
    this.log = log
  }

  /** 生成配置的路径。 */
  get configPath(): string {
    return join(this.config.dataDir, 'config.generated.json')
  }

  /** 上一份能起来的配置。 */
  private get lastGoodPath(): string {
    return join(this.config.dataDir, 'config.last-good.json')
  }

  /** 当前状态快照。 */
  status(): CoreStatus {
    return {
      state: this.state,
      running: this.state === 'running',
      binary: this.binary,
      binarySource: this.binarySource,
      version: this.version,
      socksPort: this.config.socksPort,
      httpPort: this.config.httpPort,
      configPath: this.configPath,
      startedAt: this.startedAt,
      lastError: this.lastError,
    }
  }

  /**
   * 定位 xray 可执行文件：先看配置，再在 PATH 上找。找不到不抛错 —— 规则引擎与
   * 仿真不依赖内核，只有启停才需要它。
   */
  async resolveBinary(force = false): Promise<{ path: string | null; source: BinarySource; error?: string }> {
    if (!force && this.binary !== null) return { path: this.binary, source: this.binarySource }
    const runtime = this.ctx.subprocess
    if (runtime === undefined) {
      this.binarySource = 'missing'
      return { path: null, source: 'missing', error: '本实例没有子进程服务，无法启动内核' }
    }
    const configured = this.config.coreBinary
    if (configured !== '') {
      this.binary = configured
      this.binarySource = 'config'
      this.version = await this.readVersion(configured)
      return { path: configured, source: 'config', ...(this.version === null ? { error: `配置的 coreBinary (${configured}) 无法执行` } : {}) }
    }
    try {
      const resolved = await runtime.resolveExecutable('xray')
      this.binary = resolved
      this.binarySource = 'path'
      this.version = await this.readVersion(resolved)
      return { path: resolved, source: 'path' }
    } catch {
      this.binary = null
      this.binarySource = 'missing'
      return {
        path: null,
        source: 'missing',
        error: '没有找到 xray 可执行文件。装一个（brew install xray）或在插件配置里把 coreBinary 指到绝对路径；插件不会自动下载二进制。',
      }
    }
  }

  private async readVersion(binary: string): Promise<string | null> {
    try {
      const handle = this.ctx.subprocess.spawn({
        argv: [binary, 'version'],
        cwd: this.config.dataDir,
        stdio: { stdin: 'ignore', stdout: { maxBytes: COLLECT_BYTES }, stderr: { maxBytes: COLLECT_BYTES } },
        graceMs: GRACE_MS,
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      })
      await handle.done
      const text = `${handle.collected.stdout?.readFrom(0).text ?? ''}`
      const match = /(?:Xray|V2Ray)\s+([0-9][^\s]*)/i.exec(text)
      return match?.[1] ?? null
    } catch {
      return null
    }
  }

  private writeConfigFile(body: Record<string, unknown>): void {
    writeFileSync(this.configPath, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
    chmodSync(this.configPath, 0o600)
  }

  /**
   * 记下这份「真的起来过」的配置，供下一次启动失败时回滚。只在启动成功之后写：
   * 先写会让「从未启动成功的配置」成为回滚目标。
   */
  private rememberGoodConfig(): void {
    try {
      writeFileSync(this.lastGoodPath, readFileSync(this.configPath), { mode: 0o600 })
    } catch (error) {
      this.log.push('error', `记录上一份好配置失败：${(error as Error).message}`)
    }
  }

  /**
   * geo 目录里有数据文件时，把它指给内核（`XRAY_LOCATION_ASSET`），让
   * `geosite:` / `geoip:` / `ext:` 真的用到插件配置的目录；目录空着就不设，
   * 保留内核自己的查找路径（例如 brew 的 xray 会指向 share/xray）。
   */
  private assetEnvironment(): NodeJS.ProcessEnv | undefined {
    try {
      if (!readdirSync(this.config.geoDir).some((entry) => entry.endsWith('.dat'))) return undefined
    } catch {
      return undefined
    }
    return { XRAY_LOCATION_ASSET: this.config.geoDir }
  }

  /**
   * 用 `xray -test -config` 校验一份配置。写盘的是临时目标（就是正式文件），
   * 因为 xray 只接受文件路径。
   */
  async test(body: Record<string, unknown>): Promise<CoreTestResult> {
    const resolved = await this.resolveBinary()
    if (resolved.path === null) return { ok: false, output: resolved.error ?? '没有可用的 xray 可执行文件' }
    try {
      this.writeConfigFile(body)
    } catch (error) {
      return { ok: false, output: `写配置文件失败：${(error as Error).message}` }
    }
    const env = this.assetEnvironment()
    try {
      const handle = this.ctx.subprocess.spawn({
        argv: [resolved.path, '-test', '-config', this.configPath],
        cwd: this.config.dataDir,
        stdio: { stdin: 'ignore', stdout: { maxBytes: COLLECT_BYTES }, stderr: { maxBytes: COLLECT_BYTES } },
        graceMs: GRACE_MS,
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
        ...(env === undefined ? {} : { env }),
      })
      const outcome = await handle.done
      const output = `${handle.collected.stdout?.readFrom(0).text ?? ''}${handle.collected.stderr?.readFrom(0).text ?? ''}`.trim()
      return { ok: outcome.exitCode === 0, output }
    } catch (error) {
      return { ok: false, output: `调用 xray 失败：${(error as Error).message}` }
    }
  }

  /** 启动内核；已在运行时直接返回。 */
  async start(body: Record<string, unknown>): Promise<void> {
    if (this.state === 'running') return
    const resolved = await this.resolveBinary()
    if (resolved.path === null) {
      this.state = 'error'
      this.lastError = resolved.error ?? '没有可用的 xray 可执行文件'
      throw new Error(this.lastError)
    }
    this.writeConfigFile(body)
    this.state = 'starting'
    this.stopping = false
    this.lastError = null
    this.log.push('action', `启动内核：${resolved.path} -config ${this.configPath}`)
    const env = this.assetEnvironment()
    if (env !== undefined) this.log.push('action', `geo 数据目录：${this.config.geoDir}`)
    try {
      const handle = this.ctx.subprocess.spawn({
        argv: [resolved.path, '-config', this.configPath],
        cwd: this.config.dataDir,
        stdio: { stdin: 'ignore', stdout: { maxBytes: COLLECT_BYTES }, stderr: { maxBytes: COLLECT_BYTES } },
        graceMs: GRACE_MS,
        ...(env === undefined ? {} : { env }),
      })
      this.handle = handle
      void this.observe(handle)
    } catch (error) {
      this.state = 'error'
      this.lastError = (error as Error).message
      this.log.push('error', `内核启动失败：${this.lastError}`)
      throw error
    }

    const ready = await this.waitForPorts()
    if (!ready) {
      const tail = this.log.tailText(8)
      this.state = 'error'
      this.lastError = tail === '' ? '端口在超时前没有就绪' : `端口在超时前没有就绪：${tail}`
      this.log.push('error', this.lastError)
      await this.stop()
      this.state = 'error'
      throw new Error(this.lastError)
    }
    this.state = 'running'
    this.startedAt = Date.now()
    this.rememberGoodConfig()
    this.log.push('action', `内核已就绪：socks 127.0.0.1:${this.config.socksPort}，http 127.0.0.1:${this.config.httpPort}`)
  }

  /** 观察进程退出：非主动停止时转入 error，不自动重启（避免代理环路里无限重启）。 */
  private async observe(handle: SubprocessHandle): Promise<void> {
    try {
      const outcome = await handle.done
      if (this.stopping) return
      if (this.handle !== handle) return
      const stderr = `${handle.collected.stderr?.readFrom(0).text ?? ''}`.trim()
      if (stderr !== '') this.log.push('core', stderr)
      this.state = 'error'
      this.lastError = `内核退出（code ${outcome.exitCode ?? 'signal'}）${stderr === '' ? '' : `：${stderr.split('\n').slice(-3).join(' ')}`}`
      this.lastError = this.lastError.trim()
      this.log.push('error', this.lastError)
      this.handle = undefined
    } catch (error) {
      if (this.stopping) return
      this.state = 'error'
      this.lastError = (error as Error).message
      this.log.push('error', `内核进程异常：${this.lastError}`)
      this.handle = undefined
    }
  }

  private async waitForPorts(): Promise<boolean> {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const socks = await probePort(this.config.socksPort)
      const http = socks ? await probePort(this.config.httpPort) : false
      if (socks && http) return true
      if (this.state === 'error') return false
      await sleep(250)
    }
    return false
  }

  /** 停止内核；没在运行时是空操作。 */
  async stop(): Promise<void> {
    const handle = this.handle
    if (handle === undefined) {
      this.state = 'stopped'
      this.startedAt = null
      return
    }
    this.stopping = true
    this.handle = undefined
    handle.terminate()
    try {
      await handle.waitForExit(AbortSignal.timeout(GRACE_MS + 2000))
    } catch {
      // 进程已经不在，或提供方无法观察它 —— 都不该阻塞停用。
    }
    this.state = 'stopped'
    this.startedAt = null
    this.log.push('action', '内核已停止')
  }

  /**
   * 应用一份新配置：先 `-test` 校验，通过才写盘并重启；启动失败时用上一份好配置
   * 再起一次，并把失败原因返回给调用方。
   * @param body - 完整的内核配置。
   */
  async apply(body: Record<string, unknown>): Promise<{ applied: boolean; tested: boolean; error?: string; rolledBack?: boolean }> {
    const testResult = await this.test(body)
    if (!testResult.ok) {
      return { applied: false, tested: false, error: testResult.output === '' ? '配置校验失败（xray -test 退出码非 0）' : testResult.output }
    }
    const previous = existsSync(this.lastGoodPath) ? readFileSync(this.lastGoodPath, 'utf8') : null
    const wasRunning = this.state === 'running' || this.state === 'starting'
    try {
      if (wasRunning) await this.stop()
      await this.start(body)
      return { applied: true, tested: true }
    } catch (error) {
      const reason = (error as Error).message
      if (previous === null) return { applied: false, tested: true, error: reason }
      this.log.push('error', `新配置启动失败，回滚到上一份：${reason}`)
      try {
        this.writeConfigFile(JSON.parse(previous) as Record<string, unknown>)
        await this.start(JSON.parse(previous) as Record<string, unknown>)
        return { applied: false, tested: true, error: reason, rolledBack: true }
      } catch (rollbackError) {
        this.state = 'error'
        this.lastError = `回滚也失败了：${(rollbackError as Error).message}`
        this.log.push('error', this.lastError)
        return { applied: false, tested: true, error: `${reason}；回滚失败：${this.lastError}` }
      }
    }
  }
}
