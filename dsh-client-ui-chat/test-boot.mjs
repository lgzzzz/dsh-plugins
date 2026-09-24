/**
 * 诊断脚本（非插件产物）：纯 Node，无浏览器。
 *
 * 用 `window.__ModuleLoader__` 桩载入构建产物 lib/client.js，验证三件事：
 *   A. 注册契约：模块 id 等于包名（浏览器图行 id 取自 package.json 的 name），factory 可调用；
 *   B. 工厂装配：以 `require` 桩执行工厂，检查导出的 apply / inject，以及 CSS Modules 样式是否
 *      按 data-plugin / data-plugin-css 插入（dsh-client-modules 的 removeOwnedStyles 靠前者回收，
 *      client-hmr 重建时不重复插靠后者）；
 *   C. 模块表闸门：产物静态 require 的名字必须落在 PLATFORM_MODULES 基线内 —— 定制时若不小心
 *      把另一个插件的值 import 进来（内联出第二份实例），这里会失败。
 *
 * 用法：node test-boot.mjs（需先 npm run build）
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/** 插件包名：模块 id、样式标签归属与浏览器图行 id 共用它。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-chat'

/** 模块表基线，镜像 packages/client/web/src/platform.ts 的 PLATFORM_MODULES。 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

let failures = 0
/** 断言并按仓库脚本惯例记账。 */
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

const artifact = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

// ---- 桩 -------------------------------------------------------------------

/** 只实现样式注入用到的三个成员的文档桩。 */
function makeDocument() {
  const tags = []
  return {
    tags,
    querySelector(selector) {
      const match = /^style\[data-plugin-css="(.*)"\]$/.exec(selector)
      if (match === null) return null
      return tags.find(tag => tag.dataset.pluginCss === match[1]) ?? null
    },
    createElement(tagName) {
      return { tagName, dataset: {}, textContent: '' }
    },
    head: { appendChild: (element) => { tags.push(element) } },
  }
}

/**
 * 记录被请求的模块名，并返回可安全取值的桩。
 *
 * react / react-dom 需要**具名成员**而不是纯 Proxy：esbuild 对默认导入会发出
 * `__toESM(require("react"), 1)`，该 helper 按 `Object.getOwnPropertyNames` 复制成员，
 * 纯 Proxy 只暴露函数目标的 length / name / prototype ⇒ `react.memo` 会是 undefined 并抛错。
 * 这里给这两个模块一份覆盖其常用导出的桩对象。其余模块用万能 Proxy。
 */
function makeRequire(requested) {
  const anything = new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.toPrimitive) return () => ''
      if (key === 'then') return undefined
      return anything
    },
    apply: () => anything,
    construct: () => anything,
    has: () => true,
  })
  const members = (names) => Object.fromEntries([...names, 'default', '__esModule'].map(name => [name, name === '__esModule' ? true : anything]))
  const stubs = {
    react: members([
      'memo', 'forwardRef', 'createElement', 'cloneElement', 'isValidElement', 'createContext', 'Children',
      'Fragment', 'StrictMode', 'Component', 'PureComponent',
      'useState', 'useEffect', 'useLayoutEffect', 'useMemo', 'useCallback', 'useRef', 'useReducer',
      'useContext', 'useId', 'useTransition', 'useDeferredValue', 'useImperativeHandle', 'useDebugValue',
      'useSyncExternalStore', 'useInsertionEffect', 'startTransition', 'version',
    ]),
    'react/jsx-runtime': members(['jsx', 'jsxs', 'Fragment']),
    'react-dom': members(['createPortal', 'flushSync', 'findDOMNode', 'unstable_batchedUpdates']),
    'react-dom/client': members(['createRoot', 'hydrateRoot']),
  }
  return (specifier) => {
    requested.push(specifier)
    return stubs[specifier] ?? anything
  }
}

/** 载入产物并取回它交给 __ModuleLoader__ 的注册项。 */
function loadArtifact() {
  let registration = null
  globalThis.window = { __ModuleLoader__: { load: (reg) => { registration = reg } } }
  globalThis.document = makeDocument()
  // eslint-disable-next-line no-eval
  ;(0, eval)(artifact)
  return registration
}

// ---- A. 注册契约 -----------------------------------------------------------

console.log('--- A. lib/client.js 注册契约 ---')
const registration = loadArtifact()
check('registration 非空', registration !== null, true)
check('模块 id == 包名', registration.id, PACKAGE_NAME)
check('factory 是函数', typeof registration.factory, 'function')

// ---- B. 工厂装配 -----------------------------------------------------------

console.log('--- B① 工厂执行：导出面 + 样式注入 ---')
const requested = []
const plugin = registration.factory(makeRequire(requested))
check('apply 是函数', typeof plugin.apply, 'function')
check('inject 声明', plugin.inject, [
  'slots', 'sessions', 'uiWorkspace', 'uiSession', 'uiConversation', 'locale',
  'configForms', 'remote', 'remote.session', 'sidebarRight',
])

const tags = globalThis.document.tags
check('注入样式标签数', tags.length, 1)
check('样式标签名', tags[0]?.tagName, 'style')
check('data-plugin（HMR 回收键）', tags[0]?.dataset.plugin, PACKAGE_NAME)
check('data-plugin-css', tags[0]?.dataset.pluginCss, `${PACKAGE_NAME}/client.css`)
console.log(`     （内联样式 ${tags[0]?.textContent.length ?? 0} 字节）`)

console.log('--- B② 同一文档重复执行工厂：不重复插样式（client-hmr 重建路径） ---')
registration.factory(makeRequire([]))
check('样式标签数不变', globalThis.document.tags.length, 1)

// ---- C. 模块表闸门 ---------------------------------------------------------

console.log('--- C. 产物静态 require ⊆ PLATFORM_MODULES ---')
const staticRequires = [...new Set([...artifact.matchAll(/\brequire\(\s*"([^"]+)"\s*\)/g)].map(match => match[1]))]
console.log(`     实际 require：${staticRequires.join(', ')}`)
check('无模块表之外的 require', staticRequires.filter(name => !PLATFORM_MODULES.includes(name)), [])
check('工厂执行期也只请求模块表内的名字', [...new Set(requested)].filter(name => !PLATFORM_MODULES.includes(name)), [])
check('产物无动态 import()', /\bimport\(/.test(artifact), false)

console.log(failures === 0 ? '\nall artifact probes passed' : `\n${failures} probe(s) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
