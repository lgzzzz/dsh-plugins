/**
 * Offline smoke test for dsh-change-summary (no DSH service, no browser).
 *
 * Host half: imports lib/index.js, fakes a cordis ctx, simulates `write`/`edit`
 * `tools/result` events, and exercises the `/dsh-change-summary/diff` route.
 * Client half: evaluates lib/client.js in a VM with a stubbed module loader and
 * a mocked cordis ctx, then drives the registered change-summary Definition,
 * the turn-tail slot selector, and the chatFileMentions provider end-to-end.
 */
import { readFile } from 'node:fs/promises'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'

let failures = 0
function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`)
  } else {
    failures += 1
    console.error(`  ✗ ${message}`)
  }
}

/* ── host half ────────────────────────────────────────────────────────────── */
console.log('host half')
const { name: hostName, apply } = await import('../lib/index.js')
assert(hostName === 'dsh-change-summary', 'host exports name "dsh-change-summary"')
assert(typeof apply === 'function', 'host exports apply()')

const { absolutePath, normalizeLineEndings, pathExists, relativeTo } = await import('../lib/git.js')
assert(absolutePath('C:/proj', 'src/a.ts') === 'C:/proj/src/a.ts', 'absolutePath joins a relative path onto cwd')
assert(absolutePath('C:/proj', 'C:\\proj\\src\\b.ts') === 'C:/proj/src/b.ts', 'absolutePath keeps an absolute win path (forward-slashed)')
assert(relativeTo('C:/proj', 'C:/proj/src/a.ts') === 'src/a.ts', 'relativeTo computes the repo-relative path')
assert(relativeTo('C:/proj', 'D:/other/x.ts') === undefined, 'relativeTo rejects paths outside the repo')
assert(normalizeLineEndings('a\r\nb\rc') === 'a\nb\nc', 'normalizeLineEndings collapses CRLF and CR to LF')

const tmp = mkdtempSync(join(tmpdir(), 'dsh-verify-'))
try {
  writeFileSync(join(tmp, 'alive.txt'), 'x')
  assert(await pathExists(tmp, 'alive.txt') === true, 'pathExists true for an existing file')
  assert(await pathExists(tmp, 'gone.txt') === false, 'pathExists false for a deleted file')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const routes = []
const listeners = new Map()
const webServer = {
  register(registration) {
    routes.push(registration)
    return () => {}
  },
}
const sessions = {
  get() {
    return undefined
  },
}
const ctx = {
  on(event, fn) {
    listeners.set(event, fn)
    return () => listeners.delete(event)
  },
  effect(fn) {
    return fn()
  },
  get(key) {
    if (key === 'webServer') return webServer
    if (key === 'sessions') return sessions
    return undefined
  },
}
apply(ctx)
assert(listeners.has('session/event'), 'apply subscribed to session/event')
const diffRoute = routes.find((r) => r.path === '/dsh-change-summary/diff')
const existsRoute = routes.find((r) => r.path === '/dsh-change-summary/exists')
assert(diffRoute !== undefined && diffRoute.kind === 'exact', 'apply registered the diff route')
assert(existsRoute !== undefined && existsRoute.kind === 'exact', 'apply registered the exists route')

// The session/event listener is soft: non-user events and cwd-less sessions
// return without spawning git (the git branch is exercised manually).
const onSessionEvent = listeners.get('session/event')
onSessionEvent({ header: {} }, { type: 'turn/start', data: { turn: 1 } })
onSessionEvent({ header: {} }, { type: 'user/message', data: { source: { kind: 'plugin' }, content: [] } })
onSessionEvent({ header: {} }, { type: 'user/message', data: { source: { kind: 'user' }, content: [] } })
assert(true, 'session/event listener ignores non-user / cwd-less events without throwing')

async function request(route, query) {
  let captured = null
  const res = {
    writeHead(status, headers) {
      captured = { status, headers, body: null }
    },
    end(body) {
      captured.body = JSON.parse(body)
    },
  }
  await route.handler({ url: route.path + query }, res)
  return captured
}

let res = await request(diffRoute, '?session=sess-1&path=src%2Ffoo.txt')
assert(res.status === 200 && res.body.ok === false && res.body.git === false, 'diff route answers git:false when the session store has no cwd (non-git behavior)')
res = await request(diffRoute, '?path=src%2Ffoo.txt')
assert(res.status === 400 && res.body.ok === false, 'diff route 400s when session is missing')
res = await request(diffRoute, '?session=sess-1')
assert(res.status === 400 && res.body.ok === false, 'diff route 400s when path is missing')

res = await request(existsRoute, '?session=sess-1&path=a.ts&path=b.ts')
assert(res.status === 200 && res.body.ok === true && res.body.paths['a.ts'] === true && res.body.paths['b.ts'] === true,
  'exists route reports unknown (cwd-less) paths as existing so real files are never hidden')
res = await request(existsRoute, '?path=c.ts')
assert(res.status === 200 && res.body.ok === true && res.body.paths['c.ts'] === true,
  'exists route works without a session id (defaults to existing)')

/* ── client half ──────────────────────────────────────────────────────────── */
console.log('client half')

// 1) module registration + exports
const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
let registration = null
const required = new Map([
  ['react', { useState: () => [undefined, () => {}], useEffect: () => {} }],
  ['react/jsx-runtime', { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }],
  ['@deepseek-ai/dsh-client-runtime/client', {
    isAppendSurfaceEvent: () => true,
    resolveWorkspacePath: (_cwd, path) => path,
  }],
])
const sandbox = {
  window: { __ModuleLoader__: { load(reg) { registration = reg } } },
  console,
  document: {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  setTimeout,
  clearTimeout,
  URL,
  encodeURIComponent,
}
vm.createContext(sandbox)
vm.runInContext(bundle, sandbox)
assert(registration !== null && registration.id === 'dsh-change-summary', 'bundle registers via window.__ModuleLoader__.load')

const moduleRef = { exports: {} }
const clientExports = registration.factory((specifier) => {
  if (!required.has(specifier)) throw new Error(`unexpected require: ${specifier}`)
  return required.get(specifier)
})
assert(clientExports.name === 'dsh-change-summary', 'client exports name "dsh-change-summary"')
assert(Array.isArray(clientExports.inject) && clientExports.inject.includes('locale'), 'client exports inject (locale)')
assert(typeof clientExports.apply === 'function', 'client exports apply()')

// 2) drive apply() through a mocked cordis ctx and capture the registrations
let definition = null
const registeredSlots = new Map()
const provided = new Map()
const registeredLocales = new Map()
const boundLocale = () => (key, params) => `${key}:${params ? params.name ?? '' : ''}`
const clientCtx = {
  conversationEvents: {
    register(def) {
      definition = def
    },
  },
  effect(fn) {
    return fn()
  },
  locale: {
    register(ns, dicts) {
      registeredLocales.set(ns, dicts)
      return () => {}
    },
    bind() {
      return boundLocale()
    },
  },
  slots: {
    inject(key, cb) {
      registeredSlots.set(key, cb)
      return () => {}
    },
    register(spec) {
      return spec
    },
  },
  provide(key, value) {
    provided.set(key, value)
    return () => {}
  },
  get(key) {
    if (key === 'connection') return { isLoopback: true, hostDescription: { canOpenPath: true } }
    if (key === 'sessions') return undefined
    if (key === 'dsh-text-editor') return undefined
    return undefined
  },
}
clientExports.apply(clientCtx)
assert(definition !== null && definition.kind === 'change-summary', 'apply registered the change-summary definition')
assert(registeredLocales.has('change-summary') && registeredLocales.get('change-summary').zh['change.workspace'] === '工作区修改', 'apply registered the zh/en dictionaries')
assert(registeredSlots.has('conversation.chat.turnTail'), 'apply injected the turnTail slot')
assert(provided.has('chatFileMentions'), 'apply provided chatFileMentions')

// 3) drive the Definition through a synthetic turn
const startEvent = { type: 'turn/start', data: { turn: 7 } }
const startMatch = { ...definition.match(startEvent), event: startEvent, view: undefined, role: 'start', location: { kind: 'turn' } }
const state = definition.start({}, startMatch, {})
assert(typeof state.turn === 'number' && state.turn === 7, 'definition.start seeds the turn state')

const callEvent = { type: 'tool/call', data: { turn: 7, callId: 'c1', name: 'edit', arguments: '{}' } }
const callMatch = {
  event: callEvent,
  view: { for: 'call', view: { card: 'generic', kind: 'edit', locations: [{ path: 'a.ts' }, { path: 'b.ts' }] } },
  role: 'update',
  location: { kind: 'turn' },
}
const afterCall = definition.update({ state }, callMatch)
assert(afterCall.calls.get('c1').card === 'generic', 'definition.update records the call view')

const resultEvent = {
  type: 'tool/result',
  seq: 12,
  data: { turn: 7, message: { content: [{ type: 'tool-result', isError: false }], source: { callId: 'c1' } } },
}
const resultMatch = { event: resultEvent, view: undefined, role: 'update', location: { kind: 'turn' } }
const afterResult = definition.update({ state: afterCall }, resultMatch)
assert(afterResult.produced.length === 2 && afterResult.produced[0].path === 'a.ts', 'definition.update accumulates produced paths from the call view')

const locationData = definition.buildLocationData({ state: afterResult }, 'turn')
assert(locationData !== null && locationData.key === 'change-summary' && locationData.value.produced.length === 2, 'buildLocationData publishes the turn data under key change-summary')

// 4) the turn-tail selector + prose mentions
const slotSpec = registeredSlots.get('conversation.chat.turnTail')()
assert(typeof slotSpec.select === 'function' && slotSpec.locale === 'change-summary', 'turnTail slot spec carries select + locale')
const owner = {
  turn: { data: { get: () => locationData.value } },
  seq: 12,
  openFile: (path) => `open:${path}`,
}
const matched = slotSpec.select(owner)
assert(Array.isArray(matched) && matched.includes('a.ts') && matched.includes('b.ts'), 'select returns the produced paths')

const mentions = provided.get('chatFileMentions').forClosing(owner)
assert(typeof mentions.resolve === 'function', 'chatFileMentions.forClosing returns a resolver')
const mention = mentions.resolve('a.ts')
assert(mention !== undefined && mention.title === 'a.ts' && mention.label.startsWith('change.open:'), 'mention resolves an exact path with label + title')

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
