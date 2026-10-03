/**
 * dsh-plugins 插件包的共享 tsdown 预设:产出浏览器半部与宿主半部两个 bundle。
 *
 *   - 浏览器半部是包在 `window.__ModuleLoader__.load({ id, factory })` 里的 CJS 工厂;
 *     平台模块表种子(react / cordis / dsh-client-* 等)保持 external,其余依赖内联;
 *   - `@deepseek-ai` 包的值导入只允许:请求的模块表行、可内联的 wire 层 / 第三方库 /
 *     生成的 /remote 产物;三者都不是则构建失败;
 *   - `*.module.css` 经 lightningcss 编译成哈希类名表 + 运行时 <style> 注入器,
 *     全局 `*.css` 同样注入,`*.css?inline` 只导出编译后的文本;
 *   - 宿主半部是普通 ESM 库 bundle,生产依赖保持 external。
 *
 * 用 `.mjs` 而非 `.ts`,避免 tsdown 加载配置时走 Node 原生 TypeScript 擦除。
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'

/** 虚拟模块 id 前缀:让 CSS 不走 tsdown 自带的 css 流水线。 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0dsh-global-css:'
const INLINE_CSS_VIRTUAL_PREFIX = '\0dsh-inline-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** 查询后缀:把样式表当文本导入,而不是当副作用导入。 */
const INLINE_CSS_QUERY = '?inline'

/** DSH web 外壳共享的模块表种子:这些说明符保持 external,运行时由外壳提供。 */
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

/** 可内联的契约层与纯函数:没有需要共享的运行时标识(Symbol / instanceof / 单例状态)。 */
const INLINE_SAFE = /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|output-retention|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-native-command\/types$|@deepseek-ai\/dsh-host-open-in-app\/shared$|@deepseek-ai\/dsh-plugin-manager\/registry$|@deepseek-ai\/dsh-agent-preset-registry\/display$|@deepseek-ai\/dsh-api-workspace-controller\/default-workspace$|@deepseek-ai\/dsh-spill-policy\/notice$)/

/** 浏览器 bundle 需要内联的框架库(已改作用域的 cosmokit / schemastery)。 */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/** 生成的 /remote 描述符 / 编解码产物。 */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/** 说明符是否等于某个种子,或是它的子路径。 */
function matchesAny(specifier, seeds) {
  return seeds.some(seed => specifier === seed || specifier.startsWith(`${seed}/`))
}

/** 读取当前工作目录下的 package.json。 */
function readManifest() {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
}

/** 生产依赖名:真实安装会落到磁盘上的三个依赖段。 */
function productionExternals() {
  const manifest = readManifest()
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]
}

/** `dsh.client.external`:包在基线之外额外请求的模块表行。 */
function requestedClientExternals() {
  const value = readManifest().dsh?.client?.external
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('dsh.client.external must be a string array')
  }
  return value
}

/** 生成插件自有的样式注入模块,并按需导出 CSS Modules 类名表。 */
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

/** 把 `x.module.css` 编译成哈希类名表 + 运行时样式注入器。 */
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

/** 在工厂执行时注入全局 `x.css`(非 module)样式表。 */
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
 * 把 `x.css?inline` 样式表导出为编译后的文本。
 *
 * <style> 标签的生命周期由导入方插件自己管理,所以这里不像 `x.css` /
 * `x.module.css` 那样自行注入。解析排在全局处理器之前,同一说明符由先声明的插件接管。
 */
function cssTextInlinePlugin() {
  return {
    name: 'dsh-css-text-inline',
    resolveId(source, importer) {
      if (!source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null
      const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length)
      const abs = importer !== undefined ? resolve(dirname(importer), stylesheet) : stylesheet
      return INLINE_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId) {
      if (!virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code } = transform({ filename: fileId, code: source, minify: true })
      return `export default ${JSON.stringify(code.toString())};`
    },
  }
}

/**
 * 构建期的模块边规则:内联的 `@deepseek-ai` 值导入必须是无运行时标识的
 * (wire 层、第三方库或生成的 /remote 产物),否则必须是请求的模块表行(external),
 * 两者都不是则构建失败。
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

/** 折进浏览器产物的客户端公开环境变量。 */
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
 * 构建浏览器半部:`lib/client.js`,即 `__ModuleLoader__` 的 CJS 工厂。
 * 平台种子保持 external,其余全部打包。
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
      // 双模式库(如 lexical:exports 带 development/production/node 条件,node 入口
      // 用了 CJS bundle 承载不了的顶层 await)必须解析到静态形态。把环境条件排在最前
      // 即可选中它:条件顺序就是解析器的优先级,否则默认条件集里的 `node` 会胜出。
      resolve: {
        conditionNames: [
          nodeEnv === 'development' ? 'development' : 'production',
          'browser', 'import', 'module', 'default',
        ],
      },
    },
    define: {
      ...clientBuildEnvironmentDefines(process.env),
      'process.env.NODE_ENV': JSON.stringify(nodeEnv),
      'import.meta.env.MODE': JSON.stringify(nodeEnv),
      'import.meta.env': JSON.stringify({ MODE: nodeEnv }),
    },
    plugins: [
      purityGatePlugin(id, isRequested),
      cssModulesInlinePlugin(id),
      cssTextInlinePlugin(),
      cssGlobalInlinePlugin(id),
    ],
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
 * 构建宿主半部:把 `src/` 打成 `lib/` 下的 ESM 库 bundle。
 * 生产依赖保持 external,其余全部打包。
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
 * 一次性构建完整插件的两半(宿主库 + 浏览器 bundle)。
 * `clean` 保持关闭,避免两半互相清空 `lib/`。
 */
export function clientPackage(id, options) {
  return [
    nodeBundle(options.nodeEntries),
    clientBundle(id, { entry: options.clientEntry, externals: options.clientExternals }),
  ]
}
