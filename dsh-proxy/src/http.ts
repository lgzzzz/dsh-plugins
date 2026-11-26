/**
 * `/proxy-api` 同源路由：面板的取数与动作都走这里。
 *
 * 路由声明为 `prefix` 且不写 `auth`，即要求认证（与会话 cookie 同源），
 * 所以面板可以直接 `fetch('/proxy-api/state')`。
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：把 `ctx.webServer` 的服务契约与 `Context` 合并进来。
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Flow } from './explain.ts'
import type { RingLog } from './log.ts'
import { asWriteRequest, type ProxyService } from './service.ts'
import { isPlainObject } from './util.ts'

const PREFIX = '/proxy-api'
const MAX_BODY_BYTES = 256 * 1024

/** 读一个 JSON 请求体；空体当 `{}`。 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`请求体超过 ${MAX_BODY_BYTES} 字节`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${(error as Error).message}`))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/**
 * 注册 `/proxy-api` 的全部端点。
 * @param ctx - 宿主 Context。
 * @param service - 应用逻辑。
 * @param log - 环形日志，`/logs` 与状态里都要用。
 * @returns 注销路由的 disposer。
 */
export function registerApi(ctx: Context, service: ProxyService, log: RingLog): () => void {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const route = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname
    const method = (req.method ?? 'GET').toUpperCase()
    try {
      if (route === '/state' && method === 'GET') {
        sendJson(res, 200, {
          status: service.status(),
          routing: service.read(),
          nodes: service.nodesView(),
          logs: log.tail(80),
        })
        return
      }
      if (route === '/logs' && method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? '200')
        sendJson(res, 200, { lines: log.tail(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 200) })
        return
      }
      if (route === '/traffic' && method === 'GET') {
        // 过滤在服务端做：summary 要覆盖整个环形窗口，不能只统计当前页。
        const host = url.searchParams.get('host') ?? ''
        const out = url.searchParams.get('out') ?? ''
        const verdict = url.searchParams.get('verdict')
        const limit = url.searchParams.get('limit')
        sendJson(res, 200, service.traffic({
          ...(host === '' ? {} : { host }),
          ...(out === '' ? {} : { out }),
          ...(verdict === 'proxy' || verdict === 'direct' || verdict === 'block' ? { verdict } : {}),
          ...(limit === null ? {} : { limit: Number(limit) }),
        }))
        return
      }
      if (method !== 'POST') {
        sendJson(res, 405, { error: `不支持 ${method} ${route}` })
        return
      }

      const body = await readJsonBody(req)

      if (route === '/check') {
        const request = asWriteRequest(body)
        if (request === undefined) {
          sendJson(res, 400, { error: '需要 { mode: "replace" | "patch", … }' })
          return
        }
        // 与服务端 write 同一实现算出候选，只校验不落盘。
        const candidate = service.candidateFor(request)
        if (candidate.error !== undefined) {
          sendJson(res, 200, {
            valid: false,
            diagnostics: [candidate.error],
            exits: service.exits(),
            exitLabels: service.exitLabels(),
            compiled: null,
            changes: null,
          })
          return
        }
        sendJson(res, 200, { ...service.check(candidate.routing), changes: candidate.changes })
        return
      }
      if (route === '/explain') {
        const flow = isPlainObject(body) ? (body as unknown as Flow) : {}
        sendJson(res, 200, service.explain(flow))
        return
      }
      if (route === '/write') {
        const request = asWriteRequest(body)
        if (request === undefined) {
          sendJson(res, 400, { error: '需要 { mode: "replace" | "patch", … }' })
          return
        }
        sendJson(res, 200, await service.write(request))
        return
      }
      if (route === '/core') {
        const action = isPlainObject(body) ? body['action'] : undefined
        if (action !== 'start' && action !== 'stop' && action !== 'restart') {
          sendJson(res, 400, { error: 'action 只能是 start / stop / restart' })
          return
        }
        sendJson(res, 200, await service.coreAction(action))
        return
      }
      if (route === '/subscription') {
        const input = isPlainObject(body) ? body : {}
        sendJson(
          res,
          200,
          await service.addSubscription({
            ...(typeof input['url'] === 'string' ? { url: input['url'] } : {}),
            ...(typeof input['text'] === 'string' ? { text: input['text'] } : {}),
            ...(typeof input['name'] === 'string' ? { name: input['name'] } : {}),
          }),
        )
        return
      }
      if (route === '/latency') {
        const ids = isPlainObject(body) && Array.isArray(body['nodes'])
          ? body['nodes'].filter((entry): entry is string => typeof entry === 'string')
          : undefined
        sendJson(res, 200, await service.latency(ids))
        return
      }
      if (route === '/select') {
        const id = isPlainObject(body) && typeof body['id'] === 'string' ? body['id'] : ''
        if (id === '') {
          sendJson(res, 400, { error: '需要 { id }' })
          return
        }
        sendJson(res, 200, await service.selectNode(id))
        return
      }
      sendJson(res, 404, { error: `没有这个端点：${route}` })
    } catch (error) {
      log.push('error', `${route}: ${(error as Error).message}`)
      sendJson(res, 500, { error: (error as Error).message })
    }
  }

  return ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler })
}
