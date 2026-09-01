/**
 * Set up links for DSH client packages whose types are needed at compile time
 * but are provided by the DSH harness at runtime (not available on npm).
 *
 * The harness ships its bundled `@deepseek-ai` scope inside the global
 * `@deepseek-ai/dsh` install's `node_modules`. We locate that install WITHOUT
 * spawning `npm` (so it works under sandboxes that forbid capturing another
 * program's piped stdio): npm sets `npm_config_prefix` during install
 * lifecycle scripts, and we add runtime-derived fallback roots (APPDATA,
 * the running node binary's install prefix, HOME) — no hard-coded paths.
 *
 * On Windows we use directory junctions (no elevation required); elsewhere
 * symlinks. Idempotent: an existing link is left in place.
 *
 * Called by the `postinstall` lifecycle so the links survive `npm install`.
 */
import { symlinkSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(new URL('..', import.meta.url))
const DEST = join(SELF, 'node_modules', '@deepseek-ai')

const CLIENT_PACKAGES = [
  'dsh-client-ui-chat',
  'dsh-client-ui-conversation',
]

/**
 * Resolve the bundled `@deepseek-ai` scope shipped inside the global
 * `@deepseek-ai/dsh` install. Tries `npm_config_prefix` (set by npm during
 * install lifecycle scripts) first, then runtime-derived roots (APPDATA,
 * the running node binary's install prefix, HOME).
 * @returns {string | null} absolute path to the bundled scope, or null.
 */
function resolveHarnessScope() {
  const candidates = []
  const prefix = process.env.npm_config_prefix
  if (prefix) {
    // Windows: global root is <prefix>/node_modules; Unix: <prefix>/lib/node_modules
    candidates.push(
      process.platform === 'win32'
        ? join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai')
        : join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
    )
  }
  const appdata = process.env.APPDATA || ''
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (appdata) candidates.push(join(appdata, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
  // Unix 全局安装位于 <node 前缀>/lib/node_modules。从正在运行的 node 二进制
  // 推导前缀，而非硬编码 /opt/homebrew、/usr/local 等根：brew、/usr/bin、
  // /usr/local 与 nvm 布局（~/.nvm/versions/node/<v>/lib/node_modules）统一覆盖。
  candidates.push(join(dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
  if (home) candidates.push(join(home, '.npm-global', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

const HARNESS_ROOT = resolveHarnessScope()
if (HARNESS_ROOT === null) {
  console.warn('[dsh-change-summary] DSH harness (@deepseek-ai/dsh) not found via npm_config_prefix or fallback roots — skipping type symlinks. The build will fail to resolve @deepseek-ai/dsh-client-ui-* types.')
  process.exit(0)
}

mkdirSync(DEST, { recursive: true })

// Directory junctions on Windows need no elevation; symlinks elsewhere.
const linkType = process.platform === 'win32' ? 'junction' : 'dir'

for (const pkg of CLIENT_PACKAGES) {
  const src = join(HARNESS_ROOT, pkg)
  const dst = join(DEST, pkg)
  if (!existsSync(src)) {
    console.warn(`[dsh-change-summary] package ${pkg} not found in harness at ${HARNESS_ROOT} — skipping`)
    continue
  }
  try {
    symlinkSync(src, dst, linkType)
    console.log(`[dsh-change-summary] linked ${pkg} -> ${src}`)
  } catch (err) {
    if (err.code === 'EEXIST') {
      console.log(`[dsh-change-summary] ${pkg} already linked`)
    } else {
      throw err
    }
  }
}
