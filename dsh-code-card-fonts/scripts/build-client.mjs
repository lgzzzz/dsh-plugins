/**
 * 构建浏览器半部(产物:lib/client.js)。
 *
 * 步骤:1) esbuild 把 src/client.ts 连同相对导入(src/css.ts)打包为单文件
 * (bundle,全部内联,本插件不消费 external);2) 包进
 * window.__ModuleLoader__.load({ id, factory }) 写回 lib/client.js。
 *
 * 注意事项:浏览器不跑 Node Type Stripping,且 ModuleLoader 只按模块 id 解析
 * require、不支持相对路径——拆多文件的源码必须合并为单文件产物。lib/client.js
 * 为生成产物、禁止手改,入仓以便离线加载。
 */
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
