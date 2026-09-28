import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'lib')
const outFile = join(outDir, 'client.js')

/** 插件包名：同时是 __ModuleLoader__ 的注册 id 与浏览器图行 id。 */
const loaderId = 'dsh-client-ui-chat-lgzzzz'

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
