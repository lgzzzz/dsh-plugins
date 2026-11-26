/**
 * 「日志」页签：内核环形日志的尾部，等宽字体逐行显示，最新的一行在最上面。
 *
 * 日志由 `/state` 的轮询一并带回，页签本身不发请求；接口按时间正序给行（内核 stderr 的
 * 尾部文本要按原顺序拼），这里只把展示顺序倒过来，避免旧日志把最新的一条挤到滚动区之外。
 */

import type { LogLine } from './api.ts'
import { Empty, Hint } from './Controls.tsx'
import { useTranslate } from './locale-context.tsx'
import css from './Panel.module.css'

/**
 * 把接口的时间正序行翻成展示用的倒序行。
 * @param logs - 日志行（旧的在前）。
 * @returns 日志行（新的在前）；不改动入参。
 */
export function newestFirst(logs: readonly LogLine[]): LogLine[] {
  return [...logs].reverse()
}

/**
 * 渲染日志页签。
 * @param props.logs - 日志行（接口顺序是旧的在前，展示时最新的在最上面）。
 * @returns 页签内容。
 */
export function LogsTab({ logs }: { logs: readonly LogLine[] }) {
  const t = useTranslate()
  if (logs.length === 0) {
    return (
      <div>
        <Hint>{t('logs.hint')}</Hint>
        <Empty>{t('logs.empty')}</Empty>
      </div>
    )
  }
  return (
    <div className={css['logs']}>
      {newestFirst(logs).map((line, index) => (
        <div key={`${line.time}-${index}`}>
          {new Date(line.time).toLocaleTimeString()} [{line.source}] {line.text}
        </div>
      ))}
    </div>
  )
}
