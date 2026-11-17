window.__ModuleLoader__.load({
  id: 'dsh-request-stats',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'requestStats'
    /** Shared identity of the sidebar entry and the main panel it opens. */
    const PANEL_ID = 'requestStats'
    /** Host bridge owned by the plugin's Host half. */
    const BASE = '/api/dsh-request-stats'
    /** One poll interval while the panel is mounted. */
    const REFRESH_MS = 4000
    /** Windows offered by the range control. */
    const WINDOWS = ['1h', '24h', '7d', 'all']

    const en = {
      panel: 'Request stats',
      title: 'Request stats',
      subtitle: 'Every model request this Host sends to a watched route — server identity, time to first token, and output speed.',
      refresh: 'Refresh',
      clear: 'Clear',
      clearing: 'Clearing…',
      confirmClear: 'Clear now',
      cancel: 'Cancel',
      range: 'Time range',
      range1h: '1 h',
      range24h: '24 h',
      range7d: '7 days',
      rangeAll: 'All',
      live: 'In progress',
      loading: 'Loading…',
      failed: 'The ledger could not be read',
      forbiddenHint: 'The dashboard only answers requests from this machine, so a remote browser cannot read the ledger.',
      retry: 'Retry',
      showAll: 'View all',
      emptyTitle: 'No requests recorded yet',
      emptyHint: 'Start a conversation on the watched provider. Each request appears here with the server that answered it, its first-token latency, and its output speed.',
      emptyScope: 'Nothing matches the selected range. Switch to “All” to see the retained records.',
      kpiRequests: 'Requests',
      kpiRequestsHint: '{ok} ok · {errors} failed · {aborted} aborted · {rate} success',
      kpiTtft: 'Avg first token',
      kpiTtftHint: 'P50 {p50} · P90 {p90} · successful only',
      kpiTps: 'Avg output speed',
      kpiTpsHint: 'P50 {p50} · {count} measured, {estimated} estimated',
      kpiTokens: 'Output tokens',
      kpiTokensHint: 'Cache read {cache}',
      servers: 'Servers',
      serversHint: 'Grouped by the peer IP observed on a direct connection, otherwise by the Cloudflare edge that answered.',
      colServer: 'Server',
      colRequests: 'Requests',
      colShare: 'Share',
      colTtft: 'First token',
      colTps: 'Output speed',
      colTokens: 'Tokens',
      colLast: 'Last seen',
      direct: 'Direct',
      proxied: 'Proxied',
      edge: 'Edge',
      unknownServer: 'Unknown',
      trend: 'Recent requests',
      trendTtft: 'First token',
      trendTps: 'Output speed',
      trendEmpty: 'Not enough requests for a trend yet.',
      models: 'Models',
      colModel: 'Model',
      recent: 'Recent requests',
      colTime: 'Time',
      colStatus: 'Status',
      colPurpose: 'Purpose',
      includeAux: 'Include auxiliary calls',
      auxiliaryExcluded: '{count} auxiliary call(s) excluded',
      auxiliaryIncluded: '{count} auxiliary call(s) included',
      watched: 'Watching {providers} → {hosts}',
      trendMin: 'min {value}',
      trendMax: 'max {value}',
      clearNow: 'Clear now',
      confirmClearTitle: 'Clear all retained records?',
      statusOk: 'OK',
      statusError: 'Error',
      statusAborted: 'Aborted',
      proxyNotice: '{count} record(s) went through a proxy, so the peer address was the proxy, not the server. Those rows are grouped by Cloudflare edge code. Turn the proxy off to record the server IP directly.',
      edgeNotice: 'Cloudflare edge codes come from the response cf-ray header; the letter group is the data center that answered (e.g. SIN = Singapore).',
      privacy: 'Stored in this profile’s dsh-request-stats/records.json by the Host process and kept across restarts: provider, model, purpose, session id, server, timings, and token counts. No prompt text, headers, or credentials.',
      allClear: 'All records cleared.',
      clearFailed: 'Could not clear records',
      recentScope: 'Latest {shown} · {retained} retained in this profile',
    }

    const zh = {
      panel: '请求看板',
      title: '请求看板',
      subtitle: '记录本机发往受监控路由的每一次模型请求：服务器身份、首字延迟与输出速度。',
      refresh: '刷新',
      clear: '清空',
      clearing: '正在清空…',
      confirmClear: '确认清空',
      cancel: '取消',
      range: '时间范围',
      range1h: '1 小时',
      range24h: '24 小时',
      range7d: '7 天',
      rangeAll: '全部',
      live: '进行中',
      loading: '加载中…',
      failed: '读取请求记录失败',
      forbiddenHint: '看板只接受本机请求，远程浏览器读不到记录。',
      retry: '重试',
      showAll: '查看全部',
      emptyTitle: '还没有记录到请求',
      emptyHint: '用受监控的模型发起一次对话，这里会自动出现每次请求的服务器、首字延迟和输出速度。',
      emptyScope: '当前时间范围内没有记录，切到「全部」可以查看已保留的记录。',
      kpiRequests: '请求数',
      kpiRequestsHint: '成功 {ok} · 失败 {errors} · 中止 {aborted} · 成功率 {rate}',
      kpiTtft: '平均首字延迟',
      kpiTtftHint: 'P50 {p50} · P90 {p90} · 仅成功请求',
      kpiTps: '平均输出速度',
      kpiTpsHint: 'P50 {p50} · {count} 次，其中 {estimated} 次为估算',
      kpiTokens: '输出 tokens',
      kpiTokensHint: '缓存读 {cache}',
      servers: '服务器',
      serversHint: '直连时按实际观测到的对端 IP 分组，否则按作出响应的 Cloudflare 边缘机房分组。',
      colServer: '服务器',
      colRequests: '请求',
      colShare: '占比',
      colTtft: '首字',
      colTps: '输出速度',
      colTokens: 'Tokens',
      colLast: '最近',
      direct: '直连',
      proxied: '经代理',
      edge: '边缘',
      unknownServer: '未知',
      trend: '最近请求',
      trendTtft: '首字延迟',
      trendTps: '输出速度',
      trendEmpty: '请求还不够，暂时画不出趋势。',
      models: '模型',
      colModel: '模型',
      recent: '请求明细',
      colTime: '时间',
      colStatus: '状态',
      colPurpose: '用途',
      includeAux: '包含辅助请求',
      auxiliaryExcluded: '已排除 {count} 条辅助调用',
      auxiliaryIncluded: '已包含 {count} 条辅助调用',
      watched: '监控 {providers} → {hosts}',
      trendMin: '最低 {value}',
      trendMax: '最高 {value}',
      clearNow: '确认清空',
      confirmClearTitle: '清空全部已保留记录？',
      statusOk: '成功',
      statusError: '失败',
      statusAborted: '中止',
      proxyNotice: '有 {count} 条记录经过代理，对端地址是代理而不是服务器，这些记录按 Cloudflare 边缘机房展示。关掉代理后即可直接记录服务器 IP。',
      edgeNotice: '边缘机房代码来自响应的 cf-ray 头，字母部分是实际应答的数据中心（如 SIN = 新加坡）。',
      privacy: '记录由本机 Host 进程写入当前 profile 的 dsh-request-stats/records.json 并跨重启保留：提供方、模型、用途、会话 id、服务器、耗时与 token 数；不含提示词内容、请求头或凭据。',
      allClear: '已清空全部记录。',
      clearFailed: '清空记录失败',
      recentScope: '最近 {shown} 条 · 本 profile 保留 {retained} 条',
    }

    // ---------------------------------------------------------------- format

    const intl = new Intl.NumberFormat()

    /** Millisecond value as a short human duration. */
    function formatMs(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value >= 1000) return `${(value / 1000).toFixed(2)} s`
      return `${Math.round(value)} ms`
    }

    /** Tokens-per-second value. */
    function formatRate(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return `${value.toFixed(1)} tok/s`
    }

    /** Token count, compact above one thousand without a 1000.0k artefact. */
    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value >= 999_500) return `${(value / 1_000_000).toFixed(2)}M`
      if (value >= 9_950) return `${(value / 1000).toFixed(1)}k`
      return intl.format(value)
    }

    /** Clock time of one record. */
    function formatClock(at) {
      if (typeof at !== 'number') return '—'
      return new Date(at).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }

    /** Date and clock: the recent table can span up to 30 retained days. */
    function formatStamp(at) {
      if (typeof at !== 'number') return '—'
      const date = new Date(at)
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${month}-${day} ${formatClock(at)}`
    }

    /** Percent value from a 0..1 ratio; a tiny non-zero share stays visible. */
    function formatShare(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value > 0 && value < 0.005) return '<1%'
      return `${Math.round(value * 100)}%`
    }

    /** Percent value from a 0..1 success rate. */
    function formatPercent(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return `${(value * 100).toFixed(1)}%`
    }

    // ----------------------------------------------------------------- style

    const CSS = `
      .drs-page {
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        height: 100%;
        min-height: 0;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 20px;
      }
      .drs-head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 24px clamp(20px, 4vw, 40px) 12px;
      }
      .drs-heading { min-width: 0; }
      .drs-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
      .drs-sub { margin: 4px 0 0; max-width: 72ch; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
      .drs-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .drs-seg {
        display: inline-flex;
        padding: 2px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 9px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .drs-seg-btn {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        padding: 4px 10px;
        border-radius: 7px;
        cursor: pointer;
        white-space: nowrap;
      }
      .drs-seg-btn:hover { color: var(--dsw-alias-label-primary); }
      .drs-seg-btn[aria-pressed='true'] {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .drs-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
        padding: 5px 11px;
        border-radius: 8px;
        cursor: pointer;
        white-space: nowrap;
      }
      .drs-btn:hover { background: var(--dsw-alias-bg-layer-2); }
      .drs-btn:disabled { opacity: .55; cursor: default; }
      .drs-btn[data-tone='danger'] { color: var(--dsw-alias-state-error-primary); }
      .drs-btn[data-tone='danger']:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
      .drs-btn[data-busy='true'] svg { animation: drs-spin 0.9s linear infinite; }
      .drs-toggle[aria-pressed='true'] {
        background: var(--dsw-alias-bg-layer-2);
        border-color: var(--dsw-alias-border-l2);
      }
      @keyframes drs-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .drs-btn[data-busy='true'] svg { animation: none; }
      }
      .drs-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 4px clamp(20px, 4vw, 40px) 48px;
      }
      .drs-inner {
        display: flex;
        flex-direction: column;
        gap: 16px;
        width: 100%;
        max-width: 1040px;
        margin: 0 auto;
      }
      .drs-live {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--dsw-alias-state-success-primary);
      }
      .drs-dot {
        width: 7px; height: 7px;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent);
      }
      .drs-notice {
        display: flex;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .drs-notice[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, var(--dsw-alias-border-l1)); }
      .drs-notice[data-tone='error'] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, var(--dsw-alias-border-l1)); }
      .drs-notice svg { flex: none; margin-top: 1px; }
      .drs-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 12px;
      }
      .drs-kpi {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 14px 16px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .drs-kpi-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .drs-kpi-value { font-size: 24px; font-weight: 500; line-height: 32px; font-variant-numeric: tabular-nums; }
      .drs-kpi-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
      .drs-card {
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
        overflow: hidden;
      }
      .drs-card-head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 4px 12px;
        padding: 14px 16px 10px;
      }
      .drs-card-title { margin: 0; font-size: 14px; font-weight: 500; }
      .drs-card-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
      .drs-table-wrap { overflow-x: auto; }
      .drs-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
      .drs-table th {
        padding: 7px 12px;
        text-align: left;
        font-weight: 500;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1);
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        white-space: nowrap;
      }
      .drs-table th,
      .drs-table td { vertical-align: middle; }
      .drs-table td {
        padding: 8px 12px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        white-space: nowrap;
      }
      .drs-table tbody tr:last-child td { border-bottom: 0; }
      .drs-table tbody tr:hover td { background: var(--dsw-alias-bg-layer-2); }
      .drs-table th.drs-align-right,
      .drs-table td.drs-align-right { text-align: right; }
      .drs-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
      .drs-strong { font-weight: 500; }
      .drs-muted { color: var(--dsw-alias-label-secondary); }
      .drs-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 7px;
        border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 16px;
        white-space: nowrap;
      }
      .drs-chip[data-tone='ok'] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, var(--dsw-alias-border-l1)); }
      .drs-chip[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, var(--dsw-alias-border-l1)); }
      .drs-chip[data-tone='error'] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, var(--dsw-alias-border-l1)); }
      .drs-server { display: inline-flex; align-items: center; gap: 8px; vertical-align: middle; }
      .drs-bar {
        display: inline-block;
        position: relative;
        vertical-align: middle;
        width: 84px;
        height: 6px;
        border-radius: 999px;
        background: var(--dsw-alias-bg-layer-2);
        overflow: hidden;
      }
      .drs-bar > span {
        position: absolute;
        inset: 0 auto 0 0;
        border-radius: inherit;
        background: var(--dsw-alias-brand-primary);
        opacity: .75;
      }
      .drs-trends { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 4px 20px; padding: 0 16px 16px; }
      .drs-trend-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; padding-top: 6px; }
      .drs-trend-value { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
      .drs-trend svg { display: block; width: 100%; height: 84px; }
      .drs-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 56px 24px;
        text-align: center;
        color: var(--dsw-alias-label-secondary);
      }
      .drs-empty-title { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 500; }
      .drs-empty-hint { max-width: 46ch; font-size: 13px; line-height: 20px; }
      .drs-foot { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; padding-bottom: 8px; }
      .drs-share { display: flex; align-items: center; gap: 8px; min-width: 120px; }
      @media (prefers-reduced-motion: no-preference) {
        .drs-live .drs-dot { animation: drs-pulse 1.8s ease-in-out infinite; }
      }
      @keyframes drs-pulse {
        0%, 100% { box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent); }
        50% { box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 8%, transparent); }
      }
    `

    // ----------------------------------------------------------------- icons

    /** Sidebar entry glyph: three ascending latency bars over a baseline. */
    function PanelIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 18
      const color = props?.active === true ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M4 19.25h16', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', opacity: 0.4 }),
        h('rect', { x: 5.4, y: 12.2, width: 3.7, height: 4.6, rx: 1.2, fill: color, opacity: 0.5 }),
        h('rect', { x: 10.15, y: 8.6, width: 3.7, height: 8.2, rx: 1.2, fill: color, opacity: 0.75 }),
        h('rect', { x: 14.9, y: 4.9, width: 3.7, height: 11.9, rx: 1.2, fill: color }),
      )
    }

    /** Small inline alert glyph. */
    function AlertIcon(props) {
      const size = props?.size ?? 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', { d: 'M12 7.6v5.2', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('circle', { cx: 12, cy: 16.4, r: 1, fill: 'currentColor' }),
      )
    }

    /** Refresh glyph that spins while a manual refresh is running. */
    function RefreshIcon() {
      return h(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M19 12a7 7 0 1 1-2.05-4.95M19 4.5V9h-4.5',
          stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      )
    }

    // ------------------------------------------------------------ presentation

    /** One KPI tile. */
    function Kpi({ label, value, hint }) {
      return h(
        'div',
        { className: 'drs-kpi' },
        h('span', { className: 'drs-kpi-label' }, label),
        h('span', { className: 'drs-kpi-value' }, value),
        hint === undefined ? null : h('span', { className: 'drs-kpi-hint' }, hint),
      )
    }

    /** One labelled sparkline over the most recent measured requests. */
    function Trend({ t, values, kind }) {
      const gradientId = React.useId().replace(/:/g, '')
      const points = useMemo(() => {
        const seen = []
        for (const entry of values) {
          const value = entry[valueKey(kind)]
          if (typeof value === 'number' && Number.isFinite(value)) seen.push(value)
        }
        return seen
      }, [values, kind])
      const tone = kind === 'ttft' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-success-primary)'
      const label = kind === 'ttft' ? t('trendTtft') : t('trendTps')
      const latest = points.length === 0 ? undefined : points[points.length - 1]
      const rendered = points.length < 2
        ? h('div', { className: 'drs-muted', style: { fontSize: '12px', padding: '26px 0 34px' } }, t('trendEmpty'))
        : (() => {
            const width = 560
            const height = 84
            const pad = 6
            const min = Math.min(...points)
            const max = Math.max(...points)
            const span = max - min === 0 ? 1 : max - min
            const step = (width - pad * 2) / (points.length - 1)
            const coords = points.map((value, index) => {
              const x = pad + index * step
              const y = pad + (height - pad * 2) * (1 - (value - min) / span)
              return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]
            })
            const line = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
            const area = `${line} L${coords[coords.length - 1][0]} ${height - pad} L${coords[0][0]} ${height - pad} Z`
            return h(
              'svg',
              { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
              h('defs', null, h('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' },
                h('stop', { offset: '0', stopColor: tone, stopOpacity: '0.28' }),
                h('stop', { offset: '1', stopColor: tone, stopOpacity: '0' }),
              )),
              h('path', { d: area, fill: `url(#${gradientId})` }),
              h('path', { d: line, fill: 'none', stroke: tone, strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' }),
              h('circle', { cx: coords[coords.length - 1][0], cy: coords[coords.length - 1][1], r: 2.2, fill: tone }),
            )
          })()
      return h(
        'div',
        { className: 'drs-trend' },
        h('div', { className: 'drs-trend-head' },
          h('span', null, label),
          h('span', { className: 'drs-trend-value' },
            points.length === 0 ? '—' : kind === 'ttft' ? formatMs(latest) : formatRate(latest)),
        ),
        rendered,
        h('div', { className: 'drs-trend-head' },
          h('span', null, points.length === 0 ? '—' : t('trendMin', { value: bound(kind, Math.min(...points)) })),
          h('span', null, points.length === 0 ? '—' : t('trendMax', { value: bound(kind, Math.max(...points)) })),
        ),
      )
    }

    /** Chart series key for one trend kind. */
    function valueKey(kind) {
      return kind === 'ttft' ? 'ttftMs' : 'tps'
    }

    /** One trend bound in its own unit. */
    function bound(kind, value) {
      return kind === 'ttft' ? formatMs(value) : formatRate(value)
    }

    /** Status chip for one request row. */
    function StatusChip({ t, status }) {
      const spec = status === 'error'
        ? { tone: 'error', label: t('statusError') }
        : status === 'aborted'
          ? { tone: 'warn', label: t('statusAborted') }
          : { tone: 'ok', label: t('statusOk') }
      return h('span', { className: 'drs-chip', 'data-tone': spec.tone }, spec.label)
    }

    /** Server cell shared by the server and recent tables. */
    function ServerCell({ t, row }) {
      const label = row.ip !== undefined
        ? row.ip
        : row.colo !== undefined
          ? row.colo
          : t('unknownServer')
      const connection = row.connection === 'direct'
        ? h('span', { className: 'drs-chip', 'data-tone': 'ok' }, t('direct'))
        : row.connection === 'proxied'
          ? h('span', { className: 'drs-chip', 'data-tone': 'warn' }, t('proxied'))
          : null
      return h(
        'span',
        { className: 'drs-server' },
        h('span', { className: 'drs-mono' }, label),
        row.ip !== undefined && row.colo !== undefined
          ? h('span', { className: 'drs-chip' }, `${t('edge')} ${row.colo}`)
          : row.colo !== undefined
            ? h('span', { className: 'drs-chip' }, t('edge'))
            : null,
        connection,
      )
    }

    /** Empty state shown before the first request lands, or for an empty window. */
    function EmptyState({ t, scoped, onShowAll }) {
      return h(
        'div',
        { className: 'drs-card' },
        h(
          'div',
          { className: 'drs-empty' },
          h(PanelIcon, { size: 34, active: true }),
          h('div', { className: 'drs-empty-title' }, scoped ? t('emptyScope') : t('emptyTitle')),
          scoped
            ? h('button', { type: 'button', className: 'drs-btn', onClick: onShowAll }, t('showAll'))
            : h('div', { className: 'drs-empty-hint' }, t('emptyHint')),
        ),
      )
    }

    // --------------------------------------------------------------- data

    /**
     * Poll the Host ledger while the panel is mounted.
     * @param windowKey - selected history window.
     * @returns The latest summary, transport error, and a manual refresh.
     */
    function useLedger(windowKey, includeAuxiliary) {
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [refreshing, setRefreshing] = useState(false)
      const [nonce, setNonce] = useState(0)
      const alive = useRef(true)

      useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])

      useEffect(() => {
        const controller = new AbortController()
        let timer

        const load = async () => {
          if (typeof document !== 'undefined' && document.hidden) return
          try {
            const query = `window=${encodeURIComponent(windowKey)}&includeAux=${includeAuxiliary ? '1' : '0'}`
            const response = await fetch(`${BASE}/state?${query}`, {
              method: 'GET',
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
              signal: controller.signal,
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (body?.ok !== true) throw new Error(body?.message ?? 'read failed')
            if (!alive.current) return
            setData(body.value)
            setError(null)
          } catch (failure) {
            if (!alive.current || failure?.name === 'AbortError') return
            setError(failure?.message ?? String(failure))
          } finally {
            setRefreshing(false)
            if (alive.current) setLoading(false)
          }
        }

        void load()
        timer = setInterval(() => { void load() }, REFRESH_MS)
        const onVisible = () => { if (!document.hidden) void load() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          clearInterval(timer)
          controller.abort()
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [windowKey, includeAuxiliary, nonce])

      const refresh = useCallback(() => {
        setRefreshing(true)
        setNonce(value => value + 1)
      }, [])
      return { data, error, loading, refreshing, refresh }
    }

    // ------------------------------------------------------------ dashboard

    /** State container for the page: polling, clearing, and transient notices. */
    function Dashboard(props) {
      const t = typeof props?.t === 'function' ? props.t : key => key
      const [windowKey, setWindowKey] = useState('all')
      const [includeAuxiliary, setIncludeAuxiliary] = useState(false)
      const [clearing, setClearing] = useState(false)
      const [confirmClear, setConfirmClear] = useState(false)
      const [notice, setNotice] = useState(null)
      const { data, error, loading, refreshing, refresh } = useLedger(windowKey, includeAuxiliary)

      const clearRecords = useCallback(async () => {
        setClearing(true)
        try {
          const response = await fetch(`${BASE}/clear`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: '{}',
          })
          const body = await response.json().catch(() => undefined)
          if (!response.ok || body?.ok !== true) throw new Error(body?.message ?? `HTTP ${response.status}`)
          setNotice({ tone: 'ok', text: t('allClear') })
          setConfirmClear(false)
          refresh()
        } catch (failure) {
          setNotice({ tone: 'error', text: `${t('clearFailed')}: ${failure?.message ?? failure}` })
        } finally {
          setClearing(false)
        }
      }, [refresh, t])

      useEffect(() => {
        if (!confirmClear) return undefined
        const timer = setTimeout(() => setConfirmClear(false), 4000)
        return () => clearTimeout(timer)
      }, [confirmClear])

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), 4000)
        return () => clearTimeout(timer)
      }, [notice])

      return h(DashboardView, {
        t,
        data,
        error,
        loading,
        refreshing,
        notice,
        windowKey,
        includeAuxiliary,
        clearing,
        confirmClear,
        onWindow: setWindowKey,
        onToggleAux: () => setIncludeAuxiliary(value => !value),
        onRefresh: refresh,
        onClear: clearRecords,
        onRequestClear: () => setConfirmClear(true),
        onCancelClear: () => setConfirmClear(false),
      })
    }

    /**
     * Presentational dashboard: everything it shows arrives as props, so the
     * same tree renders from the Host summary and from a test fixture.
     */
    function DashboardView(props) {
      const t = typeof props?.t === 'function' ? props.t : key => key
      const {
        data, error, loading, refreshing, notice, windowKey, includeAuxiliary, clearing, confirmClear,
        onWindow, onToggleAux, onRefresh, onClear, onRequestClear, onCancelClear,
      } = props
      const totals = data?.totals
      const hasRecords = (totals?.requests ?? 0) > 0
      const canClear = (data?.retained ?? 0) > 0
      const proxied = data?.coverage?.proxied ?? 0
      const inFlight = totals?.inFlight ?? 0
      const live = data?.live ?? []
      const ttft = totals?.ttft
      const tps = totals?.tps

      const rangeButtons = WINDOWS.map(key => h(
        'button',
        {
          key,
          type: 'button',
          className: 'drs-seg-btn',
          'aria-pressed': windowKey === key,
          onClick: () => onWindow(key),
        },
        t(key === '1h' ? 'range1h' : key === '24h' ? 'range24h' : key === '7d' ? 'range7d' : 'rangeAll'),
      ))

      return h(
        'div',
        { className: 'drs-page' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'drs-head' },
          h(
            'div',
            { className: 'drs-heading' },
            h('h1', { className: 'drs-title' }, t('title')),
            h('p', { className: 'drs-sub' }, t('subtitle')),
          ),
          h(
            'div',
            { className: 'drs-actions' },
            inFlight > 0
              ? h(
                  'span',
                  {
                    className: 'drs-live',
                    title: live.map(entry => `${entry.model ?? ''} ${formatMs(entry.elapsedMs)}`).join('\n'),
                  },
                  h('span', { className: 'drs-dot' }),
                  `${t('live')} ${inFlight}`,
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'drs-btn drs-toggle',
                'aria-pressed': includeAuxiliary,
                onClick: onToggleAux,
                title: t('includeAux'),
              },
              t('includeAux'),
            ),
            h('div', { className: 'drs-seg', role: 'group', 'aria-label': t('range') }, rangeButtons),
            h(
              'button',
              {
                type: 'button',
                className: 'drs-btn',
                onClick: onRefresh,
                title: t('refresh'),
                'aria-busy': refreshing,
                'data-busy': refreshing ? 'true' : undefined,
              },
              h(RefreshIcon),
              t('refresh'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'drs-btn',
                'data-tone': 'danger',
                disabled: clearing || !canClear,
                onClick: () => {
                  if (clearing) return
                  if (confirmClear) onClear()
                  else onRequestClear()
                },
                title: confirmClear ? t('confirmClearTitle') : t('clear'),
              },
              clearing ? t('clearing') : confirmClear ? t('confirmClear') : t('clear'),
            ),
            confirmClear
              ? h('button', { type: 'button', className: 'drs-btn', onClick: onCancelClear }, t('cancel'))
              : null,
          ),
        ),
        h(
          'div',
          { className: 'drs-scroll' },
          h(
            'div',
            { className: 'drs-inner' },
            error === null
              ? null
              : h(
                  'div',
                  { className: 'drs-notice', 'data-tone': 'error', role: 'alert' },
                  h(AlertIcon),
                  h(
                    'span',
                    null,
                    `${t('failed')}: ${error}`,
                    String(error).includes('403') ? ` — ${t('forbiddenHint')}` : '',
                  ),
                  h('button', { type: 'button', className: 'drs-btn', onClick: onRefresh, style: { marginLeft: 'auto' } }, t('retry')),
                ),
            notice === null
              ? null
              : h(
                  'div',
                  { className: 'drs-notice', 'data-tone': notice.tone === 'error' ? 'error' : undefined, role: 'status' },
                  h('span', null, notice.text),
                ),
            proxied > 0
              ? h('div', { className: 'drs-notice', 'data-tone': 'warn' }, h(AlertIcon), h('span', null, t('proxyNotice', { count: proxied })))
              : null,
            data === null
              ? h('div', { className: 'drs-card' }, h('div', { className: 'drs-empty drs-muted' }, loading ? t('loading') : '—'))
              : !hasRecords
                ? h(EmptyState, {
                    t,
                    scoped: (data.retained ?? 0) > 0 && windowKey !== 'all',
                    onShowAll: () => onWindow('all'),
                  })
                : h(
                    React.Fragment,
                    null,
                    h(
                      'div',
                      { className: 'drs-kpis' },
                      h(Kpi, {
                        label: t('kpiRequests'),
                        value: intl.format(totals.requests),
                        hint: t('kpiRequestsHint', {
                          ok: totals.ok,
                          errors: totals.errors,
                          aborted: totals.aborted,
                          rate: formatPercent(totals.successRate),
                        }),
                      }),
                      h(Kpi, {
                        label: t('kpiTtft'),
                        value: formatMs(ttft?.avg),
                        hint: t('kpiTtftHint', { p50: formatMs(ttft?.p50), p90: formatMs(ttft?.p90) }),
                      }),
                      h(Kpi, {
                        label: t('kpiTps'),
                        value: formatRate(tps?.avg),
                        hint: t('kpiTpsHint', {
                          p50: formatRate(tps?.p50),
                          count: tps?.count ?? 0,
                          estimated: totals.estimatedSpeeds ?? 0,
                        }),
                      }),
                      h(Kpi, {
                        label: t('kpiTokens'),
                        value: formatTokens(totals.outputTokens),
                        hint: t('kpiTokensHint', { cache: formatTokens(totals.cacheReadTokens) }),
                      }),
                    ),
                    h(
                      'section',
                      { className: 'drs-card' },
                      h(
                        'div',
                        { className: 'drs-card-head' },
                        h('h2', { className: 'drs-card-title' }, t('servers')),
                        h('span', { className: 'drs-card-hint' }, t('serversHint')),
                      ),
                      h(
                        'div',
                        { className: 'drs-table-wrap' },
                        h(
                          'table',
                          { className: 'drs-table' },
                          h(
                            'thead',
                            null,
                            h(
                              'tr',
                              null,
                              h('th', { scope: 'col' }, t('colServer')),
                              h('th', { scope: 'col', className: 'drs-align-right' }, t('colRequests')),
                              h('th', { scope: 'col' }, t('colShare')),
                              h('th', { scope: 'col', className: 'drs-align-right' }, t('colTtft')),
                              h('th', { scope: 'col', className: 'drs-align-right' }, t('colTps')),
                              h('th', { scope: 'col', className: 'drs-align-right' }, t('colTokens')),
                              h('th', { scope: 'col', className: 'drs-align-right' }, t('colLast')),
                            ),
                          ),
                          h(
                            'tbody',
                            null,
                            (data.servers ?? []).map(row => h(
                              'tr',
                              { key: row.key },
                              h('td', null, h(ServerCell, { t, row })),
                              h('td', { className: 'drs-align-right drs-strong' }, intl.format(row.requests)),
                              h(
                                'td',
                                null,
                                h(
                                  'span',
                                  { className: 'drs-share' },
                                  h('span', { className: 'drs-bar' }, h('span', { style: { width: `${Math.max(2, Math.round(row.share * 100))}%` } })),
                                  h('span', { className: 'drs-muted' }, formatShare(row.share)),
                                ),
                              ),
                              h('td', { className: 'drs-align-right' }, formatMs(row.ttftAvg)),
                              h('td', { className: 'drs-align-right' }, formatRate(row.tpsAvg)),
                              h('td', { className: 'drs-align-right drs-muted' }, formatTokens(row.outputTokens)),
                              h('td', { className: 'drs-align-right drs-muted' }, formatClock(row.lastAt)),
                            )),
                          ),
                        ),
                      ),
                    ),
                    h(
                      'section',
                      { className: 'drs-card' },
                      h(
                        'div',
                        { className: 'drs-card-head' },
                        h('h2', { className: 'drs-card-title' }, t('trend')),
                        (data.series ?? []).length < 2
                          ? h('span', { className: 'drs-card-hint' }, t('trendEmpty'))
                          : null,
                      ),
                      h(
                        'div',
                        { className: 'drs-trends' },
                        h(Trend, { t, values: data.series ?? [], kind: 'ttft' }),
                        h(Trend, { t, values: data.series ?? [], kind: 'tps' }),
                      ),
                    ),
                    (data.models ?? []).length > 1
                      ? h(
                          'section',
                          { className: 'drs-card' },
                          h('div', { className: 'drs-card-head' }, h('h2', { className: 'drs-card-title' }, t('models'))),
                          h(
                            'div',
                            { className: 'drs-table-wrap' },
                            h(
                              'table',
                              { className: 'drs-table' },
                              h('thead', null, h(
                                'tr',
                                null,
                                h('th', { scope: 'col' }, t('colModel')),
                                h('th', { scope: 'col', className: 'drs-align-right' }, t('colRequests')),
                                h('th', { scope: 'col', className: 'drs-align-right' }, t('colTtft')),
                                h('th', { scope: 'col', className: 'drs-align-right' }, t('colTps')),
                                h('th', { scope: 'col', className: 'drs-align-right' }, t('colTokens')),
                                h('th', { scope: 'col', className: 'drs-align-right' }, t('colLast')),
                              )),
                              h(
                                'tbody',
                                null,
                                data.models.map(row => h(
                                  'tr',
                                  { key: row.key },
                                  h('td', null, h('span', { className: 'drs-strong' }, row.model), row.provider === undefined ? null : h('span', { className: 'drs-muted' }, ` · ${row.provider}`)),
                                  h('td', { className: 'drs-align-right' }, intl.format(row.requests)),
                                  h('td', { className: 'drs-align-right' }, formatMs(row.ttftAvg)),
                                  h('td', { className: 'drs-align-right' }, formatRate(row.tpsAvg)),
                                  h('td', { className: 'drs-align-right drs-muted' }, formatTokens(row.outputTokens)),
                                  h('td', { className: 'drs-align-right drs-muted' }, formatClock(row.lastAt)),
                                )),
                              ),
                            ),
                          ),
                        )
                      : null,
                    h(
                      'section',
                      { className: 'drs-card' },
                      h(
                        'div',
                        { className: 'drs-card-head' },
                        h('h2', { className: 'drs-card-title' }, t('recent')),
                        h('span', { className: 'drs-card-hint' }, t('recentScope', {
                          shown: (data.recent ?? []).length,
                          retained: data.retained ?? 0,
                        })),
                      ),
                      h(
                        'div',
                        { className: 'drs-table-wrap' },
                        h(
                          'table',
                          { className: 'drs-table' },
                          h('thead', null, h(
                            'tr',
                            null,
                            h('th', { scope: 'col' }, t('colTime')),
                            h('th', { scope: 'col' }, t('colModel')),
                            h('th', { scope: 'col' }, t('colServer')),
                            h('th', { scope: 'col', className: 'drs-align-right' }, t('colTtft')),
                            h('th', { scope: 'col', className: 'drs-align-right' }, t('colTps')),
                            h('th', { scope: 'col', className: 'drs-align-right' }, t('colTokens')),
                            h('th', { scope: 'col' }, t('colStatus')),
                          )),
                          h(
                            'tbody',
                            null,
                            (data.recent ?? []).map(record => h(
                              'tr',
                              { key: record.id },
                              h('td', { className: 'drs-mono drs-muted' }, formatStamp(record.at)),
                              h(
                                'td',
                                null,
                                h('span', { className: 'drs-strong' }, record.model ?? '—'),
                                record.purpose === undefined
                                  ? null
                                  : h('span', { className: 'drs-chip', style: { marginLeft: '8px' }, title: t('colPurpose') }, record.purpose),
                              ),
                              h('td', null, h(ServerCell, { t, row: record })),
                              h('td', { className: 'drs-align-right' }, formatMs(record.ttftMs)),
                              h('td', { className: 'drs-align-right' }, formatRate(record.tps)),
                              h('td', { className: 'drs-align-right drs-muted' }, formatTokens(record.outputTokens)),
                              h('td', null, h(StatusChip, { t, status: record.status })),
                            )),
                          ),
                        ),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'drs-foot' },
                      h(
                        'div',
                        null,
                        t('watched', {
                          providers: (data.watched?.providers ?? []).join(', ') || '—',
                          hosts: (data.watched?.hosts ?? []).join(', ') || '—',
                        }),
                      ),
                      (data.auxiliary ?? 0) > 0
                        ? h(
                            'div',
                            null,
                            t(includeAuxiliary ? 'auxiliaryIncluded' : 'auxiliaryExcluded', { count: data.auxiliary }),
                          )
                        : null,
                      (data.coverage?.edge ?? 0) > 0 ? h('div', null, t('edgeNotice')) : null,
                      h('div', null, t('privacy')),
                    ),
                  ),
          ),
        ),
      )
    }

    return {
      name: 'dsh-request-stats',
      inject: ['slots', 'locale'],
      // Test seam: the presentational page renders without a Host; the module
      // loader ignores members it does not consume.
      __test: { DashboardView, PanelIcon, en, zh },
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-request-stats: dictionaries')
        const t = ctx.locale.bind(NS)

        // A global panel: the sidebar entry selects it and the main column
        // renders the dashboard under the same id.
        ctx.slots.inject('main', function* () {
          yield ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            locale: NS,
          }, Dashboard)
        })

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 30,
          label: () => t('panel'),
          locale: NS,
        }, PanelIcon))
      },
    }
  },
})
