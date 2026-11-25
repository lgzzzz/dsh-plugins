/**
 * 宿主同源路由：owner 校验、方法限制、成功载荷与上游失败时的 502。
 *
 * 用假 req / res，不监听端口、不打网络。
 *
 * 运行：`node test/route.test.mjs`（或 pnpm test 跑全部）。
 */
import { createStatusHandler } from '../src/route.ts'
import { extractSnapshot } from '../src/wire.ts'
import { check, checkTrue, finish, upstreamFixture } from './helpers.mjs'

const OWNER = { principal: { kind: 'owner' } }
const snapshot = extractSnapshot(upstreamFixture(), 1795593000000)

/** 假请求。 */
function fakeRequest(method = 'GET') {
  return { method }
}

/** 假响应：记录状态码、头与 body。 */
function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value
    },
    end(body) {
      this.body = body === undefined ? '' : String(body)
    },
  }
}

/** 调一次处理函数。 */
async function call(handler, peer, method = 'GET') {
  const req = fakeRequest(method)
  const res = fakeResponse()
  await handler(req, res, peer)
  return { res, json: res.body === '' ? undefined : JSON.parse(res.body) }
}

console.log('--- H① owner + GET：200 与快照 ---')
const success = createStatusHandler({ read: async () => snapshot })
const ok = await call(success, OWNER)
check('状态码', ok.res.statusCode, 200)
check('内容类型', ok.res.headers['content-type'], 'application/json; charset=utf-8')
check('不缓存', ok.res.headers['cache-control'], 'no-store')
check('nosniff', ok.res.headers['x-content-type-options'], 'nosniff')
check('ok 标记', ok.json.ok, true)
check('快照字段', [ok.json.updatedAt, ok.json.stale, ok.json.service, ok.json.model], [
  snapshot.updatedAt,
  snapshot.stale,
  snapshot.service,
  snapshot.model,
])

console.log('--- H② 非 owner / 没有 peer：403 ---')
const denied = await call(success, { principal: { kind: 'remote' } })
check('remote 403', denied.res.statusCode, 403)
check('错误码', denied.json, { ok: false, error: 'forbidden', message: 'owner access required' })
const anonymous = await call(success, undefined)
check('没有 peer 403', anonymous.res.statusCode, 403)

console.log('--- H③ 非 GET：405 + Allow ---')
const wrongMethod = await call(success, OWNER, 'POST')
check('状态码', wrongMethod.res.statusCode, 405)
check('Allow', wrongMethod.res.headers.allow, 'GET')
check('不缓存', wrongMethod.res.headers['cache-control'], 'no-store')

console.log('--- H④ 上游失败：502 且不抛 ---')
const failing = createStatusHandler({ read: async () => { throw new Error('connect ETIMEDOUT') } })
const upstreamError = await call(failing, OWNER)
check('状态码', upstreamError.res.statusCode, 502)
check('错误码', upstreamError.json.error, 'upstream')
checkTrue('带说明', upstreamError.json.message.includes('ETIMEDOUT'))
check('不缓存', upstreamError.res.headers['cache-control'], 'no-store')

console.log('--- H⑤ 读取是异步的：handler 等它完成 ---')
let finished = false
const slow = createStatusHandler({
  read: async () => {
    await new Promise(resolve => setTimeout(resolve, 5))
    finished = true
    return snapshot
  },
})
const slowResult = await call(slow, OWNER)
check('等待后完成', [finished, slowResult.res.statusCode], [true, 200])

finish()
