/**
 * dsh-left-dock — 字典与回退文案。
 *
 * 与上游插件一致：向 locale 服务注册命名空间后，注册项声明 `locale: NS`，
 * 框架据此合成组件的 `t` prop。若 locale 服务缺席（非标准组合），组件回退到
 * 本文件的 zh 字典（`fallbackTranslate`），因此文案面永远可用。
 */
import type { Translate } from './context.ts'

/** 本插件的字典命名空间。 */
export const NS = 'leftDock'

/** 简体中文（键集真源）。 */
export const zh = {
  'strip.session': '会话',
  'strip.files': '文件',
  'strip.session.toggle': '展开/收起会话侧栏',
  'strip.files.toggle': '展开/收起文件侧栏',
  'session.new': '新会话',
  'brand.localBuild': '本地构建',
  'files.reload': '重新读取',
  'files.loading': '正在读取…',
  'files.empty': '空目录',
  'files.truncated': '条目太多，只显示了一部分。',
  'files.other': '这不是文件或目录，没法打开。',
  'files.noWorkspace': '当前会话没有工作区目录。',
  'files.noService': '文件服务不可用：remote.workspaceFiles 未就绪。',
  'files.openFailed': '文本编辑器不可用：dsh-text-editor 服务未就绪。',
  'files.error.notFound': '这个目录不在了。可能已被移动或删除。',
  'files.error.outsideWorkspace': '这个目录在工作区之外，不会读取它。',
  'files.error.notDirectory': '这不是一个目录。',
  'files.error.unavailable': '读取失败：{message}',
} satisfies Record<string, string>

/** 英文（键集与 zh 一致）。 */
export const en = {
  'strip.session': 'Sessions',
  'strip.files': 'Files',
  'strip.session.toggle': 'Toggle the session sidebar',
  'strip.files.toggle': 'Toggle the file sidebar',
  'session.new': 'New session',
  'brand.localBuild': 'Local build',
  'files.reload': 'Reload',
  'files.loading': 'Reading…',
  'files.empty': 'Empty directory',
  'files.truncated': 'Too many entries, showing only some of them.',
  'files.other': 'Not a file or a directory, so it cannot be opened.',
  'files.noWorkspace': 'This session has no workspace directory.',
  'files.noService': 'File service unavailable: remote.workspaceFiles is not ready.',
  'files.openFailed': 'Text editor unavailable: the dsh-text-editor service is not ready.',
  'files.error.notFound': 'That directory is gone. It may have been moved or deleted.',
  'files.error.outsideWorkspace': 'That directory is outside the workspace, so it will not be read.',
  'files.error.notDirectory': 'That is not a directory.',
  'files.error.unavailable': 'Read failed: {message}',
} satisfies Record<keyof typeof zh, string>

/** 占位符插值（与框架 t 的 `{name}` 约定一致）。 */
function interpolate(template: string, params: Record<string, unknown> | undefined): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/**
 * 无 locale 服务时的回退文案函数。
 * @param key - 字典键。
 * @param params - 插值参数。
 * @returns 文案；未知键原样回显该键（便于定位漏配）。
 */
export function fallbackTranslate(key: string, params?: Record<string, unknown>): string {
  const template = (zh as Record<string, string>)[key]
  return interpolate(template === undefined ? key : template, params)
}

/** 把任意来源的 `t` 收敛为安全函数（缺失/异常都回退到本地字典）。 */
export function safeTranslate(candidate: unknown): Translate {
  if (typeof candidate !== 'function') return fallbackTranslate
  const fn = candidate as Translate
  return (key, params) => {
    try {
      const text = fn(key, params)
      return typeof text === 'string' && text !== '' ? text : fallbackTranslate(key, params)
    } catch {
      return fallbackTranslate(key, params)
    }
  }
}
