/**
 * `dsh-resource://file/…` 地址的本地解析与构造。
 *
 * 上游 `@deepseek-ai/dsh-util-workspace-path` 提供同一套语法，但本插件的浏览器
 * 产物只把 react 声明为 external（业务模块全部内联），故按该包语义本地实现，
 * 只覆盖本插件真正用到的三种能力：
 *
 *   - parseSessionFileAddress：把右栏 tab 的 contentId（地址）还原成
 *     `{ sessionId, path }`；
 *   - fileAddressFor / sessionFileAddress：把（相对或绝对）路径重新编码成
 *     session 作用域地址，供 `sidebarRight.openResource` 使用；
 *   - isTextFile：判定该地址是否由本编辑器接管（图片 / PDF 留给内置预览器）。
 *
 * 地址文法（与上游逐字一致）：
 *   dsh-resource://file/session/<编码后的 sessionId>/<逐段编码的路径>
 */
import { basename } from './path.ts'

const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/** 一个 session 作用域的文件引用。 */
export interface SessionFileRef {
  sessionId: string
  path: string
}

/** 转义单个 id / 路径段，保留 `:` 字面量（Windows 盘符）。 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/** 逐段转义一条 `/` 分隔的路径。 */
function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/')
}

/**
 * 解析 `dsh-resource://file/session/<id>/<path>`。
 * 只认领 session 作用域（`absolute` 作用域不由本编辑器打开），查询串/片段被忽略；
 * 任何一段解码失败或结构不符则返回 undefined。
 */
export function parseSessionFileAddress(address: string): SessionFileRef | undefined {
  try {
    if (!address.startsWith(FILE_ADDRESS_PREFIX)) return undefined
    const end = address.search(/[?#]/)
    const [scope, ...rest] = address
      .slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end)
      .split('/')
    if (scope !== 'session') return undefined
    const [id, ...segments] = rest
    if (id === undefined || id === '' || segments.length === 0) return undefined
    return {
      sessionId: decodeURIComponent(id),
      path: segments.map(decodeURIComponent).join('/'),
    }
  } catch {
    return undefined
  }
}

/** 构造 session 作用域地址（反斜杠归一化为 `/`，去掉前导 `./`）。 */
export function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`
}

/** 是否为 POSIX 绝对路径、Windows 盘符路径或 UNC 路径。 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
}

/**
 * 与上游 `fileAddressFor` 等价：相对路径、或工作区根内的绝对路径，都编码成
 * 工作区相对地址；工作区根之外（或根未知）的绝对路径原样保留在 session 地址里。
 */
export function fileAddressFor(sessionId: string, cwd: string | undefined, path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (!isAbsolutePath(normalized)) return sessionFileAddress(sessionId, normalized)
  const root = cwd === undefined ? '' : cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (root !== '' && normalized === root) return sessionFileAddress(sessionId, '')
  if (root !== '' && normalized.startsWith(`${root}/`)) {
    return sessionFileAddress(sessionId, normalized.slice(root.length + 1))
  }
  return sessionFileAddress(sessionId, normalized)
}

/**
 * 由本编辑器接管的扩展名域：除图片（png/jpg/jpeg/gif/webp/bmp/ico/svg）与 PDF
 * 外的一切文件都按文本打开——它们全部落在内置文档预览的 `text-pages` 域内
 * （代码 / Markdown / 纯文本），文档预览的字节类渲染器继续服务图片与 PDF。
 */
const PREVIEW_ONLY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'pdf',
])

/** 该路径是否作为文本由本编辑器接管（无扩展名按文本处理）。 */
export function isTextFile(path: string): boolean {
  const name = basename(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot === -1) return true
  return !PREVIEW_ONLY_EXTENSIONS.has(name.slice(dot + 1))
}
