/**
 * 「日志」页签：内核环形日志的尾部，等宽字体逐行显示。
 * 日志由 `/state` 的轮询一并带回，页签本身不发请求。
 */

import type { LogLine } from './api.ts'
import { Empty, Hint } from './Controls.tsx'
import { useTranslate } from './locale-context.tsx'
import css from './Panel.module.css'

/**
 * 渲染日志页签。
 * @param props.logs - 日志行（旧的在前）。
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
      {logs.map((line, index) => (
        <div key={`${line.time}-${index}`}>
          {new Date(line.time).toLocaleTimeString()} [{line.source}] {line.text}
        </div>
      ))}
    </div>
  )
}
