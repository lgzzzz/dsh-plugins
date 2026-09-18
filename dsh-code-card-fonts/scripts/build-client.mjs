/** 构建浏览器半部(产物 lib/client.js):esbuild 把 src/client.ts 打包为单文件 CJS,
 * 包进 window.__ModuleLoader__.load({ id, factory }) 写回(全部内联,不消费 external)。
 * 浏览器不跑 Node Type Stripping,ModuleLoader 只按模块 id 解析 require、不支持相对路径
 * ⇒ 多文件源码须合并为单文件;lib/client.js 为产物禁止手改,入仓以便离线加载。 */
import { buildSync } from 'esbuild'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const loaderId = 'dsh-code-card-fonts'
const outFile = join(root, 'lib', 'client.js')

const result = buildSync({
  entryPoints: [join(root, 'src', 'client.ts')],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2019',
  write: false,
})
const compiled = result.outputFiles[0].text
const wrapped =
  'window.__ModuleLoader__.load({ id: ' + JSON.stringify(loaderId) + ", factory: (require) => {\n" +
  'var module = { exports: {} }; var exports = module.exports;\n' +
  compiled +
  'return module.exports; } });\n'

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(outFile, wrapped)
console.log(`built ${outFile}(esbuild 打包,${compiled.length} 字节)`)
