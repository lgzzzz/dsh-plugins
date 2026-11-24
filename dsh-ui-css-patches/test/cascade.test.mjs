/**
 * 级联测试:在真实浏览器里把「上游 CSS + 本插件 CSS」按真实挂载顺序放进同一个页面,
 * 用 `getComputedStyle` 断言最终字号。
 *
 * 为什么需要它:`check-css.mjs` 只能证明锚点 / 令牌还在,证明不了声明的级联胜负。
 * 2026-11 的正文行内代码失效就是后一类——上游 `.…_markdown :not(pre) > code` 是
 * `font-size: .875em !important`、特异性 `(0,1,2)`,而插件 `<style>` 在模块样式之前注入,
 * 同特异性 + 都带 `!important` 时后写者胜,规则肉眼可见地存在、契约也全绿,计算值却是 12.25px。
 * 这里把上游那段真实规则从安装产物里抽出来,和插件 CSS 按「插件在前、上游在后」放进同一页,
 * 谁赢由浏览器判定,不再靠人读特异性。
 *
 * 依赖本机安装的 DSH(与 check-css 同一套解析)与 Chrome/Chromium(可用 $CHROME_PATH 指定)。
 * 任一缺失时跳过并以 0 退出;设置 DSH_CSS_STRICT=1 可让跳过也报失败。
 *
 * 运行:`node test/cascade.test.mjs [--dsh-root <path>]`,或 `node test/run-all.mjs cascade`。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CSS } from '../src/css.ts'
import { resolveDshRoot } from '../dsh-root.mjs'

let failures = 0

function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

function skip(reason) {
  if (process.env.DSH_CSS_STRICT === '1') {
    failures += 1
    console.log(`FAIL 级联测试无法运行 — ${reason}(DSH_CSS_STRICT=1)`)
  } else {
    console.log(`skip  级联测试未运行 — ${reason}`)
  }
  finish()
}

function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/** 读取 `--dsh-root` 参数,与 check-css.mjs 的同名参数一致。 */
function dshRootArg(argv) {
  const i = argv.indexOf('--dsh-root')
  return i === -1 ? undefined : argv[i + 1]
}

/**
 * 从安装的 Web 前端产物里抽出 Markdown 组件的真实规则。
 * 类名带构建哈希(如 `.vD2sAq_markdown`),每次构建都会变,所以不能写死;
 * 结构变了(找不到规则)时返回 null,由调用方报失败。
 */
function readMarkdownRules(assetsDir) {
  if (!existsSync(assetsDir)) return null
  for (const name of readdirSync(assetsDir)) {
    if (!name.endsWith('.js')) continue
    const text = readFileSync(join(assetsDir, name), 'utf8')
    const code = text.match(/\.([A-Za-z0-9_-]+)_markdown\s+:not\(pre\)\s*>\s*code\{([^}]*)\}/)
    if (!code) continue
    const hash = code[1]
    const pick = (re) => {
      const m = text.match(re)
      return m ? m[0] : null
    }
    const root = pick(new RegExp(`\\.${hash}_markdown\\{[^}]*\\}`))
    const compactRoot = pick(new RegExp(`\\.${hash}_compact\\{[^}]*\\}`))
    const compactCode = pick(new RegExp(`\\.${hash}_compact\\s+:not\\(pre\\)\\s*>\\s*code\\{[^}]*\\}`))
    if (!root || !compactRoot || !compactCode) return null
    return { hash, file: join(assetsDir, name), markdownRoot: root, markdownCode: code[0], compactRoot, compactCode }
  }
  return null
}

/** 按平台常见路径找 Chrome/Chromium;都没有时返回 null。 */
function findChrome() {
  const explicit = process.env.CHROME_PATH
  if (explicit && existsSync(explicit)) return explicit

  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : process.platform === 'win32'
      ? [
          join(process.env.PROGRAMFILES ?? '', 'Google/Chrome/Application/chrome.exe'),
          join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google/Chrome/Application/chrome.exe'),
          join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
        ]
  for (const path of candidates) {
    if (path && existsSync(path)) return path
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const probe = spawnSync(name, ['--version'], { encoding: 'utf8' })
    if (probe.status === 0) return name
  }
  return null
}

/**
 * 启动一台无头 Chrome,返回 CDP 页面连接。
 * @returns {Promise<{ ws: WebSocket, send: Function, once: Function }>}
 */
async function launchChrome(chromePath) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'dsh-cascade-'))
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )

  let browserWs
  try {
    browserWs = await new Promise((resolve, reject) => {
      let buffered = ''
      const timer = setTimeout(() => reject(new Error('Chrome 未在 20s 内打印 DevTools 地址')), 20000)
      const cleanup = () => { clearTimeout(timer); child.stderr.off('data', onData); child.off('exit', onExit) }
      const onData = (chunk) => {
        buffered += chunk
        const match = buffered.match(/DevTools listening on (ws:\/\/\S+)/)
        if (match) { cleanup(); resolve(match[1]) }
      }
      const onExit = (code) => { cleanup(); reject(new Error(`Chrome 提前退出(code ${code})`)) }
      child.stderr.on('data', onData)
      child.on('exit', onExit)
    })
  } catch (error) {
    child.kill('SIGKILL')
    rmSync(userDataDir, { recursive: true, force: true })
    throw error
  }

  // Chrome 只会把浏览器级地址打到 stderr;页面目标要从 /json/list 取。
  const port = new URL(browserWs).port
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('Chrome 没有可用的 page target')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const listeners = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
      return
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params)
  })
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const once = (method) => new Promise((resolve) => {
    const listener = (params) => {
      listeners.set(method, (listeners.get(method) ?? []).filter((each) => each !== listener))
      resolve(params)
    }
    listeners.set(method, [...(listeners.get(method) ?? []), listener])
  })

  return {
    ws,
    send,
    once,
    dispose: async () => {
      try { ws.close() } catch { /* 已断开 */ }
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve))
        child.kill('SIGKILL')
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))])
      }
      try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* Windows 上偶发占用 */ }
    },
  }
}

/** 页面里的测量脚本:同一棵 fixture,分别在启用 / 禁用插件样式时读计算字号。 */
const MEASURE = `(() => {
  const size = (id) => {
    const el = document.getElementById(id)
    return el === null ? null : getComputedStyle(el).fontSize
  }
  const plugin = document.getElementById('plugin')
  const withPlugin = {
    answer: size('answer-code'),
    thinking: size('thinking-code'),
    plan: size('plan-code'),
    document: size('doc-code'),
  }
  plugin.disabled = true
  const upstreamOnly = {
    answer: size('answer-code'),
    thinking: size('thinking-code'),
    plan: size('plan-code'),
    document: size('doc-code'),
  }
  plugin.disabled = false
  return { withPlugin, upstreamOnly }
})()`

async function main() {
  const dshRoot = resolveDshRoot(dshRootArg(process.argv.slice(2)))
  if (!dshRoot) return skip('无法定位 DSH 根目录(可用 --dsh-root 或 $DSH_ROOT 指定)')

  const rules = readMarkdownRules(join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets'))
  if (!rules) {
    failures += 1
    console.log('FAIL 上游 Markdown 规则的结构变了 — 找不到 `.…_markdown :not(pre) > code` 及其 compact 变体,请复核本测试与 css.ts 里的行内代码规则')
    return finish()
  }
  if (!/font-size\s*:\s*\.875em\s*!important/.test(rules.markdownCode)) {
    failures += 1
    console.log(`FAIL 上游行内代码规则不再是 .875em !important — 请复核测试与补丁规则:${rules.markdownCode}`)
    return finish()
  }

  const chromePath = findChrome()
  if (!chromePath) return skip('未找到 Chrome/Chromium(可用 $CHROME_PATH 指定)')
  if (typeof WebSocket === 'undefined') return skip('当前 Node 没有全局 WebSocket(需要 Node 22+)')

  // 与线上同一来源的主题令牌:--dsw-font-markdown-base 等都由它在 body 上定义。
  const themeCssPath = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'src', 'styles', 'gradient-shadow-text.css')
  if (!existsSync(themeCssPath)) return skip(`主题令牌样式不存在:${themeCssPath}`)
  const themeCss = readFileSync(themeCssPath, 'utf8')
  // base.css 定义 --dsw-font-family / --ds-font-family-code;没有它,markdown 根上的
  // `font: var(--dsw-font-markdown-base)` 整条失效,会退回浏览器默认的 16px。
  const baseCssPath = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'src', 'styles', 'base.css')
  if (!existsSync(baseCssPath)) return skip(`主题基础样式不存在:${baseCssPath}`)
  const baseCss = readFileSync(baseCssPath, 'utf8')

  const fixture = `<!doctype html>
<html><head><meta charset="utf-8">
<!-- 插件样式在先:与线上一致(插件启动期注入,模块样式随后加载)。平局必须由特异性赢。 -->
<style id="plugin">${CSS}</style>
<style id="upstream">
${baseCss}
${themeCss}
body { --dsh-content-font-size: 14px; }
${rules.markdownRoot}
${rules.markdownCode}
${rules.compactRoot}
${rules.compactCode}
</style></head>
<body>
<div data-chat-flow-kind="assistant-step">
  <div class="${rules.hash}_markdown"><p>正文 <code id="answer-code">inline</code></p></div>
</div>
<div data-chat-flow-kind="turn-process">
  <div data-step-process-content>
    <div class="${rules.hash}_markdown ${rules.hash}_compact" data-markdown-variant="compact">
      <p>思考 <code id="thinking-code">inline</code></p>
    </div>
  </div>
</div>
<section data-plan-preview>
  <div class="${rules.hash}_markdown"><p>计划 <code id="plan-code">inline</code></p></div>
</section>
<div data-textpreview-body>
  <div data-document-markdown>
    <div class="${rules.hash}_markdown"><p>文档 <code id="doc-code">inline</code></p></div>
  </div>
</div>
</body></html>`

  const dir = mkdtempSync(join(tmpdir(), 'dsh-cascade-fixture-'))
  const fixturePath = join(dir, 'index.html')
  writeFileSync(fixturePath, fixture)

  const chrome = await launchChrome(chromePath)
  try {
    await chrome.send('Page.enable')
    const loaded = chrome.once('Page.loadEventFired')
    await chrome.send('Page.navigate', { url: pathToFileURL(fixturePath).href })
    await Promise.race([
      loaded,
      new Promise((_, reject) => setTimeout(() => reject(new Error('fixture 页面 10s 内未加载完成')), 10000)),
    ])

    const outcome = await chrome.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true })
    if (outcome.exceptionDetails) throw new Error(outcome.exceptionDetails.exception?.description ?? '页面测量脚本抛错')
    const { withPlugin, upstreamOnly } = outcome.result.value

    console.log(`fixture:${rules.hash}_markdown(来源 ${rules.file})`)
    // 对照组先证明这棵树真的会命中上游规则,否则下面的 14px 只是没被覆盖。
    check('上游单独作用:正文行内代码 = 0.875em × 14px', upstreamOnly.answer, '12.25px')
    check('上游单独作用:思考行内代码 = 1em × compact 的 13px', upstreamOnly.thinking, '13px')
    check('上游单独作用:计划预览行内代码 = 0.875em × 14px', upstreamOnly.plan, '12.25px')
    check('上游单独作用:文档预览行内代码 = 0.875em × 14px', upstreamOnly.document, '12.25px')
    // 被测值:插件 CSS 在模块样式之前注入,仍须是 14px。
    check('插件生效:正文行内代码 14px', withPlugin.answer, '14px')
    check('插件生效:思考行内代码 14px(过程组子树已统一 14px)', withPlugin.thinking, '14px')
    check('插件生效:计划预览行内代码 14px(1em × 14px)', withPlugin.plan, '14px')
    check('插件生效:文档预览行内代码 14px(1em × 14px)', withPlugin.document, '14px')
  } finally {
    await chrome.dispose()
    rmSync(dir, { recursive: true, force: true })
  }

  finish()
}

main().catch((error) => {
  console.error(error)
  failures += 1
  finish()
})

