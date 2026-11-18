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
import { channel } from 'node:diagnostics_channel'
import { promises as dns } from 'node:dns'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type {
  FailureInfo,
  LiveCall,
  RequestRecord,
} from '../shared/types.ts'

/** Chunk types that carry generated content and therefore end the wait for a first token. */
const CONTENT_CHUNKS = new Set(['text-delta', 'reasoning-delta', 'tool-call-delta'])

/** How long a resolved name list is reused for the `dns` field. */
const DNS_TTL_MS = 60_000

/** How long the last observed peer for one host is reused for pooled sockets. */
const PEER_TTL_MS = 30 * 60_000

/** The slice of the environment this module reads; `process.env` satisfies it. */
export type Environment = Readonly<Record<string, string | undefined>>

/** Milliseconds with at most one decimal, rounding sub-100 values finer. */
function ms(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined
  return value < 100 ? Math.round(value * 10) / 10 : Math.round(value)
}

/** Tokens per second to one decimal. */
function rate(tokens: number, windowMs: number | undefined): number | undefined {
  if (!Number.isFinite(tokens) || windowMs === undefined || !Number.isFinite(windowMs) || windowMs <= 0) return undefined
  return Math.round((tokens / (windowMs / 1000)) * 10) / 10
}

/** Bounded non-empty text, or `undefined`. */
function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined
}

/** One property of a possibly-absent object, mirroring `value?.key`. */
function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

/** One string property of a possibly-absent object. */
function readText(value: unknown, key: string): string | undefined {
  const found = field(value, key)
  return typeof found === 'string' ? found : undefined
}

/** One number property of a possibly-absent object. */
function readNumber(value: unknown, key: string): number | undefined {
  const found = field(value, key)
  return typeof found === 'number' ? found : undefined
}

/** Normalize one configured host entry (case, leading dot, optional port). */
function normalizeHost(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().toLowerCase()
  if (trimmed.length === 0) return undefined
  const withoutScheme = trimmed.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '')
  const host = withoutScheme.replace(/^\./, '').split(':')[0]
  return host.length > 0 ? host : undefined
}

/** Whether a host equals one of the configured targets or is a subdomain of one. */
function matchesHost(host: unknown, targets: readonly string[]): boolean {
  if (typeof host !== 'string' || host.length === 0) return false
  const value = host.toLowerCase()
  return targets.some(target => value === target || value.endsWith(`.${target}`))
}

/** Hostname of a request origin without throwing on malformed input. */
function hostOfOrigin(origin: unknown): string | undefined {
  if (typeof origin !== 'string') return undefined
  try {
    return new URL(origin).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/** Decode one raw header cell: undici publishes Buffers, other callers strings. */
function headerText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8')
  return undefined
}

/** Read one response header from a Headers instance, a plain object, or undici's raw pairs. */
function headerValue(headers: unknown, name: string): string | undefined {
  if (headers === null || headers === undefined) return undefined
  try {
    const getter = field(headers, 'get')
    if (typeof getter === 'function') {
      const found: unknown = (getter as (this: unknown, header: string) => unknown).call(headers, name)
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
function isLocalAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false
  const clean = address.startsWith('::ffff:') ? address.slice(7) : address
  return clean === '::1' || clean === '::ffff:127.0.0.1' || clean.startsWith('127.') || clean.startsWith('fe80:')
}

/** One configured proxy endpoint. */
interface ProxyTarget {
  /** Lower-cased proxy hostname. */
  host: string
  /** Proxy port. */
  port: number
}

/** Configured proxy endpoints, for recognizing the socket peer as a proxy. */
function parseProxyTargets(env: Environment | undefined): ProxyTarget[] {
  const targets: ProxyTarget[] = []
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

/** The slice of one `llm/stream` request this collector reads. */
export interface StreamOptionsLike {
  /** Registered provider route selecting the adapter instance. */
  provider?: unknown
  /** Model id. */
  model?: unknown
  /** Auxiliary request purpose, when the call is auxiliary. */
  purpose?: unknown
  /** Session identity stamped by the loop. */
  sessionId?: unknown
}

/** The ledger capability the collector needs. */
export interface CollectorStore {
  /** Append one finished record. */
  add(record: RequestRecord): void
}

/** Options for {@link createCollector}. */
export interface CollectorOptions {
  /** The ledger to append to. */
  store: CollectorStore
  /** Provider routes to record; an empty list records every provider. */
  providers?: readonly string[]
  /** Endpoint hosts to watch. */
  hosts?: readonly string[]
  /** Environment used to recognize a configured proxy. */
  env?: Environment
  /** Wall clock for record timestamps. */
  now?: () => number
  /** Monotonic clock for the timings. */
  monotonic?: () => number
}

/** One in-flight model call, from the first pull to the last chunk. */
interface CallState {
  /** The record being filled in. */
  record: RequestRecord
  /** `monotonic()` at request start. */
  startedMono: number
  /** `monotonic()` of the first content chunk. */
  firstMono: number | undefined
  /** `monotonic()` of the latest chunk of any kind. */
  lastChunkMono: number | undefined
  /** `monotonic()` of the finish chunk. */
  finishMono: number | undefined
  /** Streamed characters, used only when the provider reports no usage. */
  chars: number
  /** Provider token accounting, when one arrived. */
  usage: unknown
  /** Terminal finish reason, when one arrived. */
  finish: unknown
  /** Transport failure observed by a diagnostics listener. */
  transportFailure: FailureInfo | undefined
  /** Whether the record was already handed to the ledger. */
  settled: boolean
}

/** The collector handle: activation, in-flight view, and disposal. */
export interface Collector {
  /** Subscribe to the diagnostics channels; returns the disposer. */
  start(): () => void
  /**
   * The `llm/stream` waterfall listener.
   * @param options - the request being dispatched.
   * @param next - the downstream stream factory.
   * @returns The downstream iterable, measured when the call is eligible.
   */
  handleStream(options: StreamOptionsLike | undefined, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
  /** Model calls currently streaming, for the panel's live counter. */
  inFlight(): LiveCall[]
  /** Unsubscribe from every diagnostics channel. */
  dispose(): void
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
}: CollectorOptions): Collector {
  const als = new AsyncLocalStorage<CallState>()
  const inflightBysRequest = new WeakMap<object, CallState>()
  const active = new Map<string, CallState>()
  const targets = hosts.map(normalizeHost).filter((target): target is string => target !== undefined)
  const providerSet = new Set(providers.map(value => String(value).toLowerCase()))
  const proxies = parseProxyTargets(env)
  const dnsCache = new Map<string, { at: number; addresses: string[]; pending?: boolean }>()
  const peerByHost = new Map<string, {
    connection: RequestRecord['connection']
    ip: string | undefined
    port: number | undefined
    proxy: string | undefined
    at: number
  }>()
  const subscriptions: Array<() => void> = []
  let armed = false

  const watchesHost = (host: unknown): boolean => matchesHost(host, targets)
  const recordsProvider = (provider: unknown): boolean => providerSet.size === 0 || providerSet.has(String(provider ?? '').toLowerCase())

  /** Whether the socket peer belongs to a configured proxy. */
  function viaProxy(address: string, port: number | undefined): boolean {
    if (!isLocalAddress(address)) return false
    if (proxies.length === 0) return true
    return proxies.some(proxy => proxy.host === address && (port === undefined || proxy.port === port))
  }

  /** Refresh the DNS answers for one endpoint host in the background. */
  function warmDns(host: string): void {
    const cached = dnsCache.get(host)
    if (cached !== undefined && (cached.pending === true || now() - cached.at < DNS_TTL_MS)) return
    const pending = dns.lookup(host, { all: true })
      .then((list) => {
        dnsCache.set(host, { at: now(), addresses: list.map(entry => entry.address).slice(0, 8) })
      })
      .catch(() => {
        dnsCache.set(host, { at: now(), addresses: cached?.addresses ?? [] })
      })
    dnsCache.set(host, { at: cached?.at ?? 0, addresses: cached?.addresses ?? [], pending: true })
    void pending
  }

  function subscribe(name: string, listener: (message: unknown) => void): void {
    const diagnostics = channel(name)
    const guarded = (message: unknown): void => {
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

  function onRequestCreate(message: unknown): void {
    const call = als.getStore()
    if (call === undefined || call.settled) return
    const request = field(message, 'request')
    const origin = readText(request, 'origin')
    const host = hostOfOrigin(origin)
    if (host === undefined || !watchesHost(host)) return
    call.record.endpoint = { host, path: text(field(request, 'path'), 200) }
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

  function onClientConnected(message: unknown): void {
    const call = als.getStore()
    const params = field(message, 'connectParams')
    const hostname = readText(params, 'hostname')?.toLowerCase()
    if (hostname === undefined || !watchesHost(hostname)) return
    const socket = field(message, 'socket')
    const address = readText(socket, 'remoteAddress')
    if (address === undefined) return
    const port = readNumber(socket, 'remotePort')
    const proxied = viaProxy(address, port)
    const peer = {
      connection: proxied ? 'proxied' as const : 'direct' as const,
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

  function onRequestHeaders(message: unknown): void {
    const request = field(message, 'request')
    const call = (request !== null && typeof request === 'object' ? inflightBysRequest.get(request) : undefined)
      ?? als.getStore()
    if (call === undefined || call.settled) return
    const headers = field(field(message, 'response'), 'headers')
    const ray = headerValue(headers, 'cf-ray')
    const server = headerValue(headers, 'server')
    if (ray !== undefined) call.record.ray = ray
    if (server !== undefined) call.record.server = server
    const colo = typeof ray === 'string' && ray.includes('-') ? ray.slice(ray.lastIndexOf('-') + 1) : undefined
    if (colo !== undefined && /^[a-z]{3}$/i.test(colo)) call.record.colo = colo.toUpperCase()
  }

  function onRequestError(message: unknown): void {
    const request = field(message, 'request')
    const call = (request !== null && typeof request === 'object' ? inflightBysRequest.get(request) : undefined)
      ?? als.getStore()
    if (call === undefined || call.settled) return
    const error = field(message, 'error')
    const code = text(field(error, 'code'), 64)
    const textMessage = text(field(error, 'message') ?? String(error ?? ''), 300)
    call.transportFailure = { code, message: textMessage }
  }

  /** Build the record skeleton for one call. */
  function openCall(options: StreamOptionsLike | undefined): CallState {
    const record: RequestRecord = {
      id: randomUUID(),
      at: now(),
      provider: text(options?.provider, 80),
      model: text(options?.model, 120),
      purpose: text(options?.purpose, 80),
      sessionId: options?.sessionId === undefined ? undefined : text(String(options.sessionId), 120),
      status: 'ok',
      connection: 'unknown',
    }
    const call: CallState = {
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

  function observe(call: CallState, chunk: StreamChunk): void {
    if (chunk === null || typeof chunk !== 'object') return
    const at = monotonic()
    call.lastChunkMono = at
    switch (chunk.type) {
      case 'text-delta':
      case 'reasoning-delta':
      case 'tool-call-delta': {
        if (CONTENT_CHUNKS.has(chunk.type) && call.firstMono === undefined) call.firstMono = at
        // Read defensively: an adapter may publish a chunk shape this release
        // does not know yet, and a measurement must never fail the stream.
        const delta = chunk as { text?: unknown; argumentsDelta?: unknown }
        if (typeof delta.text === 'string') call.chars += delta.text.length
        else if (typeof delta.argumentsDelta === 'string') call.chars += delta.argumentsDelta.length
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

  function settle(call: CallState, thrown: unknown, stoppedEarly: boolean): void {
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
    const usage = typeof call.usage === 'object' && call.usage !== null ? call.usage as Record<string, unknown> : undefined
    if (usage !== undefined) {
      if (Number.isFinite(usage.outputTokens)) record.outputTokens = usage.outputTokens as number
      if (Number.isFinite(usage.inputTokens)) record.inputTokens = usage.inputTokens as number
      if (Number.isFinite(usage.cacheReadTokens)) record.cacheReadTokens = usage.cacheReadTokens as number
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
      const facts = errorFacts(thrown)
      record.status = facts.abortLike ? 'aborted' : 'error'
      record.failure = call.transportFailure ?? { code: facts.code, message: facts.message }
    } else if (call.finish !== undefined && typeof call.finish === 'object') {
      const finish = call.finish as Record<string, unknown>
      const kind = finish.kind
      record.finishKind = text(kind, 40)
      if (kind === 'error' || kind === 'aborted') {
        const failure = typeof finish.failure === 'object' && finish.failure !== null
          ? finish.failure as Record<string, unknown>
          : undefined
        record.status = kind
        record.failure = {
          code: text(failure?.code, 64),
          message: text(failure?.message, 300),
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

  /** Classify one thrown value without trusting its shape. */
  function errorFacts(error: unknown): { abortLike: boolean; code?: string; message?: string } {
    const name = field(error, 'name')
    const code = field(error, 'code')
    return {
      abortLike: name === 'AbortError' || code === 'ABORTED',
      code: text(code ?? name, 64),
      message: text(field(error, 'message') ?? String(error), 300),
    }
  }

  /** Wrap one adapter stream: forward every chunk, measure around it. */
  function track(call: CallState, source: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    return (async function* measured(): AsyncGenerator<StreamChunk> {
      const iterator = source[Symbol.asyncIterator]()
      let completed = false
      let thrown: unknown
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
      let call: CallState | undefined
      let source: AsyncIterable<StreamChunk>
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
