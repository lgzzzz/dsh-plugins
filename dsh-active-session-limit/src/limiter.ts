/**
 * 活跃会话名额与冷却的纯状态机。
 *
 * 只做三件事：登记「谁正占着名额」、把超额会话排进先来先到的队列、在名额空出且冷却期满
 * 时放行。时间、定时器与日志全部由宿主注入，测试里可以用假时钟逐毫秒驱动，不需要挂宿主。
 *
 * 口径（与 docs/dsh-active-session-limit.md 一致）：
 *
 *   - 一次「活跃」= 一个会话从开始跑任务到转空闲。`acquire()` 在会话提出第一个 step 时调用，
 *     `release()` 在 agent 转 idle 时调用；同一段运行里后续的 step 直接放行（不再排队）。
 *   - 「新会话」= 还没跑过任何回合的会话（`markNew()` 在 `agent/created` 时登记）。
 *     只有新会话要等冷却；已有会话继续对话只受名额限制。
 *   - 名额占满且队列里某个等待者是某个活跃会话的后代时，把它祖先的名额临时让给它
 *     （`suspend`）：父会话在等子智能体的结果时并不消耗模型请求，让出名额既保住上限，
 *     又不会让「父会话等子会话、子会话等名额」互相卡死。
 *   - 冷却从「最近一次会话结束」起算，只有新会话的准入检查它；定时器到点后重新泵队列。
 */

/** 一次准入请求：某个会话要开始跑任务。 */
export interface AdmissionRequest {
  /** 会话 id，与 `Agent.id` 相同。 */
  readonly id: string
  /** 仍活着的上级会话 id，由近到远；普通会话为空数组。 */
  readonly ancestors?: readonly string[]
}

/** 宿主注入的副作用：时钟、定时器、日志。 */
export interface LimiterHost {
  /** 当前时间（Unix 毫秒）。 */
  now(): number
  /** 在 `delayMs` 后异步调用 `callback`，返回取消函数。 */
  schedule(callback: () => void, delayMs: number): () => void
  /** 普通宿主机日志。 */
  info(message: string): void
  /** 细粒度宿主机日志。 */
  debug(message: string): void
}

/** 构造参数。 */
export interface SessionLimiterOptions {
  /** 同时活跃的会话上限。 */
  readonly maxActive: number
  /** 上一个会话结束后，新会话要再等的毫秒数。 */
  readonly cooldownMs: number
  /** 宿主副作用。 */
  readonly host: LimiterHost
}

/** 只读快照，日志与测试用。 */
export interface LimiterSnapshot {
  /** 正占着名额的会话 id。 */
  readonly active: readonly string[]
  /** 名额被后代接管、自己暂停中的会话 id。 */
  readonly suspended: readonly string[]
  /** 排队等待准入的会话 id，按先来先到。 */
  readonly waiting: readonly string[]
  /** 距新会话可以启动还剩多少毫秒，没有冷却中则为 0。 */
  readonly cooldownRemainingMs: number
}

/** 队列里的一位等待者。 */
interface Waiter {
  readonly id: string
  readonly ancestors: readonly string[]
  /** 准入时是否算「新会话」：构造时从 `pendingNew` 取一次，避免排队期间被改写。 */
  readonly isNew: boolean
  readonly enqueuedAt: number
  /** 已经放行或撤销；防止 abort 与 pump 重复结算。 */
  settled: boolean
  /** 是否已经为「开始排队」写过日志。 */
  reportedWhileWaiting: boolean
  /** 结算时唤醒 `acquire()` 的 Promise。 */
  readonly resolve: () => void
  /** 摘掉 abort 监听。 */
  detachAbort: (() => void) | undefined
}

/** 名额与冷却状态机。 */
export class SessionLimiter {
  private readonly active = new Set<string>()
  private readonly suspended = new Set<string>()
  /** 还没跑过任何回合的会话；只决定是否要等冷却。 */
  private readonly pendingNew = new Set<string>()
  private waiters: Waiter[] = []
  private lastEndedAt: number | undefined
  private cancelWake: (() => void) | undefined
  private readonly options: SessionLimiterOptions
  private disposed = false

  constructor(options: SessionLimiterOptions) {
    this.options = options
  }

  /** 同时活跃的会话上限。 */
  get maxActive(): number {
    return this.options.maxActive
  }

  /** 新会话的冷却毫秒数。 */
  get cooldownMs(): number {
    return this.options.cooldownMs
  }

  /** 正占着名额的会话数。 */
  get activeCount(): number {
    return this.active.size
  }

  /** 排队等待准入的会话数。 */
  get waitingCount(): number {
    return this.waiters.length
  }

  /** 某个会话此刻是否占着名额。 */
  isActive(id: string): boolean {
    return this.active.has(id)
  }

  /** 只读快照，供日志与测试断言。 */
  snapshot(): LimiterSnapshot {
    return {
      active: [...this.active],
      suspended: [...this.suspended],
      waiting: this.waiters.map(waiter => waiter.id),
      cooldownRemainingMs: this.cooldownRemaining(),
    }
  }

  /**
   * 登记一个「新会话」：在它跑完第一段运行之前，它的首次准入要额外等冷却。
   * @param id - 会话 id。
   */
  markNew(id: string): void {
    if (this.disposed) return
    this.pendingNew.add(id)
  }

  /**
   * 接管一个插件激活时已经在跑的会话：它已经占着名额，等它转空闲时释放。
   * @param id - 会话 id。
   */
  adopt(id: string): void {
    if (this.disposed || this.active.has(id)) return
    this.active.add(id)
    this.options.host.info(`session "${id}" is already running; counted as active (${this.active.size}/${this.maxActive})`)
  }

  /**
   * 请求准入：名额空且（非新会话或冷却已过）时立即放行，否则排队直到放行或被取消。
   *
   * 取消（`signal` abort）时 Promise 也会正常兑现，但**不**占名额；调用方随后应自行检查
   * `signal.throwIfAborted()`，让这一轮按宿主的取消语义结束。
   * @param request - 会话 id 与活着的上级链。
   * @param signal - 本轮运行的中止信号。
   * @returns 放行或取消后兑现。
   */
  acquire(request: AdmissionRequest, signal: AbortSignal): Promise<void> {
    if (this.disposed || signal.aborted || this.active.has(request.id)) return Promise.resolve()
    const { promise, resolve } = Promise.withResolvers<void>()
    const waiter: Waiter = {
      id: request.id,
      ancestors: request.ancestors ?? [],
      isNew: this.pendingNew.has(request.id),
      enqueuedAt: this.options.host.now(),
      settled: false,
      reportedWhileWaiting: false,
      resolve,
      detachAbort: undefined,
    }
    const onAbort = (): void => { this.settle(waiter) }
    signal.addEventListener('abort', onAbort, { once: true })
    waiter.detachAbort = () => { signal.removeEventListener('abort', onAbort) }
    this.waiters.push(waiter)
    this.pump()
    if (!waiter.settled) {
      waiter.reportedWhileWaiting = true
      this.options.host.info(
        `session "${waiter.id}" is waiting for a free slot `
        + `(${this.active.size}/${this.maxActive} active, ${this.waiters.length} waiting`
        + `${waiter.isNew ? `, cooldown ${this.cooldownRemaining()} ms` : ''})`,
      )
    }
    return promise
  }

  /**
   * 一段运行结束（agent 转 idle 或被销毁）：交回名额、记下结束时间、再泵一次队列。
   * @param id - 会话 id。
   */
  release(id: string): void {
    if (this.disposed) return
    const wasActive = this.active.delete(id)
    const wasSuspended = this.suspended.delete(id)
    if (!wasActive && !wasSuspended) return
    this.lastEndedAt = this.options.host.now()
    this.options.host.debug(
      `session "${id}" ended; ${this.active.size}/${this.maxActive} active`,
    )
    this.pump()
  }

  /**
   * 会话被销毁：丢掉它的所有登记，交回名额，并让还在排队的它退出队列。
   * @param id - 会话 id。
   */
  forget(id: string): void {
    if (this.disposed) return
    const waiter = this.waiters.find(entry => entry.id === id)
    if (waiter !== undefined) this.settle(waiter)
    this.pendingNew.delete(id)
    this.release(id)
    this.suspended.delete(id)
  }

  /** 卸载插件：清掉定时器并放行所有等待者，让它们按现状继续跑（不再受本插件约束）。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelWake?.()
    this.cancelWake = undefined
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) this.settle(waiter)
    this.active.clear()
    this.suspended.clear()
    this.pendingNew.clear()
    this.lastEndedAt = undefined
  }

  /** 判断某位等待者此刻能不能进；能进就把名额挪到位（必要时让祖先暂停）。 */
  private canAdmit(waiter: Waiter): boolean {
    if (waiter.isNew && this.cooldownRemaining() > 0) return false
    if (this.active.size < this.maxActive) return true
    return this.takeAncestorSlot(waiter)
  }

  /** 名额占满时，把某位活跃祖先的名额让给它的后代；找不到就返回 false。 */
  private takeAncestorSlot(waiter: Waiter): boolean {
    for (const ancestor of waiter.ancestors) {
      if (!this.active.has(ancestor)) continue
      this.active.delete(ancestor)
      this.suspended.add(ancestor)
      this.options.host.debug(
        `session "${ancestor}" released its slot while its descendant "${waiter.id}" runs`,
      )
      return true
    }
    return false
  }

  /** 从队首按先来先到放行所有此刻能进的等待者，然后安排下一次冷却唤醒。 */
  private pump(): void {
    if (this.disposed) return
    this.cancelWake?.()
    this.cancelWake = undefined
    let admitted = true
    while (admitted) {
      admitted = false
      for (let index = 0; index < this.waiters.length; index += 1) {
        const waiter = this.waiters[index]!
        if (!this.canAdmit(waiter)) continue
        this.waiters.splice(index, 1)
        this.admit(waiter)
        admitted = true
        break
      }
    }
    this.armWake()
  }

  /** 放行一位等待者：占名额、清掉「新会话」标记、写日志、兑现 Promise。 */
  private admit(waiter: Waiter): void {
    this.active.add(waiter.id)
    this.suspended.delete(waiter.id)
    this.pendingNew.delete(waiter.id)
    const summary = `${this.active.size}/${this.maxActive} active`
    if (waiter.reportedWhileWaiting) {
      const waited = Math.max(0, this.options.host.now() - waiter.enqueuedAt)
      this.options.host.info(`session "${waiter.id}" admitted after waiting ${waited} ms (${summary})`)
    } else {
      this.options.host.debug(`session "${waiter.id}" admitted (${summary})`)
    }
    this.settle(waiter)
  }

  /** 结算一位等待者：出队、摘掉 abort 监听、兑现 Promise。可重复调用。 */
  private settle(waiter: Waiter): void {
    if (waiter.settled) return
    waiter.settled = true
    const index = this.waiters.indexOf(waiter)
    if (index >= 0) this.waiters.splice(index, 1)
    waiter.detachAbort?.()
    waiter.detachAbort = undefined
    waiter.resolve()
  }

  /** 距新会话可以启动还剩多少毫秒；没有结束记录或冷却为 0 时返回 0。 */
  private cooldownRemaining(): number {
    const endedAt = this.lastEndedAt
    if (endedAt === undefined || this.cooldownMs <= 0) return 0
    return Math.max(0, endedAt + this.cooldownMs - this.options.host.now())
  }

  /** 有被冷却挡住的新会话时，在冷却期满那一刻叫醒自己再泵一次。 */
  private armWake(): void {
    if (this.disposed || this.waiters.length === 0) return
    const remaining = this.cooldownRemaining()
    if (remaining <= 0) return
    if (!this.waiters.some(waiter => waiter.isNew)) return
    this.cancelWake = this.options.host.schedule(() => {
      this.cancelWake = undefined
      this.pump()
    }, remaining)
  }
}
