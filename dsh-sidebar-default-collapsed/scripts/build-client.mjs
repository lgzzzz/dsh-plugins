/** 构建浏览器半部(产物 lib/client.js):esbuild 平台二进制把 src/client.ts 打包为单文件 CJS,
 * 包进 window.__ModuleLoader__.load({ id, factory }) 写回(全部内联,不消费 external)。
 * 用平台二进制而非 esbuild JS API:JS API 经 stdin/stdout 管道 spawn,受限沙箱下 EPERM。
 * ModuleLoader 不支持相对 require ⇒ 多文件源码须合并单文件;lib/client.js 为产物禁止手改,入仓供离线加载。 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const loaderId = 'dsh-sidebar-default-collapsed'
const libDir = join(root, 'lib')
const outFile = join(libDir, 'client.js')
const tmpFile = join(libDir, '.client.cjs')

// esbuild 平台二进制 = 可选依赖 @esbuild/<platform>-<arch>。
function resolveEsbuildBin() {
  const require = createRequire(import.meta.url)
  const pkg = `@esbuild/${process.platform}-${process.arch}`
  let dir
  try {
    dir = dirname(require.resolve(`${pkg}/package.json`))
  } catch {
    throw new Error(`找不到 ${pkg}:先在插件目录执行 npm install(或把 esbuild 装在可解析位置)`)
  }
  const bin = join(dir, process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild')
  if (!existsSync(bin)) throw new Error(`找不到 esbuild 二进制:${bin}`)
  return bin
}

mkdirSync(libDir, { recursive: true })

const run = spawnSync(
  resolveEsbuildBin(),
  [
    join(root, 'src', 'client.ts'),
    '--bundle',
    '--platform=browser',
    '--format=cjs',
    '--target=es2019',
    // esbuild 默认把「Done in Xms」写到 stderr,会污染 PowerShell 观感
    '--log-level=warning',
    `--outfile=${tmpFile}`,
  ],
  { stdio: 'inherit', cwd: root },
)
if (run.error !== undefined) throw run.error
if (run.status !== 0) {
  rmSync(tmpFile, { force: true })
  process.exit(run.status ?? 1)
}

const compiled = readFileSync(tmpFile, 'utf8')
const wrapped =
  'window.__ModuleLoader__.load({ id: ' + JSON.stringify(loaderId) + ", factory: (require) => {\n" +
  'var module = { exports: {} }; var exports = module.exports;\n' +
  compiled +
  'return module.exports; } });\n'

writeFileSync(outFile, wrapped)
rmSync(tmpFile, { force: true })
console.log(`built ${outFile}(esbuild 打包,${compiled.length} 字节)`)
