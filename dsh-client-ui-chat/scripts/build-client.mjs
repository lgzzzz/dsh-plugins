/** 构建浏览器半部（产物 lib/client.js）。
 *
 * esbuild 把 src/client/index.ts 连同 src/ 下全部模块与 18 份 CSS Modules 打成一个 CJS 文件，
 * 再包进 `window.__ModuleLoader__.load({ id, factory })`（与上游 tsdown 产物同形：工厂返回
 * module.exports，宿主的模块表按 id 解析 `require`）。
 *
 * 两点与上游 tsdown 预置对齐：
 * 1. **外部依赖**：只有模块表基线（PLATFORM_MODULES：react / react-dom / cordis /
 *    client-store / ui-slots / ui-primitives / ui-dockkit）保持 `require`，其余全部内联。
 *    上游 `packages/client/tsdown.client.ts` 的 externals 与它一致（内置 ui-chat 的
 *    lib/client.js 里也只 require 这 5 个名字）。构建末尾的闸门会复核这一点。
 * 2. **样式**：上游用 lightningcss 编译 CSS Modules 并在工厂执行时插入
 *    `style[data-plugin][data-plugin-css]`；这里用 esbuild 的 local-css 等价实现，
 *    标签属性保持一致，`dsh-client-modules` 的 removeOwnedStyles 才能按 data-plugin 回收。
 *
 * lib/client.js 是产物，禁止手改；入仓以便离线加载（与仓库内其它插件一致）。
 * 需要浏览器里可读的 sourcemap 时：`DSH_CHAT_SOURCEMAP=1 npm run build`（额外产出 lib/client.js.map）。
 */
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'lib')
const outFile = join(outDir, 'client.js')

/** 插件包名：同时是 __ModuleLoader__ 的注册 id 与浏览器图行 id。 */
const loaderId = '@deepseek-ai/dsh-client-ui-chat'

/** 模块表基线，镜像 packages/client/web/src/platform.ts 的 PLATFORM_MODULES。 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const environment = process.env.NODE_ENV ?? 'production'

const result = await build({
  entryPoints: { client: join(root, 'src', 'client', 'index.ts') },
  outdir: outDir,
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'cjs',
  target: 'es2024',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  loader: { '.css': 'local-css' },
  sourcemap: process.env.DSH_CHAT_SOURCEMAP === '1' ? 'linked' : false,
  logLevel: 'warning',
  // 与上游 tsdown 预置相同的浏览器环境替换：内联进来的第三方实现会读这两个键。
  define: {
    'process.env.NODE_ENV': JSON.stringify(environment),
    'import.meta.env.MODE': JSON.stringify(environment),
    'import.meta.env': JSON.stringify({ MODE: environment }),
  },
})

const output = (extension) => result.outputFiles.find(file => file.path.endsWith(extension) && !file.path.endsWith('.map'))
const compiled = output('.js')
if (compiled === undefined) throw new Error('build-client: esbuild 未产出 client.js')

const staticRequires = [...compiled.text.matchAll(/\brequire\(\s*"([^"]+)"\s*\)/g)].map(match => match[1])
const unexpected = [...new Set(staticRequires)].filter(specifier => !PLATFORM_MODULES.includes(specifier))
if (unexpected.length > 0) {
  throw new Error(
    `build-client: 产物要求了模块表之外的模块 ${unexpected.join(', ')}；`
    + '跨插件取值只允许 type-only import 或 cordis 服务，其余第三方实现会被内联',
  )
}
if (/\bimport\(/.test(compiled.text)) {
  throw new Error('build-client: 产物含动态 import()；模块表不支持相对 chunk，需保持单文件')
}

// 工厂执行时插入样式表：data-plugin 供 client-hmr 的重建回收，data-plugin-css 保证同一文档重复执行只插一次。
const css = output('.css')
const styleInjection = css === undefined ? '' : `(function () {
  var tagId = ${JSON.stringify(`${loaderId}/client.css`)};
  if (typeof document === 'undefined' || document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return;
  var tag = document.createElement('style');
  tag.dataset.plugin = ${JSON.stringify(loaderId)};
  tag.dataset.pluginCss = tagId;
  tag.textContent = ${JSON.stringify(css.text)};
  document.head.appendChild(tag);
})();`

const wrapped = [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(loaderId)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  styleInjection,
  compiled.text,
  'return module.exports; } });',
  '',
].join('\n')

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, wrapped)
const map = result.outputFiles.find(file => file.path.endsWith('.js.map'))
if (map !== undefined) writeFileSync(join(outDir, 'client.js.map'), map.text)

console.log(
  `built ${outFile}（esbuild 打包，${wrapped.length} 字节`
  + `${css === undefined ? '' : `，内联 CSS ${css.text.length} 字节`}`
  + `${map === undefined ? '' : '，含 sourcemap'}）`,
)
