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
import type {
  ConnectionKind,
  FailureInfo,
  IpSource,
  RecordStatus,
  RequestRecord,
} from '../shared/types.ts'

/** On-disk document version; a mismatch reads as empty. */
const VERSION = 1

/** Relative document path inside the resolved state directory. */
const FILE_NAME = 'dsh-request-stats/records.json'

/** Longest persisted error message. */
const MAX_ERROR_CHARS = 300

/** Longest persisted endpoint path. */
const MAX_PATH_CHARS = 200

/** The slice of the environment this module reads; `process.env` satisfies it. */
export type Environment = Readonly<Record<string, string | undefined>>

/** Whether a value is a non-blank string. */
function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Whether a value is a plain object (the ledger document only accepts one). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Whether a value can be read as an object; arrays qualify, as they always did here. */
function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** Bounded string, or `undefined` when the value is not text. */
function boundedText(value: unknown, max: number): string | undefined {
  return hasText(value) ? value.slice(0, max) : undefined
}

/** Finite number, or `undefined`. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Options shared by the path helpers: the Host-resolved profile directory and an environment. */
export interface ResolveStateDirOptions {
  /** Profile directory resolved from the live `profileContext` service. */
  profileDir?: string | undefined
  /** Environment used when no profile directory is known. */
  env?: Environment
}

/**
 * Directory that owns this profile's plugin state.
 *
 * The Host process itself carries no `DSH_PROFILE_DIR` (that variable belongs
 * to model shell calls), so the live `profileContext` service is the authority;
 * the environment only covers a launch without a profile.
 * @param options - the profile directory resolved from the Host, and an environment.
 * @returns The profile directory, the DSH home, or `~/.dsh`.
 */
export function resolveStateDir({ profileDir, env = process.env }: ResolveStateDirOptions = {}): string {
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
export function recordsPath(options: ResolveStateDirOptions = {}): string {
  return path.join(resolveStateDir(options), FILE_NAME)
}

/** Keep only primitive, bounded fields; a record is disposable view data. */
function sanitize(input: unknown): RequestRecord | undefined {
  if (!isRecord(input)) return undefined
  if (typeof input.at !== 'number' || !Number.isFinite(input.at)) return undefined
  if (!hasText(input.id)) return undefined
  const endpoint = isObjectLike(input.endpoint)
    ? {
        host: boundedText(input.endpoint.host, 255),
        path: boundedText(input.endpoint.path, MAX_PATH_CHARS),
      }
    : undefined
  const failureSource = isObjectLike(input.failure) ? input.failure : undefined
  const failure: FailureInfo | undefined = failureSource === undefined
    ? undefined
    : {
        code: boundedText(failureSource.code, 64),
        message: boundedText(failureSource.message, MAX_ERROR_CHARS),
      }
  const status: RecordStatus = input.status === 'ok' || input.status === 'error' || input.status === 'aborted'
    ? input.status
    : 'ok'
  const ipSource: IpSource | undefined = input.ipSource === 'connect' || input.ipSource === 'pool'
    ? input.ipSource
    : undefined
  const connection: ConnectionKind = input.connection === 'direct' || input.connection === 'proxied'
    ? input.connection
    : 'unknown'
  const dns = Array.isArray(input.dns) ? input.dns.filter(hasText).slice(0, 8) : undefined
  return {
    id: input.id,
    at: input.at,
    provider: boundedText(input.provider, 80),
    model: boundedText(input.model, 120),
    purpose: boundedText(input.purpose, 80),
    sessionId: boundedText(input.sessionId, 120),
    status,
    endpoint,
    ip: boundedText(input.ip, 64),
    ipPort: finiteNumber(input.ipPort),
    ipSource,
    connection,
    proxy: boundedText(input.proxy, 120),
    colo: boundedText(input.colo, 12),
    ray: boundedText(input.ray, 64),
    server: boundedText(input.server, 64),
    dns,
    ttftMs: finiteNumber(input.ttftMs),
    decodeMs: finiteNumber(input.decodeMs),
    totalMs: finiteNumber(input.totalMs),
    outputTokens: finiteNumber(input.outputTokens),
    inputTokens: finiteNumber(input.inputTokens),
    cacheReadTokens: finiteNumber(input.cacheReadTokens),
    tps: finiteNumber(input.tps),
    tpsEstimated: input.tpsEstimated === true ? true : undefined,
    finishKind: boundedText(input.finishKind, 40),
    failure,
  }
}

/** Options for {@link createRecordStore}. */
export interface RecordStoreOptions extends ResolveStateDirOptions {
  /** Absolute cap on retained rows; the oldest rows go first. */
  maxRecords?: number
  /** Retention window in days. */
  retentionDays?: number
  /** Clock used for retention and the persisted `savedAt`. */
  now?: () => number
}

/** The ledger handle used by the collector and the HTTP bridge. */
export interface RecordStore {
  /** Absolute path of the ledger document, for diagnostics and the panel. */
  readonly path: string
  /** Append one finished record, keeping the ledger bounded. */
  add(record: RequestRecord): void
  /** Snapshot of every retained record, oldest first. */
  list(): RequestRecord[]
  /** Number of retained records. */
  count(): number
  /** Remove every record and persist the empty ledger. */
  clear(): Promise<number>
  /** Write everything still pending and stop accepting appends. */
  dispose(): Promise<void>
}

/**
 * Create the ledger: load what exists, append new records, and flush lazily.
 * @param options - retention limits and the environment to resolve against.
 * @returns The ledger handle used by the collector and the HTTP bridge.
 */
export function createRecordStore({
  maxRecords = 2000,
  retentionDays = 30,
  profileDir,
  env = process.env,
  now = Date.now,
}: RecordStoreOptions = {}): RecordStore {
  const target = recordsPath({ profileDir, env })
  const retentionMs = Math.max(1, retentionDays) * 24 * 60 * 60 * 1000
  let records: RequestRecord[] = []
  let flushTimer: NodeJS.Timeout | undefined
  let flushing: Promise<void> = Promise.resolve()
  let disposed = false

  try {
    const parsed: unknown = JSON.parse(readFileSync(target, 'utf8'))
    if (isRecord(parsed) && parsed.version === VERSION && Array.isArray(parsed.records)) {
      records = parsed.records
        .map(sanitize)
        .filter((record): record is RequestRecord => record !== undefined)
    }
  } catch {
    // Missing, unreadable, malformed, or unsupported: start from empty.
  }

  /** Drop expired records, then the oldest beyond the cap. */
  function trim(): void {
    const cutoff = now() - retentionMs
    if (records.length > 0 && records.some(record => record.at < cutoff)) {
      records = records.filter(record => record.at >= cutoff)
    }
    if (records.length > maxRecords) records = records.slice(records.length - maxRecords)
  }

  function schedule(): void {
    if (disposed || flushTimer !== undefined) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      void flush()
    }, 400)
    // A pending write must not keep the Host process alive.
    flushTimer.unref()
  }

  async function writeNow(): Promise<void> {
    const payload = JSON.stringify({ version: VERSION, savedAt: now(), records })
    const temporary = `${target}.${process.pid}.tmp`
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(temporary, payload, 'utf8')
    await rename(temporary, target)
  }

  function flush(): Promise<void> {
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
