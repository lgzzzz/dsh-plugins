/**
 * Offline checks for `dsh-request-stats`: manifest, exported resources,
 * syntax of every runtime module, and the client registration shape.
 *
 * Run from the package directory: `node check.mjs`. Nothing here touches the
 * network, the profile, or the running Host.
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
  if (!(manifest.files ?? []).some(entry => entry.startsWith('server'))) fail('files must ship the server/ directory')
  ok(`manifest: ${manifest.name}@${manifest.version}, ${manifest.exports && Object.keys(manifest.exports).length} exports`)
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

// ---------------------------------------------------------------- syntax

const runtime = ['index.js', 'client.js', 'check.mjs', 'test/run.mjs', 'test/client-render.mjs', 'server/collect.js', 'server/records.js', 'server/routes.js', 'server/summary.js']
for (const relative of runtime) {
  if (!requireFile(relative)) continue
  try {
    execFileSync(process.execPath, ['--check', path.join(root, relative)], { stdio: 'pipe' })
  } catch (error) {
    const message = String(error.stderr ?? error.message).trim().split('\n').slice(0, 4).join('\n')
    fail(`syntax in ${relative}:\n${message}`)
  }
}
ok(`${runtime.length} runtime modules parse`)

// ---------------------------------------------------------------- client

if (requireFile('client.js')) {
  const client = readFileSync(path.join(root, 'client.js'), 'utf8')
  if (!client.includes('window.__ModuleLoader__.load(')) fail('client.js must register through window.__ModuleLoader__.load')
  if (!client.includes("id: 'dsh-request-stats'")) fail('client.js factory id must equal the package name')
  if (!client.includes("name: 'sidebar.panellist'")) fail('client.js must register the sidebar entry')
  if (!client.includes("name: 'main'")) fail('client.js must register the main panel')
  if (!client.includes("inject: ['slots', 'locale']")) notes.push('note: client inject list differs from slots+locale')
  if (/require\('@deepseek-ai\//.test(client)) fail('client.js must not require a Harness Client package')
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
