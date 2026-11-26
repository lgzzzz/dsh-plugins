/**
 * 「连接」页签的控制器：访问日志查询、过滤条件与轮询。
 *
 * 取数只在页签挂载期间进行：每 2 秒一次，页面隐藏时暂停；过滤条件变化后防抖 250ms
 * 立即重取。过期响应按请求序号丢弃，避免快速输入时旧结果覆盖新结果。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, describeError } from './api.ts'
import type { TrafficVerdict, TrafficView } from './api.ts'

const POLL_INTERVAL_MS = 2000
const FILTER_DEBOUNCE_MS = 250
/** 一次最多取多少条；宿主会再钳到 1–200。 */
const LIMIT = 200

/** 面板控制器向外暴露的数据与动作。 */
export interface TrafficController {
  /** 最近一次 `/traffic` 响应；首次取到之前为 `null`。 */
  readonly view: TrafficView | null
  /** 过滤框里的原文。 */
  readonly host: string
  /** 当前分类过滤。 */
  readonly verdict: TrafficVerdict | ''
  /** 首次取数尚未完成。 */
  readonly loading: boolean
  /** 最近一次失败的原因。 */
  readonly error: string
  /** 是否暂停自动刷新（过滤仍然生效）。 */
  readonly paused: boolean
  /** 改过滤框（防抖后重取）。 */
  readonly setHost: (value: string) => void
  /** 改分类过滤（立即重取）。 */
  readonly setVerdict: (value: TrafficVerdict | '') => void
  /** 暂停 / 继续自动刷新。 */
  readonly togglePause: () => void
}

/**
 * 组装「连接」页签控制器。
 * @returns 数据、过滤条件与 setter。
 */
export function useTraffic(): TrafficController {
  const [view, setView] = useState<TrafficView | null>(null)
  const [host, setHostState] = useState('')
  const [verdict, setVerdictState] = useState<TrafficVerdict | ''>('')
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  // 定时器只读 ref，免得每次输入或暂停都重建轮询。
  const pausedRef = useRef(false)
  const filter = useRef<{ host: string; verdict: TrafficVerdict | '' }>({ host: '', verdict: '' })
  // 只采纳「最后一次发出」的响应。
  const latest = useRef(0)
  const debounce = useRef<number | undefined>(undefined)

  const fetchTraffic = useCallback(async () => {
    latest.current += 1
    const seq = latest.current
    const params = new URLSearchParams({ limit: String(LIMIT) })
    if (filter.current.host !== '') params.set('host', filter.current.host)
    if (filter.current.verdict !== '') params.set('verdict', filter.current.verdict)
    try {
      const next = await api<TrafficView>(`/traffic?${params.toString()}`)
      if (seq !== latest.current) return
      setView(next)
      setError('')
    } catch (caught) {
      if (seq !== latest.current) return
      setError(describeError(caught))
    }
  }, [])

  useEffect(() => {
    void fetchTraffic()
    const timer = window.setInterval(() => {
      if (!document.hidden && !pausedRef.current) void fetchTraffic()
    }, POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      if (debounce.current !== undefined) window.clearTimeout(debounce.current)
    }
  }, [fetchTraffic])

  const schedule = useCallback(() => {
    if (debounce.current !== undefined) window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(() => {
      debounce.current = undefined
      void fetchTraffic()
    }, FILTER_DEBOUNCE_MS)
  }, [fetchTraffic])

  const setHost = useCallback((value: string) => {
    setHostState(value)
    filter.current = { ...filter.current, host: value.trim() }
    schedule()
  }, [schedule])

  const setVerdict = useCallback((value: TrafficVerdict | '') => {
    setVerdictState(value)
    filter.current = { ...filter.current, verdict: value }
    schedule()
  }, [schedule])

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
  }, [])

  return {
    view,
    host,
    verdict,
    loading: view === null && error === '',
    error,
    paused,
    setHost,
    setVerdict,
    togglePause,
  }
}
