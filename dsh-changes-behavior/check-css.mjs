#!/usr/bin/env node
// check-css.mjs — 构建后静态契约校验器
// 验证 dsh-changes-behavior 依赖的上游 DOM 锚点、右栏公开面与 review store 契约是否仍存在于
// DSH 客户端构建产物中。无需运行时、无需浏览器。
//
// 会**静默**退化的上游事实包括:
//   1. 改动卡片 / 审查标签页 / 右栏面板的 data-* 锚点改名或换结构——点击改写、默认分栏 /
//      换行、悬停闸门或字号覆盖整条落空;
//   2. 右栏打开入口、全屏命令或 review store 写入口改名——指定入口不再全屏、其余入口不再
//      切回推挤,或默认分栏 / 换行静默失效;
//   3. 上游开始用 !important 钉字号——本插件的 !important 可能被更高特异性或更晚的压过。
// 这里在构建后把清单逐条对上游产物 grep 一遍,缺一条就显式失败,提示里写明后果。
// 契约默认是「必须命中」(token / pattern);清单里带 forbid 的条目是**反向契约**「必须不命中」,
// 用于钉住「换个地方出现同样的锚点会让选择器撞车」这类退化(命中即失败)。
//
// 用法(本脚本与 contract.json 同目录):
//   node dsh-changes-behavior/check-css.mjs [--dsh-root <path>] [--manifest <json>]
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

const HELP = `check-css: 构建后 CSS 契约校验器
  node dsh-changes-behavior/check-css.mjs [--dsh-root <path>] [--manifest <json>]
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
    const { id = '(未命名)', plugin = '(未声明)', token, pattern, forbid, paths = [], hint } = c
    const label = `${plugin}/${id}`
    const shown = forbid !== undefined ? `forbid ${forbid}` : token ?? pattern ?? '(未声明)'
    try {
      if (forbid !== undefined) {
        // 反向契约:命中即失败(例如另一个浮层菜单改用同一 aria-label 文案时,选择器会同时命中它)。
        const hit = firstMatch(new RegExp(forbid, 's'), filesFor(paths))
        if (hit === null) pass++
        else failed.push({ label, shown, hint: hint ?? '契约禁止的 token 出现了', where: hit })
      } else {
        const needle = pattern ? new RegExp(pattern, 's') : token ?? null
        if (needle === null) failed.push({ label, shown, hint: '清单缺少 token 或 pattern' })
        else if (firstMatch(needle, filesFor(paths))) pass++
        else failed.push({ label, shown, hint: hint ?? '契约 token 缺失' })
      }
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
      if (f.where !== undefined) console.error(`     命中于: ${f.where}`)
    }
  }

  console.log(`\n[check-css] ${pass}/${total} 通过${failed.length ? `，${failed.length} 失败` : ''}  (dsh: ${dshRoot})`)
  process.exit(failed.length ? 1 : 0)
}

main()
