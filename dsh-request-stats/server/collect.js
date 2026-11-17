/**
 * Transport + timing capture for `dsh-request-stats`.
 *
 * Two observations are joined per model call:
 *
 * - **Timing.** A `llm/stream` waterfall listener wraps the adapter's
 *   `AsyncIterable<StreamChunk>` and records first-token latency and output
 *   speed from the chunks it forwards. It always returns an iterable and never
 *   changes a chunk, so a failure here can only lose a measurement.
 * - **Transport.** undici publishes every dispatch on process-wide diagnostics
 *   channels. An `AsyncLocalStorage` scope opened around each pull of the
 *   adapter stream is what ties a connection's peer address and the response's
 *   `cf-ray` edge to that exact call, so concurrent Sessions never mix.
 *
 * The proxy is explicit in the result: behind an HTTP proxy the socket peer is
 * the proxy, which is recorded as `connection: 'proxied'` instead of pretending
 * a remote server IP was observed.
 *
 * @module dsh-request-stats/server/collect
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { channel } from 'node:diagnostics_channel'

/** Chunk types that carry generated content and therefore end the wait for a first token. */
const CONTENT_CHUNKS = new Set(['text-delta', 'reasoning-delta', 'tool-call-delta'])

/** How long a resolved name list is reused for the `dns` field. */
const DNS_TTL_MS = 60_000

/** How long the last observed peer for one host is reused for pooled sockets. */
const PEER_TTL_MS = 30 * 60_000

/** Milliseconds with at most one decimal, rounding sub-100 values finer. */
function ms(value) {
  if (!Number.isFinite(value) || value < 0) return undefined
  return value < 100 ? Math.round(value * 10) / 10 : Math.round(value)
}

/** Tokens per second to one decimal. */
function rate(tokens, windowMs) {
  if (!Number.isFinite(tokens) || !Number.isFinite(windowMs) || windowMs <= 0) return undefined
  return Math.round((tokens / (windowMs / 1000)) * 10) / 10
}

function text(value, max) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined
}

/** Normalize one configured host entry (case, leading dot, optional port). */
function normalizeHost(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().toLowerCase()
  if (trimmed.length === 0) return undefined
  const withoutScheme = trimmed.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '')
  const host = withoutScheme.replace(/^\./, '').split(':')[0]
  return host.length > 0 ? host : undefined
}

/** Whether a host equals one of the configured targets or is a subdomain of one. */
function matchesHost(host, targets) {
  if (typeof host !== 'string' || host.length === 0) return false
  const value = host.toLowerCase()
  return targets.some(target => value === target || value.endsWith(`.${target}`))
}

/** Hostname of a request origin without throwing on malformed input. */
function hostOfOrigin(origin) {
  if (typeof origin !== 'string') return undefined
  try {
    return new URL(origin).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/** Decode one raw header cell: undici publishes Buffers, other callers strings. */
function headerText(value) {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8')
  return undefined
}

/** Read one response header from a Headers instance, a plain object, or undici's raw pairs. */
function headerValue(headers, name) {
  if (headers === null || headers === undefined) return undefined
  try {
    if (typeof headers.get === 'function') {
      const found = headers.get(name)
      return typeof found === 'string' ? found : undefined
    }
    if (Array.isArray(headers)) {
      // undici's diagnostics message carries raw header cells as a flat array:
      // [name, value, name, value, ...], each possibly a Buffer.
      if (!headers.some(cell => Array.isArray(cell))) {
        for (let index = 0; index + 1 < headers.length; index += 2) {
          const key = headerText(headers[index])
          if (key !== undefined && key.toLowerCase() === name) return headerText(headers[index + 1])
        }
      }
      for (const entry of headers) {
        if (!Array.isArray(entry)) continue
        const key = headerText(entry[0])
        if (key !== undefined && key.toLowerCase() === name) return headerText(entry[1])
      }
      return undefined
    }
    if (typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === name) return headerText(value)
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

/** Loopback or link-local spellings that can only be a local proxy. */
function isLocalAddress(address) {
  if (typeof address !== 'string') return false
  const clean = address.startsWith('::ffff:') ? address.slice(7) : address
  return clean === '::1' || clean === '::ffff:127.0.0.1' || clean.startsWith('127.') || clean.startsWith('fe80:')
}

/** Configured proxy endpoints, for recognizing the socket peer as a proxy. */
function parseProxyTargets(env) {
  const targets = []
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    const raw = env?.[name]
    if (typeof raw !== 'string' || raw.trim().length === 0) continue
    try {
      const url = new URL(raw.trim())
      const port = url.port.length > 0 ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
      targets.push({ host: url.hostname.toLowerCase(), port })
    } catch {
      // A malformed proxy value is undici's problem, not this plugin's.
    }
  }
  return targets
}

/**
 * Install the transport and timing capture.
 * @param options - the ledger to append to, the routes to watch, and clocks.
 * @returns The collector handle: activation, in-flight view, and disposal.
 */
export function createCollector({
  store,
  providers = ['opencode-go'],
  hosts = ['opencode.ai'],
  env = process.env,
  now = Date.now,
  monotonic = () => performance.now(),
} = {}) {
  const als = new AsyncLocalStorage()
  const inflightBysRequest = new WeakMap()
  const active = new Map()
  const targets = hosts.map(normalizeHost).filter(target => target !== undefined)
  const providerSet = new Set(providers.map(value => String(value).toLowerCase()))
  const proxies = parseProxyTargets(env)
  const dnsCache = new Map()
  const peerByHost = new Map()
  const subscriptions = []
  let armed = false

  const watchesHost = host => matchesHost(host, targets)
  const recordsProvider = provider => providerSet.size === 0 || providerSet.has(String(provider ?? '').toLowerCase())

  /** Whether the socket peer belongs to a configured proxy. */
  function viaProxy(address, port) {
    if (!isLocalAddress(address)) return false
    if (proxies.length === 0) return true
    return proxies.some(proxy => proxy.host === address && (port === undefined || proxy.port === port))
  }

  /** Refresh the DNS answers for one endpoint host in the background. */
  function warmDns(host) {
    const cached = dnsCache.get(host)
    if (cached !== undefined && (cached.pending || now() - cached.at < DNS_TTL_MS)) return
    const pending = dns.lookup(host, { all: true })
      .then(list => {
        dnsCache.set(host, { at: now(), addresses: list.map(entry => entry.address).slice(0, 8) })
      })
      .catch(() => {
        dnsCache.set(host, { at: now(), addresses: cached?.addresses ?? [] })
      })
    dnsCache.set(host, { at: cached?.at ?? 0, addresses: cached?.addresses ?? [], pending: true })
    void pending
  }

  function subscribe(name, listener) {
    const diagnostics = channel(name)
    const guarded = message => {
      try {
        listener(message)
      } catch {
        // A diagnostics listener must never disturb the request it observes.
      }
    }
    diagnostics.subscribe(guarded)
    subscriptions.push(() => {
      try {
        diagnostics.unsubscribe(guarded)
      } catch {
        // Already gone.
      }
    })
  }

  function onRequestCreate(message) {
    const call = als.getStore()
    if (call === undefined || call.settled) return
    const request = message?.request
    const origin = typeof request?.origin === 'string' ? request.origin : undefined
    const host = hostOfOrigin(origin)
    if (host === undefined || !watchesHost(host)) return
    call.record.endpoint = { host, path: text(request.path, 200) }
    warmDns(host)
    // Remember the request object so later channel messages can find this call
    // even when their callback runs outside the stream's async scope.
    if (request !== null && typeof request === 'object') inflightBysRequest.set(request, call)
    // A pooled socket publishes no new `connected` event: attribute the last
    // peer seen for this host, flagged as an inference rather than an observation.
    if (call.record.ip === undefined && call.record.connection === 'unknown') {
      const peer = peerByHost.get(host)
      if (peer !== undefined && now() - peer.at < PEER_TTL_MS) {
        call.record.connection = peer.connection
        call.record.ip = peer.ip
        call.record.ipPort = peer.port
        call.record.ipSource = 'pool'
        call.record.proxy = peer.proxy
      }
    }
  }

  function onClientConnected(message) {
    const call = als.getStore()
    const params = message?.connectParams
    const hostname = typeof params?.hostname === 'string' ? params.hostname.toLowerCase() : undefined
    if (hostname === undefined || !watchesHost(hostname)) return
    const socket = message?.socket
    const address = typeof socket?.remoteAddress === 'string' ? socket.remoteAddress : undefined
    if (address === undefined) return
    const port = typeof socket?.remotePort === 'number' ? socket.remotePort : undefined
    const proxied = viaProxy(address, port)
    const peer = {
      connection: proxied ? 'proxied' : 'direct',
      ip: proxied ? undefined : address,
      port,
      proxy: proxied ? `${address}${port === undefined ? '' : `:${port}`}` : undefined,
      at: now(),
    }
    peerByHost.set(hostname, peer)
    if (call === undefined || call.settled) return
    call.record.connection = peer.connection
    call.record.ip = peer.ip
    call.record.ipPort = peer.port
    call.record.ipSource = 'connect'
    call.record.proxy = peer.proxy
  }

  function onRequestHeaders(message) {
    const request = message?.request
    const call = (request !== null && typeof request === 'object' ? inflightBysRequest.get(request) : undefined)
      ?? als.getStore()
    if (call === undefined || call.settled) return
    const headers = message?.response?.headers
    const ray = headerValue(headers, 'cf-ray')
    const server = headerValue(headers, 'server')
    if (ray !== undefined) call.record.ray = ray
    if (server !== undefined) call.record.server = server
    const colo = typeof ray === 'string' && ray.includes('-') ? ray.slice(ray.lastIndexOf('-') + 1) : undefined
    if (colo !== undefined && /^[a-z]{3}$/i.test(colo)) call.record.colo = colo.toUpperCase()
  }

  function onRequestError(message) {
    const request = message?.request
    const call = (request !== null && typeof request === 'object' ? inflightBysRequest.get(request) : undefined)
      ?? als.getStore()
    if (call === undefined || call.settled) return
    const error = message?.error
    const code = text(error?.code, 64)
    const textMessage = text(error?.message ?? String(error ?? ''), 300)
    call.transportFailure = { code, message: textMessage }
  }

  /** Build the record skeleton for one call. */
  function openCall(options) {
    const record = {
      id: randomUUID(),
      at: now(),
      provider: text(options.provider, 80),
      model: text(options.model, 120),
      purpose: text(options.purpose, 80),
      sessionId: options.sessionId === undefined ? undefined : text(String(options.sessionId), 120),
      status: 'ok',
      connection: 'unknown',
    }
    const call = {
      record,
      startedMono: monotonic(),
      firstMono: undefined,
      lastChunkMono: undefined,
      finishMono: undefined,
      chars: 0,
      usage: undefined,
      finish: undefined,
      transportFailure: undefined,
      settled: false,
    }
    active.set(record.id, call)
    return call
  }

  function observe(call, chunk) {
    if (chunk === null || typeof chunk !== 'object') return
    const at = monotonic()
    call.lastChunkMono = at
    switch (chunk.type) {
      case 'text-delta':
      case 'reasoning-delta':
      case 'tool-call-delta': {
        if (CONTENT_CHUNKS.has(chunk.type) && call.firstMono === undefined) call.firstMono = at
        if (typeof chunk.text === 'string') call.chars += chunk.text.length
        else if (typeof chunk.argumentsDelta === 'string') call.chars += chunk.argumentsDelta.length
        break
      }
      case 'usage': {
        if (chunk.usage !== null && typeof chunk.usage === 'object') call.usage = chunk.usage
        break
      }
      case 'finish': {
        call.finish = chunk.reason
        call.finishMono = at
        break
      }
      default:
        break
    }
  }

  function settle(call, thrown, stoppedEarly) {
    if (call.settled) return
    call.settled = true
    active.delete(call.record.id)
    const record = call.record
    const endMono = call.finishMono ?? call.lastChunkMono ?? monotonic()
    record.totalMs = ms(endMono - call.startedMono)
    if (call.firstMono !== undefined) {
      record.ttftMs = ms(call.firstMono - call.startedMono)
      record.decodeMs = ms(endMono - call.firstMono)
    }
    const usage = call.usage
    if (usage !== undefined) {
      if (Number.isFinite(usage.outputTokens)) record.outputTokens = usage.outputTokens
      if (Number.isFinite(usage.inputTokens)) record.inputTokens = usage.inputTokens
      if (Number.isFinite(usage.cacheReadTokens)) record.cacheReadTokens = usage.cacheReadTokens
    }
    if (record.outputTokens !== undefined) {
      record.tps = rate(record.outputTokens, record.decodeMs)
    } else if (call.chars > 0 && record.decodeMs !== undefined && record.decodeMs > 0) {
      // No provider usage: estimate from streamed content so speed still has a
      // shape, and say so instead of passing the estimate off as measured.
      const estimated = Math.max(1, Math.round(call.chars / 4))
      record.outputTokens = estimated
      record.tpsEstimated = true
      record.tps = rate(estimated, record.decodeMs)
    }

    if (thrown !== undefined) {
      // An adapter that throws mid-stream failed the call; a caller abort is
      // the only thrown outcome that is not an error.
      const abortLike = thrown?.name === 'AbortError' || thrown?.code === 'ABORTED'
      record.status = abortLike ? 'aborted' : 'error'
      record.failure = call.transportFailure ?? {
        code: text(thrown?.code ?? thrown?.name, 64),
        message: text(thrown?.message ?? String(thrown), 300),
      }
    } else if (call.finish !== undefined && typeof call.finish === 'object') {
      const kind = call.finish.kind
      record.finishKind = text(kind, 40)
      if (kind === 'error') {
        record.status = 'error'
        record.failure = {
          code: text(call.finish.failure?.code, 64),
          message: text(call.finish.failure?.message, 300),
        }
      } else if (kind === 'aborted') {
        record.status = 'aborted'
        record.failure = {
          code: text(call.finish.failure?.code, 64),
          message: text(call.finish.failure?.message, 300),
        }
      }
    } else if (stoppedEarly) {
      record.status = 'aborted'
      record.finishKind = 'cancelled'
    }

    const cached = record.endpoint?.host === undefined ? undefined : dnsCache.get(record.endpoint.host)
    if (cached !== undefined && cached.addresses.length > 0) record.dns = cached.addresses.slice()
    try {
      store.add(record)
    } catch {
      // The measurement is best-effort by contract.
    }
  }

  /** Wrap one adapter stream: forward every chunk, measure around it. */
  function track(call, source) {
    return (async function* measured() {
      const iterator = source[Symbol.asyncIterator]()
      let completed = false
      let thrown
      try {
        while (true) {
          const step = await als.run(call, () => iterator.next())
          if (step.done === true) {
            completed = true
            break
          }
          observe(call, step.value)
          yield step.value
        }
      } catch (error) {
        thrown = error
        throw error
      } finally {
        settle(call, thrown, thrown === undefined && !completed)
      }
    })()
  }

  return {
    /** Subscribe to the diagnostics channels; returns the disposer. */
    start() {
      if (armed) return () => {}
      armed = true
      subscribe('undici:request:create', onRequestCreate)
      subscribe('undici:request:headers', onRequestHeaders)
      subscribe('undici:request:error', onRequestError)
      subscribe('undici:client:connected', onClientConnected)
      return () => {
        armed = false
        for (const dispose of subscriptions.splice(0)) dispose()
      }
    },

    /**
     * The `llm/stream` waterfall listener.
     * @param options - the request being dispatched.
     * @param next - the downstream stream factory.
     * @returns The downstream iterable, measured when the call is eligible.
     */
    handleStream(options, next) {
      if (!recordsProvider(options?.provider)) return next()
      let call
      let source
      try {
        call = openCall(options)
        source = next()
      } catch (error) {
        if (call !== undefined) settle(call, error, false)
        throw error
      }
      if (source === null || source === undefined || typeof source[Symbol.asyncIterator] !== 'function') {
        settle(call, undefined, false)
        return source
      }
      return track(call, source)
    },

    /** Model calls currently streaming, for the panel's live counter. */
    inFlight() {
      return [...active.values()].map(call => ({
        model: call.record.model,
        provider: call.record.provider,
        startedAt: call.record.at,
        elapsedMs: ms(monotonic() - call.startedMono),
      }))
    },

    /** Unsubscribe from every diagnostics channel. */
    dispose() {
      for (const dispose of subscriptions.splice(0)) dispose()
      armed = false
    },
  }
}
