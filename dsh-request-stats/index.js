/**
 * `dsh-request-stats` — a request ledger and dashboard for fixed provider
 * routes, built for opencode-go model calls.
 *
 * The Host half records one row per model request: which server answered it
 * (a directly observed peer IP when the Host reaches the provider without a
 * proxy, otherwise Cloudflare's `cf-ray` edge code plus the request-time DNS
 * answers), time to first token, and output speed. The browser half adds a
 * left-sidebar entry that opens a dashboard over that ledger.
 *
 * Rows live in the profile's own `dsh-request-stats/records.json`; no prompt,
 * header, or credential is stored. Recording happens inside a waterfall
 * listener that always forwards the stream, so a measurement failure can only
 * lose a row.
 *
 * @module dsh-request-stats
 */

import { createCollector } from './server/collect.js'
import { createRecordStore } from './server/records.js'
import { registerRoutes } from './server/routes.js'
import { buildSummary } from './server/summary.js'

/** Loader entry identity for this bundle. */
export const name = 'dsh-request-stats'

/** Defaults for the optional `config` object; the row may override any field. */
const DEFAULTS = {
  providers: ['opencode-go'],
  hosts: ['opencode.ai'],
  maxRecords: 2000,
  retentionDays: 30,
}

/** Strings from an optional config list, ignoring blanks and duplicates. */
function stringList(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed.length > 0) seen.add(trimmed)
  }
  return seen.size === 0 ? [...fallback] : [...seen]
}

/** Clamp one optional whole-number config field. */
function integer(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * Resolve the plugin row's optional config.
 * @param config - raw loader config for this row.
 * @returns Effective recording options.
 */
export function normalizeOptions(config) {
  const input = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {}
  return {
    providers: stringList(input.providers, DEFAULTS.providers),
    hosts: stringList(input.hosts, DEFAULTS.hosts),
    maxRecords: integer(input.maxRecords, DEFAULTS.maxRecords, 50, 50_000),
    retentionDays: integer(input.retentionDays, DEFAULTS.retentionDays, 1, 365),
  }
}

/**
 * Activate the Host half: capture, persist, and serve the ledger.
 * @param ctx - the plugin context.
 * @param config - optional row config (`providers`, `hosts`, `maxRecords`,
 *   `retentionDays`). An absent field keeps its default.
 */
export function apply(ctx, config) {
  const options = normalizeOptions(config)
  // The Host process has no DSH_PROFILE_DIR; the live profile context does.
  const profileDir = ctx.get('profileContext')?.dir
  const store = createRecordStore({ ...options, profileDir })
  const collector = createCollector({ store, ...options })

  ctx.effect(() => {
    const disposeChannels = collector.start()
    // The waterfall listener owns no decision: it returns the measured stream
    // and forwards every chunk unchanged.
    const disposeStream = ctx.on('llm/stream', (request, next) => collector.handleStream(request, next))
    return () => {
      disposeStream?.()
      disposeChannels?.()
      collector.dispose()
    }
  }, 'dsh-request-stats: request capture')

  ctx.effect(() => () => {
    void store.dispose()
  }, 'dsh-request-stats: ledger flush')

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const disposers = registerRoutes(webCtx, {
        store,
        collector,
        summarize: (records, override) => buildSummary(records, {
          window: override.window,
          includeAuxiliary: override.includeAuxiliary,
          inFlight: override.inFlight,
          providers: options.providers,
          hosts: options.hosts,
        }),
        logger: ctx.logger,
      })
      return () => {
        for (const dispose of disposers) dispose?.()
      }
    }, 'dsh-request-stats: dashboard routes')
  })

  ctx.logger?.info?.(
    `dsh-request-stats: recording ${options.providers.join(', ')} requests to ${options.hosts.join(', ')}; ledger ${store.path}`,
  )
}
