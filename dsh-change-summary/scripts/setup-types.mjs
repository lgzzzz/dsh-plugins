/**
 * Set up symlinks for DSH client packages whose types are needed at compile time
 * but are provided by the DSH harness at runtime (not available on npm).
 *
 * Called by the `postinstall` lifecycle so the links survive `pnpm install`.
 */
import { symlinkSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HARNESS_ROOT = '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const SELF = fileURLToPath(new URL('..', import.meta.url))
const DEST = join(SELF, 'node_modules', '@deepseek-ai')

const CLIENT_PACKAGES = [
  'dsh-client-ui-chat',
  'dsh-client-ui-conversation',
]

if (!existsSync(HARNESS_ROOT)) {
  console.warn(`[dsh-change-summary] DSH harness not found at ${HARNESS_ROOT} – skipping type symlinks`)
  process.exit(0)
}

mkdirSync(DEST, { recursive: true })

for (const pkg of CLIENT_PACKAGES) {
  const src = join(HARNESS_ROOT, pkg)
  const dst = join(DEST, pkg)
  if (!existsSync(src)) {
    console.warn(`[dsh-change-summary] package ${pkg} not found in harness – skipping`)
    continue
  }
  try {
    symlinkSync(src, dst, 'dir')
    console.log(`[dsh-change-summary] linked ${pkg}`)
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Already exists; skip.
    } else {
      throw err
    }
  }
}