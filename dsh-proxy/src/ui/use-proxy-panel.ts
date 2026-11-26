/**
 * 面板的控制器：状态轮询、草稿（未应用改动）与所有写操作。
 *
 * 分工约定：这里只有数据与副作用，不渲染任何元素；`Panel.tsx` 负责把它们摆成界面。
 * 轮询 2 秒一次，页面隐藏时跳过，避免后台标签页空转。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, describeError } from './api.ts'
import type {
  CheckResult, Diagnostic, MessageResult, PanelState, Routing, WriteResult,
} from './api.ts'
import type { LocaleKey } from './locale.ts'

const POLL_INTERVAL_MS = 2000

/** 在拿到第一份快照前，草稿用的空规则库。 */
const DRAFT_SEED: Routing = { default: 'proxy', rules: [] }

/** 面板控制器向外暴露的数据与动作。 */
export interface ProxyPanelController {
  /** 最近一次 `/state` 快照；首次取到之前为 `null`。 */
  readonly state: PanelState | null
  /** 正在编辑的规则库（可能含未应用改动）。 */
  readonly draft: Routing
  /** 草稿是否偏离了服务端。 */
  readonly dirty: boolean
  /** 是否有写操作在途。 */
  readonly busy: boolean
  /** 最近一次 `/check` 或 `/write` 的诊断。 */
  readonly diagnostics: readonly Diagnostic[]
  /** 最近一次成功动作的消息；内核启停成功后为空（状态条已经说明结果）。 */
  readonly message: string
  /** 最近一次失败的原因。 */
  readonly error: string
  /** 用新草稿替换当前草稿，并标记为有改动。 */
  readonly edit: (next: Routing) => void
  /** 丢弃草稿，回到服务端快照。 */
  readonly reset: () => void
  /** 只校验草稿，不落盘。 */
  readonly check: () => void
  /** 校验并落盘草稿。 */
  readonly apply: () => void
  /** 启动内核。 */
  readonly start: () => void
  /** 停止内核。 */
  readonly stop: () => void
  /** 重启内核。 */
  readonly restart: () => void
  /** 导入一条订阅。 */
  readonly importSubscription: (url: string, name: string) => void
  /** 对所有节点测一轮 TCP 延迟。 */
  readonly testLatency: () => void
}

/**
 * 组装面板控制器。
 * @param t - 当前语言的翻译函数，用于本地生成的提示文案。
 * @returns 快照、草稿与全部动作。
 */
export function useProxyPanel(t: (key: LocaleKey) => string): ProxyPanelController {
  const [state, setState] = useState<PanelState | null>(null)
  const [draft, setDraft] = useState<Routing>(DRAFT_SEED)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<readonly Diagnostic[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // 轮询闭包只读这个 ref，免得把 dirty 写进 refresh 的依赖里、每次改动都重建定时器。
  const dirtyRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const next = await api<PanelState>('/state')
      setState(next)
      // 有未应用改动时不覆盖草稿：轮询是背景刷新，不能吞掉用户正在编的内容。
      if (!dirtyRef.current) setDraft({ default: next.routing.default, rules: next.routing.rules })
      setError('')
    } catch (caught) {
      setError(describeError(caught))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [refresh])

  const run = useCallback(
    async (action: () => Promise<string>) => {
      setBusy(true)
      setError('')
      try {
        setMessage(await action())
        await refresh()
      } catch (caught) {
        setError(describeError(caught))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const edit = useCallback((next: Routing) => {
    dirtyRef.current = true
    setDirty(true)
    setDraft(next)
  }, [])

  const reset = useCallback(() => {
    if (state === null) return
    dirtyRef.current = false
    setDirty(false)
    setDraft({ default: state.routing.default, rules: state.routing.rules })
    setDiagnostics([])
  }, [state])

  const check = useCallback(() => {
    void run(async () => {
      const result = await api<CheckResult>('/check', { mode: 'replace', routing: draft })
      setDiagnostics(result.diagnostics)
      return result.valid ? t('message.checkOk') : t('message.checkFailed')
    })
  }, [run, draft, t])

  const apply = useCallback(() => {
    void run(async () => {
      const result = await api<WriteResult>('/write', {
        mode: 'replace',
        routing: draft,
        reason: '面板编辑',
      })
      setDiagnostics(result.diagnostics)
      if (result.saved) {
        dirtyRef.current = false
        setDirty(false)
        const next = await api<PanelState>('/state')
        setDraft({ default: next.routing.default, rules: next.routing.rules })
      }
      return result.message
    })
  }, [run, draft])

  const coreAction = useCallback(
    (action: 'start' | 'stop' | 'restart') => {
      void run(async () => {
        const result = await api<MessageResult>('/core', { action })
        // 启停结果状态条上已经写着了（状态点、按钮、lastError），成功的「内核已启动 /
        // 已停止」只是重复播报，不弹横幅；失败的说明（如还没选节点）没有别的出口，保留。
        return result.ok === false ? result.message : ''
      })
    },
    [run],
  )

  const importSubscription = useCallback(
    (url: string, name: string) => {
      void run(async () => (await api<MessageResult>('/subscription', {
        url,
        ...(name === '' ? {} : { name }),
      })).message)
    },
    [run],
  )

  const testLatency = useCallback(() => {
    void run(async () => (await api<MessageResult>('/latency', {})).message)
  }, [run])

  return {
    state,
    draft,
    dirty,
    busy,
    diagnostics,
    message,
    error,
    edit,
    reset,
    check,
    apply,
    start: () => {
      coreAction('start')
    },
    stop: () => {
      coreAction('stop')
    },
    restart: () => {
      coreAction('restart')
    },
    importSubscription,
    testLatency,
  }
}
