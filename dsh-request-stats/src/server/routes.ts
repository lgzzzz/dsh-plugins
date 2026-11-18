/**
 * The panel's HTTP bridge for `dsh-request-stats`.
 *
 * The browser half polls the Host through two routes this plugin owns, because
 * a ledger read is live process data rather than Session content. The bridge
 * admits only same-origin requests from a loopback client: it holds no
 * credential of its own, so it neither widens the Web gate nor pretends to
 * authorize a remote browser that reaches the Host over a network address.
 *
 * @module dsh-request-stats/server/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import net from 'node:net'
import type { LiveCall, RequestRecord, Summary } from '../shared/types.ts'

/** Base path owned by this plugin. */
export const BASE_PATH = '/api/dsh-request-stats'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '[::1]'])

const JSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

/** Write one JSON response and end it. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

/** Whether a peer or authority address is this machine. */
function isLoopbackAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false
  const clean = address.startsWith('::ffff:') ? address.slice(7) : address
  return LOOPBACK.has(address) || (net.isIP(clean) === 4 && clean.startsWith('127.')) || clean === '::1'
}

/** Hostname of a `Host`-style authority, without brackets around IPv6. */
function hostnameOfAuthority(authority: unknown): string | undefined {
  if (typeof authority !== 'string') return undefined
  try {
    return new URL(`http://${authority}`).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return undefined
  }
}

/**
 * Whether this exact request may read the ledger.
 * @param req - the incoming request.
 * @returns True for a same-origin request whose peer is this machine.
 */
export function admitted(req: IncomingMessage): boolean {
  const host = req.headers?.host
  if (typeof host !== 'string') return false
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers?.origin
  if (origin !== undefined) {
    try {
      // A repeated header arrives as an array; `String()` keeps the coercion
      // the URL parser would apply anyway.
      if (new URL(String(origin)).host !== host) return false
    } catch {
      return false
    }
  }
  const hostName = hostnameOfAuthority(host)
  if (hostName === undefined) return false
  const remote = req.socket?.remoteAddress
  if (isLoopbackAddress(remote)) {
    // A loopback peer must also address a loopback authority: otherwise a
    // rebound DNS name could read the ledger through a local socket.
    return isLoopbackAddress(hostName) || hostName === 'localhost'
  }
  // A Host bound to a non-loopback address: accept only when the socket really
  // reached that exact address, which keeps the rule address-based.
  const local = req.socket?.localAddress
  return typeof local === 'string' && local === hostName
}

/** One exact-path HTTP route, mirroring the Host web server's route shape. */
export interface WebServerRoute {
  /** Route match kind. */
  kind: 'exact' | 'prefix'
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** The one {@link WebServer} capability this plugin uses, structurally typed. */
export interface WebServerLike {
  /** Register one route; returns its disposer. */
  register(route: WebServerRoute): () => void
}

/** The ledger capabilities the routes need. */
export interface RouteStore {
  /** Snapshot of every retained record. */
  list(): RequestRecord[]
  /** Remove every record; resolves with the removed count. */
  clear(): Promise<number>
}

/** The live-call capability the routes need. */
export interface RouteCollector {
  /** Model calls currently streaming. */
  inFlight(): LiveCall[]
}

/** What the route passes to the aggregator for one poll. */
export interface SummarizeOverride {
  /** Requested history window. */
  window?: string
  /** Whether auxiliary calls are included. */
  includeAuxiliary: boolean
  /** Model calls currently streaming. */
  inFlight: readonly LiveCall[]
}

/** The logging capability `registerRoutes` uses (absent-safe). */
export interface LoggerLike {
  /** Report a failed request; never throws into the handler. */
  warn?(message: string): void
}

/** Options for {@link registerRoutes}. */
export interface RegisterRoutesOptions {
  /** The ledger. */
  store: RouteStore
  /** The live-call source. */
  collector: RouteCollector
  /** One summary per poll. */
  summarize(records: RequestRecord[], override: SummarizeOverride): Summary
  /** Called after a successful clear with the removed count. */
  onClear?(removed: number): void
  /** Host logger used to report route failures. */
  logger?: LoggerLike
}

/**
 * Register the read and clear routes.
 * @param webServer - the Host web server service.
 * @param options - the ledger, the aggregator, and the live-call source.
 * @returns One disposer per registered route.
 */
export function registerRoutes(
  webServer: WebServerLike,
  { store, collector, summarize, onClear, logger }: RegisterRoutesOptions,
): Array<() => void> {
  const state: WebServerRoute = {
    kind: 'exact',
    path: `${BASE_PATH}/state`,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (!admitted(req)) return writeJson(res, 403, { ok: false, message: 'forbidden' })
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.setHeader('allow', 'GET, HEAD')
          return writeJson(res, 405, { ok: false, message: 'method not allowed' })
        }
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
        const window = url.searchParams.get('window') ?? undefined
        const includeAuxiliary = url.searchParams.get('includeAux') === '1'
        const value = summarize(store.list(), {
          window,
          includeAuxiliary,
          inFlight: collector.inFlight(),
        })
        return writeJson(res, 200, { ok: true, value })
      } catch (error) {
        logger?.warn?.(`dsh-request-stats: state route failed: ${errorMessage(error)}`)
        return writeJson(res, 500, { ok: false, message: 'ledger read failed' })
      }
    },
  }

  const clear: WebServerRoute = {
    kind: 'exact',
    path: `${BASE_PATH}/clear`,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (!admitted(req)) return writeJson(res, 403, { ok: false, message: 'forbidden' })
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          return writeJson(res, 405, { ok: false, message: 'method not allowed' })
        }
        // The body is irrelevant and never parsed: the action clears this
        // plugin's own ledger and nothing else. Draining keeps the connection
        // reusable instead of leaving an unread body behind.
        req.resume()
        const removed = await store.clear()
        onClear?.(removed)
        return writeJson(res, 200, { ok: true, value: { removed } })
      } catch (error) {
        logger?.warn?.(`dsh-request-stats: clear route failed: ${errorMessage(error)}`)
        return writeJson(res, 500, { ok: false, message: 'ledger clear failed' })
      }
    },
  }

  return [webServer.register(state), webServer.register(clear)]
}

/** Message of an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
