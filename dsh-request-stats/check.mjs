/**
 * Offline checks for `dsh-request-stats`: manifest, exported resources, syntax
 * of the built modules, and the client registration shape.
 *
 * Run from the package directory after `pnpm build`: `node check.mjs`. Nothing
 * here touches the network, the profile, or the running Host.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const failures = []
const notes = []

function fail(message) {
  failures.push(message)
}

function ok(message) {
  notes.push(message)
}

function readJson(relative) {
  const file = path.join(root, relative)
  if (!existsSync(file)) {
    fail(`missing ${relative}`)
    return undefined
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`invalid JSON in ${relative}: ${error.message}`)
    return undefined
  }
}

function requireFile(relative) {
  const file = path.join(root, relative)
  if (!existsSync(file)) {
    fail(`missing ${relative}`)
    return false
  }
  return true
}

// ---------------------------------------------------------------- manifest

const manifest = readJson('package.json')
if (manifest !== undefined) {
  if (manifest.type !== 'module') fail('package.json "type" must be "module"')
  if (manifest.dsh?.bundle?.patch === undefined) fail('package.json must declare dsh.bundle.patch')
  else if (!requireFile(manifest.dsh.bundle.patch)) fail('dsh.bundle.patch points at a missing file')
  if (manifest.dsh?.client?.platform !== 'web') fail('package.json must declare dsh.client.platform = web')
  if (manifest.exports?.['.'] === undefined) fail('package.json must export the Host entry')
  if (manifest.exports?.['./client'] === undefined) fail('package.json must export ./client')

  // Both halves are built: the exports must name the .js artifacts (add-plugins
  // rebuilds a linked plugin exactly when an exported .js target is missing).
  for (const key of ['.', './client']) {
    const entry = manifest.exports?.[key]
    const target = typeof entry === 'string' ? entry : entry?.default
    if (typeof target !== 'string' || !target.endsWith('.js')) fail(`export "${key}" must name a built .js file`)
  }

  const exported = new Set()
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    const target = typeof value === 'string' ? value : value?.default
    if (typeof target !== 'string') continue
    exported.add(target)
    if (target.includes('*')) {
      const directory = path.join(root, path.dirname(target))
      if (!existsSync(directory)) fail(`export "${key}" points at a missing directory`)
      continue
    }
    if (!existsSync(path.join(root, target))) fail(`export "${key}" points at missing ${target}`)
  }
  for (const entry of manifest.files ?? []) {
    if (entry.includes('*')) continue
    if (!existsSync(path.join(root, entry))) fail(`files entry "${entry}" does not exist`)
  }
  if (!(manifest.files ?? []).some(entry => entry === 'lib' || entry.startsWith('lib/'))) fail('files must ship the lib/ build output')
  if (manifest.scripts?.build !== 'tsdown') fail('package.json must build with tsdown')
  if (manifest.scripts?.typecheck !== 'tsc --noEmit') fail('package.json must typecheck with tsc --noEmit')
  ok(`manifest: ${manifest.name}@${manifest.version}, ${exported.size} exported resources`)
}

// ----------------------------------------------------------------- patch

if (requireFile('cordis.patch.yml')) {
  const patch = readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  if (!patch.includes('name: dsh-request-stats')) fail('cordis.patch.yml must insert the dsh-request-stats row')
  else ok('patch: inserts the bundle row')
}

// ---------------------------------------------------------------- locales

for (const locale of ['zh', 'en']) {
  const data = readJson(`locale/${locale}.json`)
  if (data === undefined) continue
  if (typeof data.meta?.title !== 'string' || data.meta.title.length === 0) fail(`locale/${locale}.json meta.title is empty`)
  if (typeof data.meta?.description !== 'string' || data.meta.description.length < 20) fail(`locale/${locale}.json meta.description is too short`)
  if (data.meta?.detail !== undefined && !existsSync(path.join(root, data.meta.detail))) fail(`locale/${locale}.json meta.detail points at a missing file`)
  ok(`locale/${locale}.json: ${data.meta?.title}`)
}

// ------------------------------------------------------------------- icon

if (requireFile('icon.svg')) {
  const file = path.join(root, 'icon.svg')
  const text = readFileSync(file, 'utf8')
  if (!text.trimStart().startsWith('<svg')) fail('icon.svg does not start with an <svg> element')
  if (text.includes('<script') || text.includes('<foreignObject') || text.includes('<style')) fail('icon.svg must be self-contained geometry')
  const bytes = statSync(file).size
  if (bytes > 256 * 1024) fail(`icon.svg is ${bytes} bytes, above the 256 KiB limit`)
  else ok(`icon.svg: ${bytes} bytes`)
}

// ----------------------------------------------------------------- build

for (const artifact of ['lib/index.js', 'lib/client.js']) {
  if (!requireFile(artifact)) fail(`${artifact} is missing; run \`pnpm build\` first`)
}
if (requireFile('src/index.ts') && requireFile('src/client/index.ts')) ok('sources: src/index.ts + src/client/index.ts')
else fail('the Host entry src/index.ts and the client entry src/client/index.ts must exist')

// ---------------------------------------------------------------- syntax

const runtime = ['lib/index.js', 'lib/client.js', 'check.mjs', 'test/run.mjs', 'test/client-render.mjs']
for (const relative of runtime) {
  if (!requireFile(relative)) continue
  try {
    execFileSync(process.execPath, ['--check', path.join(root, relative)], { stdio: 'pipe' })
  } catch (error) {
    const message = String(error.stderr ?? error.message).trim().split('\n').slice(0, 4).join('\n')
    fail(`syntax in ${relative}:\n${message}`)
  }
}
ok(`${runtime.length} modules parse`)

// ---------------------------------------------------------------- client

if (requireFile('lib/client.js')) {
  const client = readFileSync(path.join(root, 'lib/client.js'), 'utf8')
  const requires = name => new RegExp(`["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(client)
  if (!client.includes('window.__ModuleLoader__.load(')) fail('lib/client.js must register through window.__ModuleLoader__.load')
  if (!requires('dsh-request-stats')) fail('the client module id must equal the package name')
  if (!requires('sidebar.panellist')) fail('lib/client.js must register the sidebar entry')
  if (!requires('main')) fail('lib/client.js must register the main panel')
  if (!requires('dsh-request-stats.open-board')) fail('lib/client.js must register the dashboard shortcut')
  if (!requires('KeyH')) fail('lib/client.js must bind the dashboard shortcut to H')
  if (!client.includes('panelInfo')) fail('lib/client.js must read the active panel to toggle the dashboard')
  if (!/inject\s*=\s*\[[^\]]*["']slots["']/.test(client)) notes.push('note: client inject list differs from slots+locale')
  if (/require\(\s*["']@deepseek-ai\//.test(client)) fail('lib/client.js must not require a Harness Client package')
  const tokens = client.match(/--dsw-alias-[a-z0-9-]+/g) ?? []
  ok(`client: ${new Set(tokens).size} theme tokens, no Harness Client imports`)
}

// ---------------------------------------------------------------- report

for (const note of notes) console.log(`  ${note}`)
if (failures.length > 0) {
  console.error('\nFAILED')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nOK')
}
