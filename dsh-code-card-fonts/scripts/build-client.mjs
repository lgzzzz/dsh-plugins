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
