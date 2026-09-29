/**
 * Upstream markdown/code CSS drift check.
 *
 * Why this exists: the plugin deliberately uses a *property-level* override
 * (see src/styles/gradient-shadow-text.css, `html body .markdown :not(pre) > code`)
 * instead of shipping a copy of the upstream sheet. A wholesale copy is not
 * possible: the shipped component CSS carries CSS-Modules hashed class names
 * (`_markdown_1ypvv_5`), so any copied selector goes stale — and silently
 * non-matching — the moment an upstream build bumps the hash.
 *
 * What this script does instead: reads the CSS the DS harness actually serves,
 * extracts the rules this plugin's overrides depend on, and diffs them against
 * a committed baseline.
 *
 * Usage (from the plugin directory):
 *   node scripts/check-upstream-code-css.mjs baseline   # write/refresh baseline
 *   node scripts/check-upstream-code-css.mjs check      # fail on drift (exit 1)
 *
 * `--css <path>` pins a specific stylesheet instead of globbing the installed one.
 * The baseline (`upstream-code-css.baseline.json`, same directory) is committed so
 * a fresh clone can diff against the last known-good upstream shape.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASELINE = join(HERE, 'upstream-code-css.baseline.json')

/** Rules this plugin's overrides/tokens depend on, with why each one matters. */
const WATCHED = [
  {
    id: 'inline-code',
    label: '行内代码芯片（本插件用 font-size 覆盖的就是这条）',
    // Matches the hashed runtime class form of `.markdown :not(pre) > code`.
    match: /\._markdown_[A-Za-z0-9]+_\d+\s+:not\(pre\)>code\{[^}]*\}/,
    tokens: ['font-size:.875em!important'],
  },
  {
    id: 'heading-code',
    label: '标题内代码（走 font:inherit，不受本插件影响）',
    match: /\._markdown_[A-Za-z0-9]+_\d+\s+:where\(h1,h2,h3,h4,h5,h6\)\s*code\{[^}]*\}/,
    tokens: ['font:inherit'],
  },
  {
    id: 'compact-code',
    label: '紧凑视图行内代码（1em）',
    match: /\._compact_[A-Za-z0-9]+_\d+\s+:not\(pre\)>code\{[^}]*\}/,
    tokens: ['font-size:1em!important'],
  },
  {
    id: 'markdown-root',
    label: 'markdown 根部（本插件 [class*="markdown"] 断言的依据）',
    match: /\._markdown_[A-Za-z0-9]+_\d+\{[^}]*font:var\(--dsw-font-markdown-base\)[^}]*\}/,
    tokens: ['font:var(--dsw-font-markdown-base)'],
  },
  {
    id: 'code-block-token',
    label: '围栏块令牌消费点',
    match: /--dsl-code-block-content-font:[^;}]+/,
    tokens: ['--dsw-font-markdown-code-block'],
  },
]

/**
 * Locate the stylesheet the installed harness serves.
 * @param explicit - `--css` override, when the caller pinned a file.
 * @returns absolute path of the first candidate that exists.
 */
function findServedCss(explicit) {
  if (explicit !== undefined) return resolve(explicit)
  const dshRoot = join(
    process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'),
    'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai',
  )
  const assets = join(dshRoot, 'dsh-web-frontend', 'dist', 'assets')
  if (existsSync(assets)) {
    const hit = readdirSync(assets).filter(name => name.startsWith('index-') && name.endsWith('.css'))
    if (hit.length > 0) return join(assets, hit.sort()[0])
  }
  throw new Error(`找不到已安装的 web 前端样式表，请用 --css <path> 指定（查过：${assets}）`)
}

/** Slice out the rules this plugin depends on, as plain text. */
function extract(css) {
  const found = {}
  for (const rule of WATCHED) {
    const hit = css.match(rule.match)
    found[rule.id] = hit === null ? null : hit[0]
  }
  return found
}

/** Hash a rule string so the baseline stays small and diff-friendly. */
function digest(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function short(value) {
  return value === null ? '(未找到)' : value.length > 140 ? `${value.slice(0, 140)}…` : value
}

/** Top-level entry. */
function main() {
  const args = process.argv.slice(2)
  const mode = args.find(arg => !arg.startsWith('--')) ?? 'check'
  const cssFlag = args.indexOf('--css')
  const cssPath = findServedCss(cssFlag >= 0 ? args[cssFlag + 1] : undefined)
  const css = readFileSync(cssPath, 'utf8')
  const extracted = extract(css)

  console.log(`样式表: ${cssPath} (${css.length} chars)`)

  if (mode === 'baseline' || mode === 'capture') {
    const baseline = {
      capturedFrom: cssPath,
      capturedAt: new Date().toISOString(),
      rules: Object.fromEntries(WATCHED.map(rule => [rule.id, {
        label: rule.label,
        tokens: rule.tokens,
        digest: extracted[rule.id] === null ? null : digest(extracted[rule.id]),
      }])),
    }
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(`基线已写入 ${BASELINE}`)
    return
  }

  if (!existsSync(BASELINE)) {
    console.error(`没有基线，先跑一次 baseline：node .scratch/check-upstream-code-css.mjs baseline`)
    process.exitCode = 2
    return
  }

  const previous = JSON.parse(readFileSync(BASELINE, 'utf8'))
  let drifted = 0
  let missing = 0
  for (const rule of WATCHED) {
    const now = extracted[rule.id]
    const before = previous.rules?.[rule.id]
    if (now === null) {
      console.log(`✗ ${rule.id} — 规则从上游消失了（选择器可能已改名）`)
      console.log(`    ${rule.label}`)
      missing += 1
      continue
    }
    for (const token of rule.tokens) {
      if (!now.includes(token)) {
        console.log(`✗ ${rule.id} — 关键属性不见了: ${token}`)
        console.log(`    现在: ${short(now)}`)
        drifted += 1
      }
    }
    if (before?.digest !== undefined && before.digest !== digest(now)) {
      console.log(`△ ${rule.id} — 与本仓库基线不同（上游可能已改动 ${rule.label}）`)
      console.log(`    基线: ${short(before.digest)}  现在: ${digest(now)}`)
      console.log(`    现在: ${short(now)}`)
      drifted += 1
    }
  }

  if (drifted === 0 && missing === 0) {
    console.log('✓ 上游相关规则与基线一致，本插件的覆盖仍落在同一批属性上')
    return
  }
  console.log(`\n共 ${drifted + missing} 处需要人工确认：覆盖规则的选择器/属性是否仍然成立。`)
  process.exitCode = 1
}

main()
