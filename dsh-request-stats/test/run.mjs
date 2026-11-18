/**
 * Offline tests for the Host half of `dsh-request-stats`.
 *
 * Everything runs in this process against a temporary profile directory: the
 * ledger is exercised through its real files, and undici diagnostics are
 * published by hand so no network, Host, or provider credential is involved.
 *
 * 导入的是 `src/` 下的 TypeScript 源文件(Node 22+ Type Stripping 直接加载),
 * 所以测的是宿主半部的真实实现,而不是构建产物。
 */

import assert from 'node:assert/strict'
import { channel } from 'node:diagnostics_channel'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCollector } from '../src/server/collect.ts'
import { createRecordStore } from '../src/server/records.ts'
import { buildSummary } from '../src/server/summary.ts'

const temp = mkdtempSync(path.join(os.tmpdir(), 'dsh-request-stats-'))
const HOSTS = ['stats.test']
const TARGET = 'https://stats.test/inference/go/openai/v1/chat/completions'

function record(overrides = {}) {
  return {
    id: 'record',
    at: Date.now(),
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    status: 'ok',
    connection: 'unknown',
    ...overrides,
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** One adapter-like stream; diagnostics are published from inside the ALS scope. */
function adapterStream({ request, peer, ray, usage = true, failure }) {
  return (async function* fakeStream() {
    channel('undici:request:create').publish({ request })
    if (peer !== undefined) {
      channel('undici:client:connected').publish({
        connectParams: { hostname: 'stats.test', protocol: 'https:', port: '' },
        socket: { remoteAddress: peer.address, remotePort: peer.port },
      })
    }
    if (ray !== undefined) {
      // undici publishes raw header cells as Buffers, not a Headers instance.
      channel('undici:request:headers').publish({
        request,
        response: {
          statusCode: 200,
          headers: [Buffer.from('Date'), Buffer.from('Tue, 17 Nov 2026 09:00:00 GMT'), Buffer.from('cf-ray'), Buffer.from(ray), Buffer.from('server'), Buffer.from('cloudflare')],
        },
      })
    }
    await sleep(4)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    await sleep(12)
    yield { type: 'text-delta', index: 0, text: 'hello world' }
    await sleep(10)
    yield { type: 'text-delta', index: 0, text: ' again' }
    if (usage) yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 16, cacheReadTokens: 20 } }
    if (failure !== undefined) throw failure
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

async function drain(iterable) {
  const types = []
  for await (const chunk of iterable) types.push(chunk.type)
  return types
}

// ------------------------------------------------------------ ledger round trip

{
  const env = { DSH_PROFILE_DIR: path.join(temp, 'ledger') }
  const store = createRecordStore({ env, maxRecords: 2, retentionDays: 30 })
  store.add(record({ id: 'a' }))
  store.add(record({ id: 'b' }))
  store.add(record({ id: 'c' }))
  assert.equal(store.count(), 2, 'the ledger caps at maxRecords')
  assert.deepEqual(store.list().map(item => item.id), ['b', 'c'], 'the oldest row is dropped first')
  await store.dispose()

  const onDisk = JSON.parse(readFileSync(store.path, 'utf8'))
  assert.equal(onDisk.version, 1)
  assert.equal(onDisk.records.length, 2)

  const reopened = createRecordStore({ env })
  assert.deepEqual(reopened.list().map(item => item.id), ['b', 'c'], 'rows survive a reload')
  assert.equal(await reopened.clear(), 2)
  assert.equal(reopened.count(), 0)
  await reopened.dispose()
}

// --------------------------------------------------------- direct observation

{
  const env = { DSH_PROFILE_DIR: path.join(temp, 'direct') }
  const store = createRecordStore({ env })
  const collector = createCollector({ store, providers: ['opencode-go'], hosts: HOSTS, env: {} })
  const dispose = collector.start()
  const request = { origin: 'https://stats.test', path: '/inference/go/openai/v1/chat/completions' }
  const types = await drain(collector.handleStream(
    { provider: 'opencode-go', model: 'deepseek-v4.1-flash', sessionId: 'session-1' },
    () => adapterStream({ request, peer: { address: '104.18.10.66', port: 443 }, ray: 'a5bd7de68c608c50-SIN' }),
  ))
  assert.deepEqual(types, ['block-start', 'text-delta', 'text-delta', 'usage', 'finish'], 'every chunk is forwarded')
  dispose()

  assert.equal(store.count(), 1)
  const [row] = store.list()
  assert.equal(row.ip, '104.18.10.66', 'direct peer IP is recorded')
  assert.equal(row.connection, 'direct')
  assert.equal(row.ipSource, 'connect')
  assert.equal(row.colo, 'SIN', 'cf-ray colo is recorded')
  assert.equal(row.ray, 'a5bd7de68c608c50-SIN')
  assert.equal(row.server, 'cloudflare')
  assert.equal(row.endpoint?.host, 'stats.test')
  assert.equal(row.outputTokens, 16)
  assert.equal(row.inputTokens, 120)
  assert.equal(row.cacheReadTokens, 20)
  assert.ok(row.ttftMs >= 4, `ttft ${row.ttftMs}`)
  assert.ok(row.decodeMs > 0)
  assert.ok(row.tps > 0, `tps ${row.tps}`)
  assert.ok(row.totalMs >= row.ttftMs)
  assert.equal(row.status, 'ok')
  assert.equal(row.finishKind, 'stop')
  await store.dispose()
}

// ------------------------------------------------------------ proxied request

{
  const env = { DSH_PROFILE_DIR: path.join(temp, 'proxied') }
  const store = createRecordStore({ env })
  const collector = createCollector({
    store,
    providers: ['opencode-go'],
    hosts: HOSTS,
    env: { HTTPS_PROXY: 'http://127.0.0.1:10808' },
  })
  const dispose = collector.start()
  const request = { origin: 'https://stats.test', path: '/v1/messages' }
  await drain(collector.handleStream(
    { provider: 'opencode-go', model: 'claude-haiku-5-5' },
    () => adapterStream({ request, peer: { address: '127.0.0.1', port: 10808 }, ray: 'a5bd7de68c608c50-LAX' }),
  ))
  dispose()

  const [row] = store.list()
  assert.equal(row.connection, 'proxied', 'a local peer is reported as a proxy')
  assert.equal(row.ip, undefined, 'a proxy address is never presented as a server IP')
  assert.equal(row.proxy, '127.0.0.1:10808')
  assert.equal(row.colo, 'LAX')
  await store.dispose()
}

// ------------------------------------------------- provider filter + pass-through

{
  const env = { DSH_PROFILE_DIR: path.join(temp, 'filtered') }
  const store = createRecordStore({ env })
  const collector = createCollector({ store, providers: ['other-provider'], hosts: HOSTS, env: {} })
  const dispose = collector.start()
  const chunks = [{ type: 'block-start', index: 0, blockType: 'text' }]
  const source = (async function* passThrough() { for (const chunk of chunks) yield chunk })()
  const types = await drain(collector.handleStream({ provider: 'opencode-go', model: 'x' }, () => source))
  assert.deepEqual(types, ['block-start'])
  assert.equal(store.count(), 0, 'an unwatched provider is not recorded')
  dispose()
  await store.dispose()
}

// ------------------------------------------------------------- failure paths

{
  const env = { DSH_PROFILE_DIR: path.join(temp, 'failures') }
  const store = createRecordStore({ env })
  const collector = createCollector({ store, providers: ['opencode-go'], hosts: HOSTS, env: {} })
  const dispose = collector.start()
  const request = { origin: 'https://stats.test', path: '/v1/chat' }

  await assert.rejects(
    drain(collector.handleStream({ provider: 'opencode-go', model: 'm' }, () => adapterStream({
      request,
      peer: { address: '104.18.10.66', port: 443 },
      failure: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    }))),
    /socket hang up/,
  )
  const [failed] = store.list()
  assert.equal(failed.status, 'error', 'a thrown adapter stream is recorded as an error')
  assert.equal(failed.failure?.code, 'ECONNRESET')
  assert.ok(failed.outputTokens === undefined || typeof failed.outputTokens === 'number')

  // A terminal error finish keeps the chunk path and records the failure.
  const errorStream = (async function* errored() {
    yield { type: 'text-delta', index: 0, text: 'partial' }
    await sleep(8)
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '429 too many requests' } } }
  })()
  await drain(collector.handleStream({ provider: 'opencode-go', model: 'm2' }, () => errorStream))
  const rows = store.list()
  assert.equal(rows.length, 2)
  assert.equal(rows[1].status, 'error')
  assert.equal(rows[1].failure?.code, 'RATE_LIMIT')
  assert.equal(rows[1].outputTokens, 2, 'a usage-less stream keeps an estimated token count')
  assert.equal(rows[0].outputTokens, 16, 'provider usage is kept when present')
  assert.equal(rows[1].tpsEstimated, true)

  dispose()
  await store.dispose()
}

// ------------------------------------------------------------------ summary

{
  const now = Date.now()
  const rows = [
    record({ id: 'a', at: now - 10 * 60_000, ip: '1.1.1.1', colo: 'SIN', ttftMs: 100, tps: 100, status: 'ok', connection: 'direct' }),
    record({ id: 'b', at: now - 5 * 60_000, ip: '1.1.1.1', colo: 'SIN', ttftMs: 200, tps: 200, status: 'ok', connection: 'direct' }),
    record({ id: 'c', at: now - 2 * 60 * 60_000, colo: 'LAX', ttftMs: 300, tps: 50, status: 'error', connection: 'proxied' }),
    record({ id: 'd', at: now - 60_000, colo: 'LAX', ttftMs: 400, tps: 300, status: 'ok', connection: 'proxied' }),
    record({ id: 'e', at: now - 30_000, purpose: 'session-title', colo: 'SIN', ttftMs: 1200, tps: 90, status: 'ok', connection: 'proxied' }),
  ]
  const summary = buildSummary(rows, { now, window: 'all', providers: ['opencode-go'], hosts: HOSTS })
  assert.equal(summary.retained, 5)
  assert.equal(summary.totals.requests, 4, 'auxiliary calls stay out of the default scope')
  assert.equal(summary.auxiliary, 1)
  assert.equal(summary.includeAuxiliary, false)
  assert.equal(summary.totals.ok, 3)
  assert.equal(summary.totals.errors, 1)
  assert.equal(summary.totals.successRate, 0.75)
  assert.equal(summary.totals.ttft.avg, 233.3)
  assert.equal(summary.totals.ttft.p50, 200)
  assert.equal(summary.totals.tps.avg, 200)
  assert.equal(summary.coverage.direct, 2)
  assert.equal(summary.coverage.proxied, 2)
  assert.equal(summary.servers.length, 2)
  const direct = summary.servers.find(row => row.key === 'ip:1.1.1.1')
  assert.equal(direct.requests, 2)
  assert.equal(direct.ttftAvg, 150)
  assert.equal(direct.tpsAvg, 150)
  assert.equal(direct.ttftP50, 100)
  assert.equal(summary.recent[0].id, 'd', 'recent rows are newest first')
  assert.equal(summary.series.length, 4)

  const hourly = buildSummary(rows, { now, window: '1h' })
  assert.equal(hourly.totals.requests, 3, 'a one-hour window drops the older row')
  assert.equal(hourly.auxiliary, 1)
  assert.equal(hourly.retained, 5, 'retained keeps the whole ledger size')

  const withAux = buildSummary(rows, { now, window: 'all', includeAuxiliary: true })
  assert.equal(withAux.totals.requests, 5, 'the toggle brings auxiliary calls back')
  assert.equal(withAux.totals.ok, 4)
  assert.equal(withAux.totals.errors, 1)
  assert.equal(withAux.auxiliary, 1)
  assert.equal(withAux.includeAuxiliary, true)
  assert.equal(withAux.recent[0].id, 'e', 'an auxiliary call is the newest row when included')

  const estimated = buildSummary([
    record({ id: 'x', at: now - 5000, ttftMs: 100, tps: 50, tpsEstimated: true, status: 'ok', colo: 'SIN' }),
    record({ id: 'y', at: now - 6000, ttftMs: 200, tps: 60, tpsEstimated: true, status: 'error', colo: 'SIN' }),
  ], { now })
  assert.equal(estimated.totals.estimatedSpeeds, 1, 'estimated speeds count only measured (ok) rows')
  assert.equal(estimated.totals.tps.count, 1, 'an error row contributes no speed sample')

  const empty = buildSummary([], { now, window: 'all' })
  assert.equal(empty.totals.requests, 0)
  assert.equal(empty.totals.ttft.avg, undefined)
  assert.deepEqual(empty.servers, [])
}

// --------------------------------------------------------------------- report

rmSync(temp, { recursive: true, force: true })
console.log('dsh-request-stats: all tests passed')
