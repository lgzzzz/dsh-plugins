/**
 * 构建浏览器半部（产物：lib/client.js —— 单文件自包含 bundle）。
 *
 * 步骤（与 dsh-text-editor / dsh-kbd-hotkeys 同一套约定）：
 * 1) esbuild 把 src/client.ts 连同其相对 import 的模块打包成单文件（bundle: true）；
 *    仅 react 声明为 external —— 由 DSH ModuleLoader 的模块表提供
 *    （package.json 的 dsh.client.external 必须与这里一致）。
 * 2) 把产物包进 window.__ModuleLoader__.load({ id, factory }) 写回 lib/client.js。
 *
 * 不使用 JSX：DSH 模块表按 id 解析 require，`react/jsx-runtime` 未必注册，
 * 因此源码统一走 React.createElement。
 */
import { buildSync } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const loaderId = 'dsh-left-dock'
const outDir = join(root, 'lib')
const outFile = join(outDir, 'client.js')

const result = buildSync({
  entryPoints: [join(root, 'src', 'client.ts')],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2019',
  external: ['react'],
  write: false,
})
const compiled = result.outputFiles[0].text
const wrapped =
  'window.__ModuleLoader__.load({ id: ' + JSON.stringify(loaderId) + ", factory: (require) => {\n" +
  'var module = { exports: {} }; var exports = module.exports;\n' +
  compiled +
  'return module.exports; } });\n'

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, wrapped)
console.log(`built ${outFile}（esbuild 打包，${compiled.length} 字节）`)
