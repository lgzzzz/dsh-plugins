/**
 * 宿主半部装配：真 `apply` 在假 ctx 上把取数器接到 `webServer` 的同源路由上。
 *
 * `globalThis.fetch` 换成返回固定上游快照的假实现，不碰真实网络；浏览器侧走一遍处理函数，
 * 验证 200 载荷、owner 校验与卸载时路由/取数器一起收回。
 *
 * 运行：`node test/plugin-apply.test.mjs`（或 pnpm test 跑全部）。
 */
import { apply, name } from '../index.ts'
import { STATUS_PATH } from '../src/wire.ts'
import { check, checkTrue, finish, upstreamFixture } from './helpers.mjs'

const OWNER = { principal: { kind: 'owner' } }
const originalFetch = globalThis.fetch

/** 假宿主 ctx：收集注入、路由与 effect；`webServer` 在子 ctx 上出现。 */
function createContext({ withWebServer = true } = {}) {
  const injections = []
  const routes = []
  const effects = []
  const warnings = []
  const ctx = {
    logger: { warn: (...args) => warnings.push(args.map(String).join(' ')) },
    effect(execute, label) {
      const disposer = execute()
      effects.push({ label, disposer })
      return disposer
    },
    inject(deps, callback) {
      injections.push(deps)
      if (!withWebServer || !deps.includes('webServer')) return
      const webCtx = {
        logger: ctx.logger,
        webServer: {
          register(route) {
            routes.push(route)
            return () => { route.disposed = true }
          },
        },
        effect(execute, label) {
          const disposer = execute()
          effects.push({ label, disposer })
          return disposer
        },
      }
      callback(webCtx)
    },
  }
  return { ctx, injections, routes, effects, warnings }
}

/** 假请求 / 响应。 */
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

/** 走一遍路由处理函数。 */
async function callRoute(route, peer, method = 'GET') {
  const res = fakeResponse()
  await route.handler({ method }, res, peer)
  return { res, json: res.body === '' ? undefined : JSON.parse(res.body) }
}

console.log('--- P① 声明与挂载 ---')
check('导出名', name, 'dsh-opencode-status')

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => upstreamFixture() })
const { ctx, injections, routes, effects, warnings } = createContext()
apply(ctx)
check('注入 webServer', injections, [['webServer']])
check('注册一条路由', routes.length, 1)
check('路由路径', routes[0].path, STATUS_PATH)
check('路由精确匹配', routes[0].kind, 'exact')
check('路由需要鉴权', routes[0].auth, 'required')
check('挂了一个 effect', effects.length, 1)
checkTrue('effect 带清理函数', typeof effects[0].disposer === 'function')

console.log('--- P② 浏览器侧取数：200 与 go / deepseek-v4.1-flash ---')
const ok = await callRoute(routes[0], OWNER)
check('状态码', ok.res.statusCode, 200)
check('不缓存', ok.res.headers['cache-control'], 'no-store')
check('ok 标记', ok.json.ok, true)
check('服务', ok.json.service, { id: 'go', status: 'degraded', reason: 'latency' })
check('模型', [ok.json.model.id, ok.json.model.status, ok.json.model.reason, ok.json.model.ttftMs, ok.json.model.tps], [
  'deepseek-v4.1-flash', 'degraded', 'latency', 9058, 148,
])
check('没有告警', warnings, [])

console.log('--- P③ 非 owner 403 ---')
const denied = await callRoute(routes[0], { principal: { kind: 'remote' } })
check('403', denied.res.statusCode, 403)
check('错误码', denied.json.error, 'forbidden')

console.log('--- P④ 卸载：effect 清理把路由与取数器一起收回 ---')
effects[0].disposer()
check('路由已释放', routes[0].disposed, true)
const afterDispose = await callRoute(routes[0], OWNER)
check('清理后再读走 502（取数器已释放）', afterDispose.res.statusCode, 502)

console.log('--- P⑤ 非 web 环境：没有 webServer 也安静挂载 ---')
const headless = createContext({ withWebServer: false })
apply(headless.ctx)
check('只尝试注入一次', headless.injections, [['webServer']])
check('没有注册路由', headless.routes.length, 0)

globalThis.fetch = originalFetch
finish()
