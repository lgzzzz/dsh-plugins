/**
 * 构建浏览器半部 → lib/client.js:esbuild 打包 src/client.ts 为单文件 CJS 并包进 ModuleLoader.load({ id, factory })。
 * 浏览器无 Type Stripping,ModuleLoader 只按模块 id 解析 require(不支持相对路径),故必须合并单文件;禁止手改、入仓。
 * react 设为 external:它是上游 ModuleLoader 的平台 seed 词(staticModules 含 react / react/jsx-runtime),
 * 由工厂的 require 提供宿主同一份实例;其余全部内联。
 * 用 esbuild 平台二进制(@esbuild/<platform>-<arch>):JS API 走 stdio 管道,受限沙箱 spawn 报 EPERM。 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const loaderId = 'dsh-desktop-notify'
const libDir = join(root, 'lib')
const outFile = join(libDir, 'client.js')
const tmpFile = join(libDir, '.client.cjs')

/** 定位 esbuild 平台二进制(可选依赖 @esbuild/<platform>-<arch>)。 */
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
    '--external:react',
    // 压掉 esbuild 默认写到 stderr 的「Done in Xms」(会污染 PowerShell 的 NativeCommandError 观感)
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
