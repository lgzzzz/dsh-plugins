/**
 * 构建浏览器半部(产物:lib/client.js)。
 *
 * 步骤:
 *   1) 用 esbuild 把 src/client.ts 连同相对导入(src/css.ts)打包为单文件 CJS
 *      (bundle,全部内联,本插件不消费 external),先落到 lib/.client.cjs;
 *   2) 读出该文件,包进 window.__ModuleLoader__.load({ id, factory }) 写回
 *      lib/client.js,再删除中间文件。
 *
 * 为什么调 esbuild 的平台二进制而不 import 'esbuild' 的 buildSync:
 * esbuild 的 JS API 通过 stdin/stdout 管道与子进程通信(stdio: 'pipe'),在受限
 * 沙箱下 spawn 会被拒(EPERM);直接执行二进制并把 stdio 继承给父进程不受影响。
 * 同组 flag 下两种入口产出的 bundle 一致(CLI 只是把同一份 build 请求发给二进制)。
 *
 * 注意事项:浏览器不跑 Node Type Stripping,且 ModuleLoader 只按模块 id 解析
 * require、不支持相对路径——拆多文件的源码必须合并为单文件产物。lib/client.js
 * 为生成产物、禁止手改,入仓以便离线加载。
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const loaderId = 'dsh-rightbar-tab-width'
const libDir = join(root, 'lib')
const outFile = join(libDir, 'client.js')
const tmpFile = join(libDir, '.client.cjs')

/** 定位 esbuild 的平台二进制(esbuild 的可选依赖 @esbuild/<platform>-<arch>)。 */
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
    // esbuild 默认把「Done in Xms」写到 stderr,会污染 PowerShell 的 NativeCommandError 观感
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
