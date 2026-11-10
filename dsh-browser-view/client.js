window.__ModuleLoader__.load({
  id: 'dsh-browser-view',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Tab type identity; the Host half hardcodes nothing about it. */
    const TAB_ID = 'dsh-browser-view'
    /** Locale namespace registered for this plugin's copy. */
    const NS = 'dsh-browser-view'
    /** Host route serving one JPEG frame per poll; the Host half declares the same path. */
    const FRAME_PATH = 'api/browser-view'
    /** Fallback poll spacing when the Host reports none. */
    const FALLBACK_INTERVAL = 1000

    const dictionaries = {
      en: {
        title: 'Browser view',
        guideTitle: 'Browser view',
        guideDescription: 'Live view of the agent\'s browser',
        empty: 'The agent has not opened a browser in this session yet.',
        emptyHint: 'Ask it to browse something, and this tab follows along.',
        waiting: 'Waiting for the first frame…',
        stopped: 'Live view paused.',
        resume: 'Resume',
        pause: 'Pause',
        refresh: 'Refresh now',
        page: 'Page {id}',
        pageCount: '{count} pages',
        fps: 'Every {seconds}s',
        error: 'Could not read the browser: {reason}',
      },
      zh: {
        title: '浏览器画面',
        guideTitle: '浏览器画面',
        guideDescription: 'agent 浏览器的实时画面',
        empty: '本会话里 agent 还没有打开过浏览器。',
        emptyHint: '让它去浏览点什么，这个标签页就会跟上来。',
        waiting: '正在等待第一帧…',
        stopped: '实时画面已暂停。',
        resume: '继续',
        pause: '暂停',
        refresh: '立即刷新',
        page: '页面 {id}',
        pageCount: '{count} 个页面',
        fps: '每 {seconds}s 一帧',
        error: '读取浏览器失败：{reason}',
      },
    }

    const styles = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
      },
      bar: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderBottom: '0.5px solid var(--dsw-alias-border-l1)',
        fontSize: 11,
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-secondary)',
        flex: 'none',
      },
      dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        flex: 'none',
      },
      status: {
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      button: {
        appearance: 'none',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-secondary)',
        borderRadius: 4,
        padding: '2px 8px',
        font: 'inherit',
        fontSize: 11,
        lineHeight: '16px',
        cursor: 'pointer',
        flex: 'none',
      },
      stage: {
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'auto',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      shot: {
        display: 'block',
        maxWidth: '100%',
        maxHeight: '100%',
        width: 'auto',
        height: 'auto',
        objectFit: 'contain',
      },
      notice: {
        padding: '24px 20px',
        textAlign: 'center',
        fontSize: 12,
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      error: {
        padding: '24px 20px',
        textAlign: 'center',
        fontSize: 12,
        lineHeight: '18px',
        color: 'var(--dsw-alias-state-error-primary)',
        wordBreak: 'break-word',
      },
      hint: {
        marginTop: 6,
        opacity: 0.8,
      },
    }

    /**
     * Decode the Host's URI-encoded diagnostic.
     * @param {string | null} value - Header value.
     * @returns {string | undefined} Readable reason.
     */
    function decodeError(value) {
      if (value === null) return undefined
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }

    /**
     * Read one frame from the Host route.
     * @param {string} sessionId - Session whose browser is captured.
     * @param {boolean} force - Skip the Host's frame cache.
     * @param {AbortSignal} signal - Caller cancellation.
     * @returns {Promise<{url?: string, meta: object}>} An object URL for the frame plus state.
     */
    async function fetchFrame(sessionId, force, signal) {
      const query = `session=${encodeURIComponent(sessionId)}${force ? '&force=1' : ''}`
      const response = await fetch(`${FRAME_PATH}?${query}`, { signal, headers: { accept: 'image/jpeg' } })
      const meta = {
        state: response.headers.get('x-bv-state') ?? 'error',
        at: Number(response.headers.get('x-bv-at') ?? 0),
        pages: Number(response.headers.get('x-bv-pages') ?? 0),
        page: response.headers.get('x-bv-page'),
        intervalMs: Number(response.headers.get('x-bv-interval') ?? 0),
        error: decodeError(response.headers.get('x-bv-error')),
      }
      if (meta.state !== 'live') return { meta }
      const blob = await response.blob()
      return { url: URL.createObjectURL(blob), meta }
    }

    /**
     * Poll spacing for the next request, honoring the Host's configured value.
     * @param {object | undefined} meta - Last frame state.
     * @returns {number} Delay in milliseconds.
     */
    function intervalOf(meta) {
      const interval = Number(meta?.intervalMs ?? 0)
      return interval > 0 ? Math.max(250, interval) : FALLBACK_INTERVAL
    }

    /**
     * The one-line status shown above the frame.
     * @param {{live: boolean, paused: boolean, meta: object, t: Function}} input - Current state.
     * @returns {string} Localized status line.
     */
    function statusText({ live, paused, meta, t }) {
      if (paused) return t('stopped')
      if (meta.state === 'error') return t('error', { reason: meta.error ?? '—' })
      if (meta.state === 'waiting' || meta.state === undefined) return t('waiting')
      if (!live) return t('empty')
      const parts = []
      if (meta.page !== null && meta.page !== undefined) parts.push(t('page', { id: meta.page }))
      if (meta.pages > 0) parts.push(t('pageCount', { count: meta.pages }))
      parts.push(t('fps', { seconds: (intervalOf(meta) / 1000).toFixed(1) }))
      return parts.join(' · ')
    }

    /**
     * The Browser view tab body: polls the Host for frames while the tab is visible.
     * @param {{sessionId: string, useTabInfo: () => object, t: (key: string, params?: object) => string}} props - Slot props.
     * @returns {object} React element tree.
     */
    function BrowserViewBody(props) {
      const { sessionId, useTabInfo, t } = props
      const visible = useTabInfo().tab.visible
      const [frame, setFrame] = React.useState({ meta: { state: 'waiting' } })
      const [paused, setPaused] = React.useState(false)
      const [nonce, setNonce] = React.useState(0)
      const urlRef = React.useRef(undefined)
      const intervalRef = React.useRef(FALLBACK_INTERVAL)

      React.useEffect(() => {
        if (!visible || paused) return undefined
        const controller = new AbortController()
        let timer
        let disposed = false

        const settle = (next) => {
          intervalRef.current = intervalOf(next.meta)
          if (next.url !== undefined) {
            if (urlRef.current !== undefined) URL.revokeObjectURL(urlRef.current)
            urlRef.current = next.url
          }
          setFrame(next)
        }

        const tick = async (force) => {
          try {
            const next = await fetchFrame(sessionId, force, controller.signal)
            if (disposed) {
              if (next.url !== undefined) URL.revokeObjectURL(next.url)
              return
            }
            settle(next)
          } catch (error) {
            if (disposed || controller.signal.aborted) return
            setFrame((current) => ({
              ...current,
              meta: { ...current.meta, state: 'error', error: String(error?.message ?? error) },
            }))
          } finally {
            if (!disposed) timer = setTimeout(() => { void tick(false) }, intervalRef.current)
          }
        }

        void tick(nonce !== 0)
        return () => {
          disposed = true
          clearTimeout(timer)
          controller.abort()
        }
      }, [sessionId, visible, paused, nonce])

      React.useEffect(() => () => {
        if (urlRef.current !== undefined) URL.revokeObjectURL(urlRef.current)
        urlRef.current = undefined
      }, [])

      const meta = frame.meta
      const live = meta.state === 'live'
      const dotColor = paused
        ? 'var(--dsw-alias-state-idle-primary)'
        : live
          ? 'var(--dsw-alias-state-success-primary)'
          : 'var(--dsw-alias-state-warn-primary)'

      let stage
      if (paused) {
        stage = h('div', { style: styles.notice }, t('stopped'))
      } else if (meta.state === 'error') {
        stage = h('div', { style: styles.error }, t('error', { reason: meta.error ?? '—' }))
      } else if (frame.url !== undefined) {
        stage = h('img', { src: frame.url, alt: t('title'), style: styles.shot, draggable: false })
      } else if (meta.state === 'waiting') {
        stage = h('div', { style: styles.notice }, t('waiting'))
      } else {
        stage = h('div', { style: styles.notice },
          h('div', null, t('empty')),
          h('div', { style: styles.hint }, t('emptyHint')))
      }

      return h('div', { style: styles.root, 'data-browser-view': paused ? 'paused' : meta.state },
        h('div', { style: styles.bar },
          h('span', { style: { ...styles.dot, background: dotColor }, 'aria-hidden': true }),
          h('span', { style: styles.status }, statusText({ live, paused, meta, t })),
          h('button', {
            type: 'button',
            style: styles.button,
            onClick: () => { setPaused((value) => !value) },
          }, paused ? t('resume') : t('pause')),
          h('button', {
            type: 'button',
            style: styles.button,
            onClick: () => { setNonce((value) => value + 1) },
          }, t('refresh')),
        ),
        h('div', { style: styles.stage, 'data-browser-view-stage': true }, stage),
      )
    }

    /**
     * The tab chip's live title.
     * @param {{t: Function}} props - Slot props.
     * @returns {string} Title text.
     */
    function BrowserViewTitle(props) {
      return props.t('title')
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-browser-view: copy')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_ID,
          title: () => ctx.locale.bind(NS)('title'),
          guide: [{
            id: 'main',
            order: 60,
            title: () => ctx.locale.bind(NS)('guideTitle'),
            description: () => ctx.locale.bind(NS)('guideDescription'),
          }],
        }), 'dsh-browser-view: tab type')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NS,
        }, BrowserViewBody)), 'dsh-browser-view: tab body')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID,
          locale: NS,
        }, BrowserViewTitle)), 'dsh-browser-view: tab title')
      },
    }
  },
})
