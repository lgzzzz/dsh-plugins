/**
 * dsh-browser-view 的宿主半部：替当前会话的 agent 抓一帧浏览器画面，并通过已认证的
 * `/api` 路由把 JPEG 字节交给浏览器半部。
 *
 * 抓帧走的是 **agent 自己那份 MCP 工具**（chrome-devtools-mcp 的 `list_pages` 与
 * `take_screenshot`），因此看到的永远是本会话真正的浏览器：`--isolated` 的临时 profile、
 * headless 与否、attach 到外部浏览器都一样。截图请求带 `filePath` 落到 OS 临时目录，
 * 读完立即删除——不写工作区、不进会话日志、也不占附件存储。
 *
 * 这里直接调用工具定义（`ctx.tools.get(name, agent).execute`），不经过 `tools/execute`
 * 的批处理管线：抓帧是用户打开"浏览器画面"标签页引起的**只读旁路读取**，不是 agent 自己
 * 发起的一次工具调用。走管线会让每一帧都触发一次 Auto 审核模型请求、并让审批/凭据策略介
 * 入纯展示的轮询，收益为零。可见性仍然由 `ctx.tools.get(name, agent)` 决定：agent 看不到
 * 的浏览器工具，这里也一定拿不到。
 *
 * @module dsh-browser-view
 */

import { mkdir, readFile, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Cordis plugin name（loader 诊断用）。 */
export const name = 'dsh-browser-view'

/** 依赖的服务：工具注册表、会话注册表与已认证 HTTP 载体。 */
export const inject = ['tools', 'agents', 'connection']

/** 路由路径；浏览器半部硬编码同一常量。 */
const ROUTE_PATH = '/api/browser-view'

/** 抓帧格式：JPEG 体积小、解码快，足够看清页面。 */
const FORMAT = 'jpeg'

/** 默认配置。字段都按"缺省可用"设计，故不声明 Config schema（避免引入 schemastery 依赖）。 */
const DEFAULTS = {
  /** MCP server 名（即工具前缀 `mcp__<server>__` 里的 server）。 */
  server: 'chrome-devtools-mcp',
  /** 抓帧最小间隔毫秒；快于它的请求复用缓存帧。 */
  intervalMs: 1000,
  /** JPEG 质量 1-100。 */
  quality: 60,
}

/**
 * 合并用户配置与默认值，并对越界值做保守收敛。
 * @param {Record<string, unknown> | undefined} raw - loader 行上的 `config`。
 * @returns {{server: string, intervalMs: number, quality: number}} 已校验配置。
 */
function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const server = typeof source.server === 'string' && source.server.trim() !== ''
    ? source.server.trim()
    : DEFAULTS.server
  return {
    server,
    intervalMs: clampInteger(source.intervalMs, 250, 60_000, DEFAULTS.intervalMs),
    quality: clampInteger(source.quality, 1, 100, DEFAULTS.quality),
  }
}

/**
 * 把任意输入收敛为给定闭区间内的整数。
 * @param {unknown} value - 候选值。
 * @param {number} min - 下界。
 * @param {number} max - 上界。
 * @param {number} fallback - 非法或缺失时的取值。
 * @returns {number} 收敛后的整数。
 */
function clampInteger(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/**
 * 从 MCP 结果值里取出全部文本块，按行拼接。
 * @param {unknown} value - MCP 工具的 canonical 返回值。
 * @returns {string} 文本，非结果形状时为空串。
 */
function textOf(value) {
  const content = value !== null && typeof value === 'object' ? value.content : undefined
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
    .map((block) => typeof block.text === 'string' ? block.text : '')
    .join('\n')
}

/**
 * 解析 `list_pages` 的文本输出，得到页面 id 列表与当前选中页。
 *
 * 输出形如：
 * ```
 * ## Pages
 * 1: about:blank
 * 2: Example Domain (https://example.com/) [selected]
 * ```
 * @param {string} text - `list_pages` 的文本块。
 * @returns {{pages: number[], selected: number | undefined}} 页面清单与选中页。
 */
function parsePages(text) {
  const pages = []
  let selected
  for (const line of text.split('\n')) {
    const match = /^(\d+):\s(.*)$/u.exec(line.trim())
    if (match === null) continue
    const id = Number(match[1])
    pages.push(id)
    if (match[2].includes('[selected]')) selected = id
  }
  return { pages, selected: selected ?? pages[pages.length - 1] }
}

/**
 * 组装一次工具执行所需的最小上下文。
 *
 * MCP 工具实现只读 `signal` 与 `agent`；其余字段补齐是为了满足 `ToolRunContext` 形状，
 * 使第三方工具实现即便访问也不会抛错。
 * @param {string} name - 工具全名。
 * @param {unknown} args - 已解析参数。
 * @param {object} agent - 发起会话的 Agent。
 * @param {AbortSignal} signal - 取消信号。
 * @returns {object} 工具运行上下文。
 */
function runContext(name, args, agent, signal) {
  return {
    callId: `browser-view-${randomBytes(6).toString('hex')}`,
    name,
    arguments: args,
    agent,
    signal,
    deferContext() {},
    concludeTurn() {},
  }
}

/**
 * 安装抓帧服务与 HTTP 路由。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {Record<string, unknown> | undefined} rawConfig - loader 行配置。
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const tmpDir = join(tmpdir(), 'dsh-browser-view')
  /** 每个 Session 的最近一帧及其状态；键是 sessionId。 */
  const frames = new Map()
  /** 本进程内用过浏览器工具的 Session id。 */
  const activity = new Set()

  /**
   * 取（必要时新建）一个 Session 的帧槽。
   * @param {string} sessionId - 会话 id。
   * @returns {object} 帧槽。
   */
  const slotOf = (sessionId) => {
    let slot = frames.get(sessionId)
    if (slot === undefined) {
      slot = { at: 0, bytes: undefined, pageId: undefined, pages: [], error: undefined, inFlight: undefined }
      frames.set(sessionId, slot)
    }
    return slot
  }

  /**
   * 本进程内发生过浏览器工具调用的 Session。
   *
   * 这是"该不该去抓帧"的判据，而不是会话日志：MCP 的 `list_pages` 本身会**启动**
   * Chromium。若持久历史里的旧调用就能触发抓帧，那么 Host 重启后打开这个标签页会凭空
   * 拉起一个谁也没在用的浏览器。只有本进程真的跑过该会话的浏览器工具，画面才存在。
   * 用 `tools/pre-execute` 在派发前登记，因此 agent 刚发出的那次调用也赶得上第一帧。
   */
  ctx.on('tools/pre-execute', (exec, next) => {
    const name = exec.name
    if (name.startsWith(`mcp__${config.server}__`) && exec.agent !== undefined) {
      activity.add(exec.agent.id)
    }
    return next()
  })

  /**
   * 抓一帧：先读页面清单确定选中页，再命令该页截图到临时文件并读回字节。
   *
   * 失败一律收敛为 `error` 文本，绝不向路由层抛出——画面读不到时标签页应显示原因，
   * 而不是让轮询请求 500。
   * @param {object} agent - 目标会话的 Agent。
   * @param {AbortSignal} signal - 取消信号。
   * @returns {Promise<{bytes?: Buffer, pageId?: number, pages: number[], error?: string}>} 本帧。
   */
  const capture = async (agent, signal) => {
    const prefix = `mcp__${config.server}__`
    const listTool = ctx.tools.get(`${prefix}list_pages`, agent)
    const shotTool = ctx.tools.get(`${prefix}take_screenshot`, agent)
    // The tools are resolved per Agent, so an absent one means this Session has no browser
    // tools at all (another provider, a restricted tool set, or no browser mounted).
    // Reporting "nothing here yet" beats a red error for a capability that never existed.
    if (listTool === undefined || shotTool === undefined) {
      return { pages: [], error: undefined }
    }

    let pageId
    let pages = []
    try {
      const listed = await listTool.execute({}, runContext(listTool.name, {}, agent, signal))
      const parsed = parsePages(textOf(listed))
      pages = parsed.pages
      pageId = parsed.selected
    } catch (error) {
      return { pages, error: messageOf(error) }
    }
    if (pageId === undefined) return { pages, error: 'the browser reported no page' }

    await mkdir(tmpDir, { recursive: true })
    const filePath = join(tmpDir, `frame-${randomBytes(8).toString('hex')}.${FORMAT}`)
    try {
      await shotTool.execute(
        { pageId, format: FORMAT, quality: config.quality, filePath },
        runContext(shotTool.name, { pageId }, agent, signal),
      )
      const bytes = await readFile(filePath)
      return { bytes, pageId, pages }
    } catch (error) {
      return { pages, pageId, error: messageOf(error) }
    } finally {
      await rm(filePath, { force: true }).catch(() => {})
    }
  }

  /**
   * 取一个会话的当前帧，按 `config.intervalMs` 节流并合并并发请求。
   * @param {object} agent - 目标会话的 Agent。
   * @param {boolean} force - 忽略缓存立即重抓。
   * @param {AbortSignal} signal - 取消信号。
   * @returns {Promise<object>} 帧槽快照。
   */
  const frameFor = (agent, force, signal) => {
    const slot = slotOf(agent.id)
    if (!activity.has(agent.id)) {
      slot.bytes = undefined
      slot.pages = []
      slot.pageId = undefined
      slot.error = undefined
      slot.at = 0
      return Promise.resolve(slot)
    }
    const fresh = slot.at !== 0 && !force && Date.now() - slot.at < config.intervalMs
    if (fresh || (slot.inFlight !== undefined && !force)) {
      return slot.inFlight === undefined ? Promise.resolve(slot) : slot.inFlight
    }
    const pending = capture(agent, signal).then((frame) => {
      slot.at = Date.now()
      slot.bytes = frame.bytes
      slot.pageId = frame.pageId
      slot.pages = frame.pages
      slot.error = frame.error
      slot.inFlight = undefined
      return slot
    }, (error) => {
      slot.at = Date.now()
      slot.bytes = undefined
      slot.error = messageOf(error)
      slot.inFlight = undefined
      return slot
    })
    slot.inFlight = pending
    return pending
  }

  /**
   * 回答一次帧请求。
   * `x-bv-*` 响应头携带状态、帧时间与抓帧间隔；非 ASCII 的错误原因按 URI 编码。
   * @param {Request} request - 已认证的 Fetch 请求。
   * @returns {Promise<Response>} 图像或状态 JSON。
   */
  const respond = async (request) => {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('session') ?? ''
    const force = url.searchParams.get('force') === '1'
    const agent = sessionId === '' ? undefined : ctx.agents.get(sessionId)
    if (agent === undefined) {
      return stateResponse({ state: 'idle', error: undefined, config })
    }

    let slot
    try {
      slot = await frameFor(agent, force, request.signal)
    } catch (error) {
      return stateResponse({ state: 'error', error: messageOf(error), config })
    }

    const state = slot.bytes === undefined
      ? (slot.error === undefined ? 'empty' : 'error')
      : 'live'
    if (slot.bytes === undefined) {
      return stateResponse({ state, error: slot.error, config, slot })
    }
    const headers = new Headers({
      'content-type': `image/${FORMAT}`,
      'content-length': String(slot.bytes.length),
      'cache-control': 'no-store',
    })
    annotate(headers, { state, slot, config })
    return new Response(request.method === 'HEAD' ? null : slot.bytes, { status: 200, headers })
  }

  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: respond,
  }), 'dsh-browser-view: frame route')

  ctx.effect(() => () => {
    frames.clear()
    activity.clear()
  }, 'dsh-browser-view: frame cache')
}

/**
 * 把状态、帧时间、页面与间隔写进响应头。
 * @param {Headers} headers - 目标响应头。
 * @param {{state: string, slot?: object, config: object, error?: string}} info - 标注来源。
 */
function annotate(headers, info) {
  headers.set('x-bv-state', info.state)
  headers.set('x-bv-interval', String(info.config.intervalMs))
  if (info.slot !== undefined) {
    headers.set('x-bv-at', String(info.slot.at))
    headers.set('x-bv-pages', String(info.slot.pages.length))
    if (info.slot.pageId !== undefined) headers.set('x-bv-page', String(info.slot.pageId))
    if (info.slot.error !== undefined) headers.set('x-bv-error', encodeURIComponent(info.slot.error))
  }
  if (info.error !== undefined) headers.set('x-bv-error', encodeURIComponent(info.error))
}

/**
 * 无图可看时的状态响应：200 + JSON，让标签页据 `state` 选择文案。
 * @param {{state: string, error?: string, config: object, slot?: object}} info - 状态。
 * @returns {Response} 状态响应。
 */
function stateResponse(info) {
  const body = JSON.stringify({
    state: info.state,
    at: info.slot?.at ?? 0,
    pages: info.slot?.pages ?? [],
    page: info.slot?.pageId ?? null,
    intervalMs: info.config.intervalMs,
    error: info.slot?.error ?? info.error ?? null,
  })
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  annotate(headers, info)
  return new Response(body, { status: 200, headers })
}

/**
 * 把任意抛出物转成可读的一行。
 * @param {unknown} error - 抛出物。
 * @returns {string} 消息。
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
