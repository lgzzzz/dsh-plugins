/**
 * Per-profile request ledger for `dsh-request-stats`.
 *
 * The ledger is plugin-owned derived data, never Session truth: one JSON
 * document under the profile directory (or DSH home for an unprofiled launch),
 * loaded synchronously at activation and flushed with debounced atomic writes.
 * A malformed or unknown document reads as empty instead of failing activation,
 * and the ledger never stores prompts, headers, or credentials — only transport
 * and timing facts.
 *
 * @module dsh-request-stats/server/records
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** On-disk document version; a mismatch reads as empty. */
const VERSION = 1

/** Relative document path inside the resolved state directory. */
const FILE_NAME = 'dsh-request-stats/records.json'

/** Longest persisted error message. */
const MAX_ERROR_CHARS = 300

/** Longest persisted endpoint path. */
const MAX_PATH_CHARS = 200

const hasText = value => typeof value === 'string' && value.trim().length > 0

/**
 * Directory that owns this profile's plugin state.
 *
 * The Host process itself carries no `DSH_PROFILE_DIR` (that variable belongs
 * to model shell calls), so the live `profileContext` service is the authority;
 * the environment only covers a launch without a profile.
 * @param options - the profile directory resolved from the Host, and an environment.
 * @returns The profile directory, the DSH home, or `~/.dsh`.
 */
export function resolveStateDir({ profileDir, env = process.env } = {}) {
  if (hasText(profileDir)) return profileDir
  if (hasText(env.DSH_PROFILE_DIR)) return env.DSH_PROFILE_DIR
  if (hasText(env.DSH_HOME)) return env.DSH_HOME
  return path.join(env.USERPROFILE ?? env.HOME ?? process.cwd(), '.dsh')
}

/**
 * Absolute path of this plugin's ledger document.
 * @param options - the profile directory and an environment.
 * @returns The ledger path.
 */
export function recordsPath(options = {}) {
  return path.join(resolveStateDir(options), FILE_NAME)
}

/** Keep only primitive, bounded fields; a record is disposable view data. */
function sanitize(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined
  if (typeof input.at !== 'number' || !Number.isFinite(input.at)) return undefined
  if (!hasText(input.id)) return undefined
  const text = (value, max) => hasText(value) ? value.slice(0, max) : undefined
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const failure = input.failure !== null && typeof input.failure === 'object'
    ? {
        code: text(input.failure.code, 64),
        message: text(input.failure.message, MAX_ERROR_CHARS),
      }
    : undefined
  return {
    id: input.id,
    at: input.at,
    provider: text(input.provider, 80),
    model: text(input.model, 120),
    purpose: text(input.purpose, 80),
    sessionId: text(input.sessionId, 120),
    status: input.status === 'ok' || input.status === 'error' || input.status === 'aborted' ? input.status : 'ok',
    endpoint: input.endpoint !== null && typeof input.endpoint === 'object'
      ? { host: text(input.endpoint.host, 255), path: text(input.endpoint.path, MAX_PATH_CHARS) }
      : undefined,
    ip: text(input.ip, 64),
    ipPort: number(input.ipPort),
    ipSource: input.ipSource === 'connect' || input.ipSource === 'pool' ? input.ipSource : undefined,
    connection: input.connection === 'direct' || input.connection === 'proxied' ? input.connection : 'unknown',
    proxy: text(input.proxy, 120),
    colo: text(input.colo, 12),
    ray: text(input.ray, 64),
    server: text(input.server, 64),
    dns: Array.isArray(input.dns) ? input.dns.filter(hasText).slice(0, 8) : undefined,
    ttftMs: number(input.ttftMs),
    decodeMs: number(input.decodeMs),
    totalMs: number(input.totalMs),
    outputTokens: number(input.outputTokens),
    inputTokens: number(input.inputTokens),
    cacheReadTokens: number(input.cacheReadTokens),
    tps: number(input.tps),
    tpsEstimated: input.tpsEstimated === true ? true : undefined,
    finishKind: text(input.finishKind, 40),
    failure,
  }
}

/**
 * Create the ledger: load what exists, append new records, and flush lazily.
 * @param options - retention limits and the environment to resolve against.
 * @returns The ledger handle used by the collector and the HTTP bridge.
 */
export function createRecordStore({ maxRecords = 2000, retentionDays = 30, profileDir, env = process.env, now = Date.now } = {}) {
  const target = recordsPath({ profileDir, env })
  const retentionMs = Math.max(1, retentionDays) * 24 * 60 * 60 * 1000
  let records = []
  let flushTimer
  let flushing = Promise.resolve()
  let disposed = false

  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8'))
    if (parsed?.version === VERSION && Array.isArray(parsed.records)) {
      records = parsed.records.map(sanitize).filter(record => record !== undefined)
    }
  } catch {
    // Missing, unreadable, malformed, or unsupported: start from empty.
  }

  /** Drop expired records, then the oldest beyond the cap. */
  function trim() {
    const cutoff = now() - retentionMs
    if (records.length > 0 && records.some(record => record.at < cutoff)) {
      records = records.filter(record => record.at >= cutoff)
    }
    if (records.length > maxRecords) records = records.slice(records.length - maxRecords)
  }

  function schedule() {
    if (disposed || flushTimer !== undefined) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      void flush()
    }, 400)
    // A pending write must not keep the Host process alive.
    flushTimer.unref?.()
  }

  async function writeNow() {
    const payload = JSON.stringify({ version: VERSION, savedAt: now(), records })
    const temporary = `${target}.${process.pid}.tmp`
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(temporary, payload, 'utf8')
    await rename(temporary, target)
  }

  function flush() {
    flushing = flushing.then(writeNow).catch(() => {
      // A failed flush is not worth a model-call failure; the next append retries.
    })
    return flushing
  }

  trim()

  return {
    /** Absolute path of the ledger document, for diagnostics and the panel. */
    path: target,
    /** Append one finished record, keeping the ledger bounded. */
    add(record) {
      if (disposed) return
      const clean = sanitize(record)
      if (clean === undefined) return
      records.push(clean)
      trim()
      schedule()
    },
    /** Snapshot of every retained record, oldest first. */
    list() {
      return records.slice()
    },
    /** Number of retained records. */
    count() {
      return records.length
    },
    /** Remove every record and persist the empty ledger. */
    async clear() {
      const removed = records.length
      records = []
      schedule()
      await flush()
      return removed
    },
    /** Write everything still pending and stop accepting appends. */
    async dispose() {
      disposed = true
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
      await flush()
    },
  }
}
