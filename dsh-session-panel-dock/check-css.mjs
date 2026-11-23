#!/usr/bin/env node
// check-css.mjs — 构建后静态契约校验器
// 验证 dsh-session-panel-dock 依赖的上游锚点、CSS 变量与判定逻辑是否仍存在于 DSH Web
// 安装产物中。无需运行时、无需浏览器。
//
// 本插件只做两件纯 CSS 的事:把主对话的停靠探针钉成 1px,并在面板 pin 住时把正文列宽
// 收窄到「列宽 − 400px」。会**静默**退化的上游事实:
//   1. 探针 / reserve 标记 / 会话面板根被改名或移除——选择器整条落空,面板退回浮层或隐藏;
//   2. 上游把 `contentRect.width >= 1` 的判定改掉——钉成 1px 的探针不再被认成「有空间」;
//   3. `--dsh-chat-content-width-resolved` / `--dsh-chat-content-width` /
//      `--dsh-conversation-column-width` 被改名或不再消费——正文收窄规则失效,面板压住正文;
//   4. 停靠阈值（40 + 8 + 300 = 348）或 reserve 公式变化——400px 的让位量不再恰好够用,
//      面板与正文之间的 40px 间距变形,或主体拒绝让位。
// 这里在构建后把清单逐条对上游产物 grep 一遍,缺一条就显式失败,提示里写明后果。
// 契约默认是「必须命中」(token / pattern);清单里带 forbid 的条目是**反向契约**「必须不命中」。
//
// 用法(本脚本与 css-contract.json 同目录):
//   node dsh-session-panel-dock/check-css.mjs [--dsh-root <path>] [--manifest <json>]
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
  node dsh-session-panel-dock/check-css.mjs [--dsh-root <path>] [--manifest <json>]
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
