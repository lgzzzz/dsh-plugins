#!/usr/bin/env node
// check-css.mjs — 构建后静态契约校验器
// 验证 dsh-agent-auto-retry 依赖的上游事实是否仍存在于 DSH 安装产物中。
// 无需运行时、无需浏览器、无需挂载插件。
//
// 本插件是 agent loop `agent/request-error` waterfall 上的一个恢复策略：下游都放弃后，
// 它按自己的策略重试同一次模型请求，并把每次重试写成与上游同形的 llm/retry /
// llm/retry-started 事件。会**静默**退化或写出不被接受的日志的上游事实有三类：
//   1. 接线本身——loop 是否还派发这个 waterfall、载荷里的 failure 从哪来、下游默认决定
//      是不是 undefined、loop 是否仍认 { kind: 'retry' }；
//   2. 事件契约——会话格式校验器对编号连续性、坐标与 retryId 唯一性的硬约束，客户端与
//      token 计量对两个事件的消费点；
//   3. 隔离前提——上游执行器 dsh-llm-retry 的策略键算法（本插件靠 policyKey 前缀与它分链）。
// 这里在构建后把清单逐条对上游产物 grep 一遍，缺一条就显式失败，提示里写明后果。
//
// 用法(本脚本与 contract.json 同目录):
//   node dsh-agent-auto-retry/check-css.mjs [--dsh-root <path>] [--manifest <json>]
// DSH 根目录解析顺序: --dsh-root > $DSH_ROOT > `npm root -g` > 常见全局安装路径
//
// 退出码: 0 = 全部通过(或无法定位 DSH 根目录时仅告警), 1 = 存在契约缺失, 2 = 配置错误

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

// 契约清单默认与脚本同目录。
const here = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dsh-root') out.dshRoot = argv[++i]
    else if (a === '--manifest') out.manifest = argv[++i]
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function resolveDshRoot(opt) {
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

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) {
      if (name === 'node_modules') continue // 跳过包内嵌套依赖
      walk(p, out)
    } else if (/\.(js|mjs|cjs|ts|tsx|css|json)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

function firstMatch(needle, files) {
  for (const f of files) {
    try {
      const text = readFileSync(f, 'utf8')
      const hit = needle instanceof RegExp ? needle.test(text) : text.includes(needle)
      if (hit) return f
    } catch { /* 不可读则跳过 */ }
  }
  return null
}

const HELP = `check-css: dsh-agent-auto-retry 的构建后上游事实契约校验器
  node dsh-agent-auto-retry/check-css.mjs [--dsh-root <path>] [--manifest <json>]
`

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (a.help) { console.log(HELP); process.exit(0) }

  const manifestPath = resolve(a.manifest ?? join(here, 'contract.json'))
  if (!existsSync(manifestPath)) { console.error(`[check-css] manifest 不存在: ${manifestPath}`); process.exit(2) }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

  const dshRoot = resolveDshRoot(a.dshRoot)
  if (!dshRoot) {
    console.warn('[check-css] 无法定位 DSH 根目录 — 跳过校验（可通过 --dsh-root 或 $DSH_ROOT 指定）')
    process.exit(0)
  }
  const pkgsRoot = join(dshRoot, 'node_modules', '@deepseek-ai')
  if (!existsSync(pkgsRoot)) {
    console.warn(`[check-css] 包根目录不存在: ${pkgsRoot} — 跳过校验`)
    process.exit(0)
  }

  const cache = new Map()
  const filesFor = (paths) => {
    const key = JSON.stringify(paths)
    if (!cache.has(key)) {
      const dirs = paths.length ? paths.map((p) => join(pkgsRoot, ...p.split('/'))) : [pkgsRoot]
      const files = []
      for (const d of dirs) walk(d, files)
      cache.set(key, files)
    }
    return cache.get(key)
  }

  const checks = manifest.checks
  if (!Array.isArray(checks)) {
    console.error(`[check-css] manifest 缺少 checks 数组: ${manifestPath}`)
    process.exit(2)
  }

  // 逐条校验:任一条规则失败(含正则写错、清单缺 needle)都只记录、不中断,
  // 保证一次运行能覆盖清单里的每一条;全部跑完后在末尾统一列出失效规则。
  let pass = 0
  const failed = []
  for (const c of checks) {
    const { id = '(未命名)', plugin = '(未声明)', token, pattern, paths = [], hint } = c
    const label = `${plugin}/${id}`
    const shown = token ?? pattern ?? '(未声明)'
    try {
      const needle = pattern ? new RegExp(pattern, 's') : token ?? null
      if (needle === null) failed.push({ label, shown, hint: '清单缺少 token 或 pattern' })
      else if (firstMatch(needle, filesFor(paths))) pass++
      else failed.push({ label, shown, hint: hint ?? '契约 token 缺失' })
    } catch (e) {
      failed.push({ label, shown, hint: `规则无法校验: ${e.message}` })
    }
  }

  const total = pass + failed.length
  if (failed.length) {
    console.error(`\n[check-css] 失效规则 ${failed.length}/${total}:`)
    for (const f of failed) {
      console.error(`\u2717  ${f.label}  —  ${f.hint}`)
      console.error(`     needle: ${f.shown}`)
    }
  }

  console.log(`\n[check-css] ${pass}/${total} 通过${failed.length ? `，${failed.length} 失败` : ''}  (dsh: ${dshRoot})`)
  process.exit(failed.length ? 1 : 0)
}

main()
