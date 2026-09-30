#!/usr/bin/env node
// check-css.mjs — 构建后静态契约校验器
// 验证统一 CSS 补丁插件 dsh-ui-css-patches 所依赖的 data-* 属性与 CSS 变量，
// 是否仍存在于 DSH Web 前端构建产物中。无需运行时、无需浏览器。
//
// 用法(本脚本与 css-contract.json 同目录,即 dsh-ui-css-patches/):
//   node dsh-ui-css-patches/check-css.mjs [--dsh-root <path>] [--manifest <json>]
//   在插件目录内: node check-css.mjs
// DSH 根目录解析顺序: --dsh-root > $DSH_ROOT > `npm root -g` > 常见全局安装路径
// (受限沙箱下 `npm root -g` 会因 EPERM 失败,故必须保留无需 spawn 的路径回退)
//
// 退出码: 0 = 全部通过(或无法定位 DSH 根目录时仅告警), 1 = 存在契约缺失, 2 = 配置错误

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

// 契约清单默认与脚本同目录(随插件一起移动/复制,不依赖仓库根布局)。
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
  } catch { /* 受限沙箱下 spawn 子进程会被拒(EPERM),继续走下面的纯路径回退 */ }

  // 纯路径回退:不 spawn 任何子进程,因此在受限环境下同样可用。
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

const HELP = `check-css: 构建后 CSS 契约校验器
  node dsh-ui-css-patches/check-css.mjs [--dsh-root <path>] [--manifest <json>]
`

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (a.help) { console.log(HELP); process.exit(0) }

  const manifestPath = resolve(a.manifest ?? join(here, 'css-contract.json'))
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

  let pass = 0
  const failed = []
  for (const c of manifest.checks ?? []) {
    const { id, plugin, token, pattern, paths = [], hint } = c
    const needle = pattern ? new RegExp(pattern, 's') : token ?? null
    if (needle === null) { console.warn(`[check-css] 跳过 ${plugin}/${id}: 缺少 token 或 pattern`); continue }
    if (firstMatch(needle, filesFor(paths))) pass++
    else failed.push({ id, plugin, needle: token ?? pattern, hint })
  }

  for (const f of failed) {
    console.error(`\u2717  ${f.plugin}/${f.id}  —  ${f.hint ?? '契约 token 缺失'}`)
    console.error(`     needle: ${f.needle}`)
  }

  const total = pass + failed.length
  console.log(`\n[check-css] ${pass}/${total} 通过${failed.length ? `，${failed.length} 失败` : ''}  (dsh: ${dshRoot})`)
  process.exit(failed.length ? 1 : 0)
}

main()
