/**
 * 级联测试:在真实浏览器里把「上游 CSS + 本插件 CSS」按真实挂载顺序放进同一个页面,
 * 用 `getComputedStyle` 断言最终字号,以及编辑工具行体量后缀 / diff 统计的 display。
 *
 * 为什么需要它:`check-css.mjs` 只能证明锚点 / 令牌还在,证明不了声明的级联胜负。
 * 2026-11 的正文行内代码失效就是后一类——上游 `.…_markdown :not(pre) > code` 是
 * `font-size: .875em !important`、特异性 `(0,1,2)`,而插件 `<style>` 在模块样式之前注入,
 * 同特异性 + 都带 `!important` 时后写者胜,规则肉眼可见地存在、契约也全绿,计算值却是 12.25px。
 * 这里把上游那段真实规则从安装产物里抽出来,和插件 CSS 按「插件在前、上游在后」放进同一页,
 * 谁赢由浏览器判定,不再靠人读特异性。
 * 工具行那条同理:体量后缀与 diff 统计共用 summarySuffix,只有前者应被 `:not(…_diffStat)`
 * 排除出去,display 的计算值由浏览器给出。
 * 正文限宽那条也是同一类问题:静态契约只能证明 280 / 1024 / 348 / 52 / 滚动条还在,
 * 证明不了 `min(100vw − 687px, V − 104px)` 的三段取值(参考态、右栏占轨、左栏收起)
 * 以及探针随正文宽度的 1px / 0px 翻转。这里用一份最小 DOM(内容盒 + 聊天框 + 列 +
 * 上游探针公式桩)在浏览器里改 V 与视口,量计算宽度。
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

/**
 * 从安装产物里抽出工具行(ToolRow)与摘要后缀(TextShimmer)的真实模块 CSS 与类名。
 * 体量后缀就是 TextShimmer 根类 + ToolRow 的 summarySuffix 局部类名,diff 统计再多一个
 * diffStat 局部类名;这些类名都带构建哈希,运行时从类名映射对象 / 规则文本里读,不写死。
 * 结构变了(找不到类名或规则)时返回 null,由调用方报失败。
 */
function readToolRowRules(dshRoot) {
  const toolDir = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-tool', 'lib')
  const assetsDir = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets')
  if (!existsSync(toolDir) || !existsSync(assetsDir)) return null

  let tool = null
  for (const name of readdirSync(toolDir)) {
    if (!name.endsWith('.js')) continue
    const text = readFileSync(join(toolDir, name), 'utf8')
    const sheet = text.match(/"src\/client\/tool\/components\/ToolRow\.module\.css":\{text:context=>`([^`]*)`/)
    const suffix = text.match(/"summarySuffix":`([A-Za-z0-9_-]+_summarySuffix)`/)
    const diffStat = text.match(/"diffStat":`([A-Za-z0-9_-]+_diffStat)`/)
    if (!sheet || !suffix || !diffStat) continue
    if (!sheet[1].includes(`.${suffix[1]}{`) || !sheet[1].includes(`.${diffStat[1]}{`)) continue
    tool = { suffix: suffix[1], diffStat: diffStat[1], toolCss: sheet[1], toolFile: join(toolDir, name) }
    break
  }
  if (tool === null) return null

  for (const name of readdirSync(assetsDir)) {
    if (!name.endsWith('.js')) continue
    const text = readFileSync(join(assetsDir, name), 'utf8')
    const sheet = text.match(/"src\/TextShimmer\.module\.css":\{text:[A-Za-z_$][\w$]*=>"([^"]*)"/)
    if (!sheet) continue
    const root = sheet[1].match(/\.([A-Za-z0-9_-]+_root)\{/)
    if (!root || !sheet[1].includes('display:inline-grid')) continue
    return { ...tool, shimmerRoot: root[1], shimmerCss: sheet[1], shimmerFile: join(assetsDir, name) }
  }
  return null
}

/**
 * 从安装产物里抽出轮次导航轨道(TurnNavigator)的真实模块 CSS 与类名。
 * 这条轨道由上游 `@container (width<=900px){.…_frame{display:none}}` 在窄容器里隐藏,
 * 插件要把它恢复成 block;frame / slot 的类名带构建哈希,运行时从模块 CSS 文本里读,
 * 不写死。结构变了(找不到 sheet 或两条规则)时返回 null,由调用方报失败。
 */
function readTurnRailRules(dshRoot) {
  const chatDir = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib')
  if (!existsSync(chatDir)) return null
  for (const name of readdirSync(chatDir)) {
    if (!name.endsWith('.js')) continue
    const text = readFileSync(join(chatDir, name), 'utf8')
    const sheet = text.match(/"src\/client\/chat\/TurnNavigator\.module\.css":\{text:context=>`([^`]*)`/)
    if (!sheet) continue
    const railCss = sheet[1]
    const slot = railCss.match(/\.([A-Za-z0-9_-]+)_slot\{/)
    const frame = railCss.match(/\.([A-Za-z0-9_-]+)_frame\{/)
    if (!slot || !frame || slot[1] !== frame[1]) continue
    if (!/@container \(width<=900px\)\{[^{}]*_frame\{display:none\}\}/.test(railCss)) continue
    return { hash: slot[1], railCss, railFile: join(chatDir, name) }
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

/** 页面里的测量脚本:同一棵 fixture,分别在启用 / 禁用插件样式时读计算字号与 display。 */
const MEASURE = `(() => {
  const size = (id) => {
    const el = document.getElementById(id)
    return el === null ? null : getComputedStyle(el).fontSize
  }
  const display = (id) => {
    const el = document.getElementById(id)
    return el === null ? null : getComputedStyle(el).display
  }
  const transition = (id) => {
    const el = document.getElementById(id)
    return el === null ? null : getComputedStyle(el).transitionProperty
  }
  const read = () => ({
    answer: size('answer-code'),
    thinking: size('thinking-code'),
    plan: size('plan-code'),
    document: size('doc-code'),
    kbSuffix: display('kb-suffix'),
    diffStat: display('diff-stat'),
    animatingTransition: transition('animating-frame'),
    staticTransition: transition('static-frame'),
    railFrame: display('rail-frame'),
    railFrameBare: display('rail-frame-bare'),
    railFrameWide: display('rail-frame-wide'),
  })
  const plugin = document.getElementById('plugin')
  const withPlugin = read()
  plugin.disabled = true
  const upstreamOnly = read()
  plugin.disabled = false
  return { withPlugin, upstreamOnly }
})()`

/**
 * 视口 1600 下的正文限宽三态:参考态(V=1313)、右栏占轨(V=593)、左栏收起(V=1593)。
 * 正文取 min(100vw − 687px, V − 104px),探针桩按上游公式回报 1px / 0px。
 */
const LAYOUT_MEASURE = `(() => {
  const content = document.getElementById('layout-content')
  const column = document.getElementById('layout-column')
  const probe = document.getElementById('layout-probe')
  const read = () => ({
    column: Math.round(column.getBoundingClientRect().width),
    probe: getComputedStyle(probe).width,
  })
  const viewport = (px) => {
    content.style.setProperty('--dsh-conversation-viewport-width', px + 'px')
    content.style.width = px + 'px'
  }
  viewport(1313)
  const normal = read()
  viewport(593)
  const squeezed = read()
  viewport(1593)
  const sidebarClosed = read()
  return { normal, squeezed, sidebarClosed }
})()`

/** 视口 800(<1024,参考左栏 0)下同一棵树:最大宽度 = 100vw − 407px。 */
const LAYOUT_NARROW_MEASURE = `(() => {
  const content = document.getElementById('layout-content')
  const column = document.getElementById('layout-column')
  const probe = document.getElementById('layout-probe')
  content.style.setProperty('--dsh-conversation-viewport-width', '793px')
  content.style.width = '793px'
  return {
    column: Math.round(column.getBoundingClientRect().width),
    probe: getComputedStyle(probe).width,
  }
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

  const tool = readToolRowRules(dshRoot)
  if (!tool) {
    failures += 1
    console.log('FAIL 上游工具行的结构变了 — 找不到 ToolRow 的 summarySuffix / diffStat 类名或 TextShimmer 的 inline-grid 根规则,请复核本测试与 css.ts 里的 KB 体量后缀规则')
    return finish()
  }

  const rail = readTurnRailRules(dshRoot)
  if (!rail) {
    failures += 1
    console.log('FAIL 上游轮次导航轨道的结构变了 — 找不到 TurnNavigator 的 frame / slot 类名或窄容器隐藏规则,请复核本测试与 css.ts 里的轨道常显规则')
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
${tool.toolCss}
${tool.shimmerCss}
/* 轮次导航轨道(TurnNavigator)的真实模块 CSS:含窄容器隐藏 frame 的 @container 规则。 */
${rail.railCss}
/* 开关时帧上的轨道过渡(上游 .frame[data-animating] 的原样写法):插件必须把帧自己的
   transition 关掉,否则正文列会被 300ms 的中间态逐帧拖动。 */
.frame[data-animating] { transition: grid-template-columns 300ms var(--ds-ease-in-out); }
/* 正文限宽的上游桩:探针宽度按上游公式 max(尾部空档 − 348 + 1px, reserve-room) 取,
   尾部空档用 (V − 正文宽)/2,reserve-max 用 V − 正文宽 − 32;max-width:1px 把结果钉成 1/0。 */
#layout-probe {
  display: block;
  max-width: 1px;
  height: 0;
  width: max(
    calc((var(--dsh-conversation-viewport-width, 1040px) - var(--dsh-chat-content-width, 100%)) / 2 - 348px + 1px),
    clamp(0px, calc((var(--dsh-conversation-viewport-width, 1040px) - var(--dsh-chat-content-width, 100%) - 380px) * 10000000 + 1px), 1px)
  );
}
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
<!-- 编辑工具行:体量后缀是 TextShimmer 根 + summarySuffix,diff 统计再多一个 diffStat。 -->
<div data-tool="edit" data-state="ok">
  <div>
    <span id="kb-suffix" class="${tool.shimmerRoot} ${tool.suffix}">4KB</span>
    <span id="diff-stat" class="${tool.shimmerRoot} ${tool.suffix} ${tool.diffStat}">+12 -3</span>
  </div>
</div>
<!-- 开关轨道动画:上游只在 data-animating 上挂 grid-template-columns 过渡,插件必须关掉;
     没有该属性的帧不受影响(transition-property 保持初始的 all)。 -->
<div id="animating-frame" class="frame" data-animating></div>
<div id="static-frame" class="frame"></div>
<!-- 轮次导航轨道:slot 自带 container-type:inline-size,@container 读它的内容盒
     (600 − 32 − 32 = 536px < 900px),上游把 frame 隐藏,插件必须恢复成 block。
     第一份在 [data-conversation-scroll] 下(主选择器),第二份不在(父子兜底),
     第三份容器 1136px > 900px(上游本来就可见,插件不能误伤)。 -->
<div data-conversation-scroll style="position:relative;width:600px">
  <div class="${rail.hash}_slot"><nav id="rail-frame" class="${rail.hash}_frame"></nav></div>
</div>
<div style="position:relative;width:600px">
  <div class="${rail.hash}_slot"><nav id="rail-frame-bare" class="${rail.hash}_frame"></nav></div>
</div>
<div style="position:relative;width:1200px">
  <div class="${rail.hash}_slot"><nav id="rail-frame-wide" class="${rail.hash}_frame"></nav></div>
</div>
<!-- 正文限宽:100vw 由 Emulation 固定成 1600/800,内容盒宽度模拟滚动口 V;列照上游
     用 width:100% + max-width 取正文宽度,探针桩读同一组变量。 -->
<div data-slot="main.conversation">
  <div id="layout-content" data-conversation-content
    style="--dsh-conversation-viewport-width:1313px;width:1313px">
    <div id="layout-scroll" style="box-sizing:border-box;width:100%;padding:16px 32px">
      <div id="layout-column" style="width:100%;max-width:var(--dsh-chat-content-width);height:4px"></div>
    </div>
    <div id="layout-probe"></div>
  </div>
</div>
</body></html>`

  const dir = mkdtempSync(join(tmpdir(), 'dsh-cascade-fixture-'))
  const fixturePath = join(dir, 'index.html')
  writeFileSync(fixturePath, fixture)

  const chrome = await launchChrome(chromePath)
  try {
    await chrome.send('Page.enable')
    // 正文限宽用 100vw 计算:固定成 1600,让最大宽度可断言(1600 − 280 − 348 − 52 − 5 − 2 = 913)。
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
    const loaded = chrome.once('Page.loadEventFired')
    await chrome.send('Page.navigate', { url: pathToFileURL(fixturePath).href })
    await Promise.race([
      loaded,
      new Promise((_, reject) => setTimeout(() => reject(new Error('fixture 页面 10s 内未加载完成')), 10000)),
    ])

    const outcome = await chrome.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true })
    if (outcome.exceptionDetails) throw new Error(outcome.exceptionDetails.exception?.description ?? '页面测量脚本抛错')
    const { withPlugin, upstreamOnly } = outcome.result.value

    console.log(`fixture:${rules.hash}_markdown(来源 ${rules.file});${tool.suffix} / ${tool.diffStat}(来源 ${tool.toolFile});${rail.hash}_frame(来源 ${rail.railFile})`)
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
    // 工具行:上游给体量后缀与 diff 统计同一个 TextShimmer 根(inline-grid),插件只压后缀。
    check('上游单独作用:编辑工具行的 KB 体量后缀 = inline-grid', upstreamOnly.kbSuffix, 'inline-grid')
    check('上游单独作用:编辑工具行的 diff 统计 = inline-grid', upstreamOnly.diffStat, 'inline-grid')
    check('插件生效:编辑工具行的 KB 体量后缀 display:none', withPlugin.kbSuffix, 'none')
    check('插件生效:编辑工具行的 diff 统计仍然显示', withPlugin.diffStat, 'inline-grid')
    // 开关轨道动画:上游在 .frame[data-animating] 上挂 grid-template-columns 过渡(后写、特异性更高),
    // 插件用 !important 把帧自己的过渡关掉;没有 data-animating 的帧不受影响。
    check('上游单独作用:data-animating 帧的轨道过渡仍在', upstreamOnly.animatingTransition, 'grid-template-columns')
    check('插件生效:data-animating 帧不做轨道过渡', withPlugin.animatingTransition, 'none')
    check('插件生效:静止帧的过渡不被误伤', withPlugin.staticTransition, 'all')
    // 轮次导航轨道:窄容器里上游整条隐藏,插件必须常显;宽容器两边都显示。
    check('上游单独作用:536px 容器里的轨道隐藏', upstreamOnly.railFrame, 'none')
    check('上游单独作用:不在滚动口里的 536px 容器轨道隐藏', upstreamOnly.railFrameBare, 'none')
    check('上游单独作用:1136px 容器里的轨道显示', upstreamOnly.railFrameWide, 'block')
    check('插件生效:536px 容器里的轨道显示', withPlugin.railFrame, 'block')
    check('插件生效:不在滚动口里的轨道由父子兜底显示', withPlugin.railFrameBare, 'block')
    check('插件生效:1136px 容器里的轨道不受影响', withPlugin.railFrameWide, 'block')

    const layoutOutcome = await chrome.send('Runtime.evaluate', { expression: LAYOUT_MEASURE, returnByValue: true })
    if (layoutOutcome.exceptionDetails) throw new Error(layoutOutcome.exceptionDetails.exception?.description ?? '正文限宽测量脚本抛错')
    const layout = layoutOutcome.result.value
    // 参考态:左栏 280、右栏关闭、面板打开 —— 正文停在最大宽度,探针 1px。
    check('正文限宽:参考态(V=1313)正文 913px(100vw − 687)', layout.normal.column, 913)
    check('正文限宽:参考态探针 1px', layout.normal.probe, '1px')
    // 右栏占轨:正文压到 V − 104,reserve-room 归零、探针 0px。
    check('正文限宽:右栏占轨(V=593)正文 489px(V − 104)', layout.squeezed.column, 489)
    check('正文限宽:右栏占轨探针 0px', layout.squeezed.probe, '0px')
    // 左栏收起:正文停在最大宽度,不跟着变宽;探针仍 1px。
    check('正文限宽:左栏收起(V=1593)正文停在 913px', layout.sidebarClosed.column, 913)
    check('正文限宽:左栏收起探针仍 1px', layout.sidebarClosed.probe, '1px')

    // 窄视口:参考左栏取 0,最大宽度 = 800 − 407 = 393。
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 1000, deviceScaleFactor: 1, mobile: false })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const narrowOutcome = await chrome.send('Runtime.evaluate', { expression: LAYOUT_NARROW_MEASURE, returnByValue: true })
    if (narrowOutcome.exceptionDetails) throw new Error(narrowOutcome.exceptionDetails.exception?.description ?? '窄视口正文限宽测量脚本抛错')
    const narrow = narrowOutcome.result.value
    check('正文限宽:800px 视口(V=793)正文 393px(100vw − 407)', narrow.column, 393)
    check('正文限宽:800px 视口探针 1px', narrow.probe, '1px')
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

