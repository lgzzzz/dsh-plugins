/**
 * 诊断条：`/check`、`/write` 与仿真失败共用的横幅，以及规则校验结果的列表。
 */

import type { ReactNode } from 'react'
import type { Diagnostic } from './api.ts'
import ctl from './Controls.module.css'
import { useTranslate } from './locale-context.tsx'

/**
 * 一条左描边的提示横幅；`error` 时描边换成错误色，其余沿用警示色。
 * @param props.severity - 严重度，缺省按警示渲染。
 * @param props.children - 横幅内容（可含换行）。
 * @returns 横幅元素。
 */
export function Banner({ severity, children }: { severity?: 'error' | 'warning'; children: ReactNode }) {
  return (
    <div className={ctl['diag']} data-severity={severity}>
      {children}
    </div>
  )
}

/**
 * 一组规则库诊断；没有诊断时不渲染任何东西。
 * @param props.diagnostics - 后端给出的诊断。
 * @returns 若干横幅，或 `null`。
 */
export function DiagnosticList({ diagnostics }: { diagnostics: readonly Diagnostic[] }) {
  const t = useTranslate()
  if (diagnostics.length === 0) return null
  return (
    <>
      {diagnostics.map((entry, index) => (
        <Banner key={`${entry.code}-${index}`} severity={entry.severity}>
          {entry.severity === 'error' ? t('diag.error') : t('diag.warning')} · {entry.path}
          {'\n'}
          {entry.message}
        </Banner>
      ))}
    </>
  )
}
