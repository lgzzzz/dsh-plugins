/**
 * Shared tsdown preset for dsh-plugins plugin bundles.
 *
 * Adapted from deepseek-harness `packages/client/tsdown.client.ts` for this
 * standalone workspace (no monorepo two-level `packages` layout, no `tsc -b`
 * build-face pipeline). It reproduces the same artifact contract as the upstream tsdown
 * preset and the previous esbuild `scripts/build*.mjs`:
 *
 *   - the browser half is a CJS factory wrapped in
 *     `window.__ModuleLoader__.load({ id, factory })`;
 *   - platform module-table seeds (react / cordis / dsh-client-* shell seeds)
 *     stay external and resolve through the shell at runtime, everything else
 *     inlines;
 *   - a value import of an `@deepseek-ai` package that is neither a requested
 *     module-table row nor an inline-safe wire layer / vendored library /
 *     generated /remote contribution fails the build (upstream purity gate);
 *   - `*.module.css` compiles through lightningcss into a hashed class map +
 *     a runtime `<style>` injector, and global `*.css` is injected too;
 *   - the node (host) half is a plain ESM library bundle that keeps production
 *     dependencies external.
 *
 * Kept as plain `.mjs` (not `.ts`) so tsdown's config loader never has to run
 * Node's native TypeScript stripping on it (known Node bug with complex types).
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'

/** Virtual-id suffix keeps module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0dsh-global-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Module-table seeds the DSH web shell shares. Mirrors deepseek-harness
 * `PLATFORM_MODULES` (`packages/client/web/src/platform.ts`).
 */
const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * Upstream INLINE_SAFE: contract layers and pure folds with no runtime identity
 * to share (no Symbol/instanceof/singleton state) — safe to inline.
 */
const INLINE_SAFE = /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|output-retention|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-native-command\/types$|@deepseek-ai\/dsh-host-open-in-app\/shared$|@deepseek-ai\/dsh-plugin-manager\/registry$|@deepseek-ai\/dsh-agent-preset-registry\/display$|@deepseek-ai\/dsh-api-workspace-controller\/default-workspace$|@deepseek-ai\/dsh-spill-policy\/notice$)/

/** Upstream VENDORED_LIBRARY: rescoped framework libraries a browser bundle inlines. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/** Upstream GENERATED_REMOTE: generated descriptor/codec contribution. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/** Whether a specifier equals a seed or a subpath of it. */
function matchesAny(specifier, seeds) {
  return seeds.some(seed => specifier === seed || specifier.startsWith(`${seed}/`))
}

/** Read the package manifest for the package in the current working directory. */
function readManifest() {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
}

/** Production dependency names: the sections a real install materializes on disk. */
function productionExternals() {
  const manifest = readManifest()
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]
}

/** `dsh.client.external` — module-table rows a package requests beyond the baseline. */
function requestedClientExternals() {
  const value = readManifest().dsh?.client?.external
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('dsh.client.external must be a string array')
  }
  return value
}

/** Emit one plugin-owned style injector and an optional CSS Modules export. */
function styleInjectionModule(id, fileId, css, classMap) {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/** Compile `x.module.css` into a hashed class map + runtime style injector. */
function cssModulesInlinePlugin(id) {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? resolve(dirname(importer), source) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      return styleInjectionModule(id, fileId, code.toString(), classMap)
    },
  }
}

/** Inject a global `x.css` (non-module) stylesheet at factory execution. */
function cssGlobalInlinePlugin(id) {
  return {
    name: 'dsh-css-global-inline',
    resolveId(source, importer) {
      if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? resolve(dirname(importer), source) : source
      return GLOBAL_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId) {
      if (!virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code } = transform({ filename: fileId, code: source, minify: true })
      return styleInjectionModule(id, fileId, code.toString())
    },
  }
}

/**
 * Build-time mirror of the module-edge rules: an inlined `@deepseek-ai` value
 * import must be identity-free (a wire layer, vendored library, or generated
 * /remote contribution); anything else must be a requested module-table row
 * (external) — otherwise the build fails. Cross-plugin collaboration goes
 * through cordis services, never a second inlined copy.
 */
function purityGatePlugin(id, isRequested) {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (isRequested(source)) return null // requested module-table row: external wins
      if (VENDORED_LIBRARY.test(source)) return null // vendored library: inline, no shared identity
      if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // wire contribution: inline is the point
      throw new Error(
        `client bundle purity: "${source}" is not in the platform externals or ${id}'s dsh.client.external, an inline-safe wire layer, or a generated /remote contribution — `
        + 'cross-plugin value imports are forbidden; declare a module request or collaborate through cordis services '
        + '(type-only imports are erased and never reach this gate)',
      )
    },
  }
}

/** Public client environment folded into the browser artifact. */
function clientBuildEnvironmentDefines(environment) {
  const defines = { 'process.env': '{}' }
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && name.startsWith('DSH_CLIENT_')) {
      defines[`process.env.${name}`] = JSON.stringify(value)
    }
  }
  return defines
}

/**
 * Build the browser (client) half: `lib/client.js` as a `__ModuleLoader__`
 * CJS factory. Platform seeds stay external; everything else is bundled.
 */
export function clientBundle(id, options = {}) {
  const entry = options.entry ?? 'src/client.ts'
  const seeds = [...PLATFORM_EXTERNALS, ...requestedClientExternals(), ...(options.externals ?? [])]
  const isRequested = specifier => matchesAny(specifier, seeds)
  const nodeEnv = process.env.NODE_ENV ?? 'production'
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: isRequested,
      alwaysBundle: specifier => !isBuiltin(specifier) && !isRequested(specifier),
    },
    inputOptions: {
      resolve: { conditionNames: ['browser', 'import', 'module', 'default'] },
    },
    define: {
      ...clientBuildEnvironmentDefines(process.env),
      'process.env.NODE_ENV': JSON.stringify(nodeEnv),
      'import.meta.env.MODE': JSON.stringify(nodeEnv),
      'import.meta.env': JSON.stringify({ MODE: nodeEnv }),
    },
    plugins: [purityGatePlugin(id, isRequested), cssModulesInlinePlugin(id), cssGlobalInlinePlugin(id)],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: chunk =>
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/**
 * Build the node (host) half: an ESM library bundle from `src/` into `lib/`.
 * Production dependencies stay external; everything else is bundled.
 */
export function nodeBundle(entry, options = {}) {
  const entries = Array.isArray(entry) ? entry : [entry]
  const seeds = [...productionExternals(), ...(options.externals ?? [])]
  const isExternal = specifier => matchesAny(specifier, seeds)
  return {
    name: 'node',
    entry: entries,
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: false,
    deps: {
      neverBundle: isExternal,
      alwaysBundle: specifier => !isBuiltin(specifier) && !isExternal(specifier),
    },
  }
}

/**
 * Build both halves of a full plugin package (node library + browser bundle).
 * @returns an array of tsdown configs run in one invocation; `clean` stays off
 * so the two halves write into `lib/` without wiping each other.
 */
export function clientPackage(id, options) {
  return [
    nodeBundle(options.nodeEntries),
    clientBundle(id, { entry: options.clientEntry, externals: options.clientExternals }),
  ]
}
