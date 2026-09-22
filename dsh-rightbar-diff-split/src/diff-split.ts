/** 判定与事件核心:把「当前 diff 标签的左右对比」跟随「右栏是否全屏」。
 *
 * **只认三种事件**(均在触发时 set 一次,不做持续纠正):
 * ① 打开一个标签且它是变更审阅 → 按当时全屏值设一次;
 * ② 从一个标签切到另一个标签且被切到的是变更审阅 → 同样按当时全屏值设一次;
 * ③ 右栏全屏值翻转 → 变为全屏设分栏、变为非全屏设不分栏(对象是当时的当前 diff 标签)。
 * 三种事件之外(手动点页头「左右对比」、拖标签、拖分隔条、浮窗拖动……)一律不介入。
 *
 * 两处判等职责不同、不可互相替代:
 * - `tab.id !== lastDiffTabId` = **事件筛选**(决定要不要做):订阅是持续的、通知是高频的,
 *   缺了它就会在每一次右栏通知里都满足「当前标签是 diff」,退化成持续纠正;
 * - `splitOf(...) !== desired` = **幂等读**(决定做了要不要真写):同一 tick 的两条通知
 *   (布局 + 右栏)会各触发一次,缺了它会 toggle 两次翻回原样。
 *
 * 写入面只有 `toggledSplit`(toggle 语义),故一律「先读后写」;桶缺席(页 body 未挂载)时
 * 记为待完成,由订阅通知 / 一次有界重试解除 —— 绝不轮询、绝不回退 DOM 点击。 */
import { activeTabOf, bucketOf, CHANGES_REVIEW_KIND, currentSessionId, layoutOf, resolveLayoutStore, resolveReviewStore, resolveRightbarStore, splitOf } from './resolve.ts'
import type { ActiveTab } from './resolve.ts'
import type { Services } from './types.ts'

/** 三种事件(仅诊断用途:①② 的判据都靠与上一次快照比对)。 */
export type DiffSplitEvent = 'open' | 'switch' | 'fullscreen'

/** 一次判定的结果。 */
export type DiffSplitOutcome =
  /** 真的调了 toggledSplit。 */
  | 'written'
  /** 现状已等于期望值(幂等读:同一 tick 的第二条通知、或事件 ③ 与 ①② 撞车)。 */
  | 'aligned'
  /** 桶在但 split 不是布尔:状态未知,不猜也不写。 */
  | 'unknown'
  /** 桶缺席(页 body 未挂载):记待完成,由订阅通知 / 有界重试解除。 */
  | 'deferred'
  /** 当前标签不是变更审阅(只对 diff 动手)。 */
  | 'no-target'
  /** 会话 / 布局 / 右栏 / 视图 store / 动作面读不到。 */
  | 'unavailable'
  /** checkTabEvent:当前 diff 标签 id 未变 ⇒ 不属于事件 ①②。 */
  | 'unchanged'
  /** flushPending:没有待完成。 */
  | 'idle'

/** 只读诊断状态。 */
export interface DiffSplitState {
  /** 上一次已知的「当前 diff 标签」id(切到非 diff 标签 / 换会话时清空)。 */
  readonly lastDiffTabId: string | undefined
  /** 上一次已知的全屏值(undefined = 尚未读到)。 */
  readonly lastFullscreen: boolean | undefined
  /** 待完成的标签 id(桶缺席时记下)。 */
  readonly pendingTabId: string | undefined
  /** 待完成所属的会话 id(与 pendingTabId 成对,换会话即作废)。 */
  readonly pendingSessionId: string | undefined
  /** 本 fiber 内累计写入次数。 */
  readonly writes: number
  /** 最近一次判定结果。 */
  readonly lastOutcome: DiffSplitOutcome
}

export interface DiffSplitOptions {
  /** 待完成的兜底重试调度(有界、至多一次);缺席则只靠订阅通知解除。 */
  requestRetry?: (flush: () => void) => void
  /** 诊断回调(默认静默;不写 window 标记、不留全局态)。 */
  log?: (event: string, detail: Readonly<Record<string, unknown>>) => void
}

export interface DiffSplitSync {
  /** 统一入口:desired = 当时全屏值;当前 diff 标签的 split ≠ desired 才写一次。 */
  apply(): DiffSplitOutcome
  /** 布局 store 通知:读全屏(值翻转 = 事件 ③)+ 顺带做一次标签事件判定。 */
  notifyLayout(): void
  /** 右栏 store 通知:标签记录提交 / focus / 切换(事件 ①②)。 */
  notifyRightbar(): void
  /** 变更审阅视图 store 通知:视图桶诞生(解除待完成)。 */
  notifyReview(): void
  /** slots 注册变化通知:座位晚到 / 重注册(解除待完成)。 */
  notifyEntries(): void
  /** uiSession.current 通知:换会话(会话级快照作废,按新会话重新判定)。 */
  notifySession(): void
  /** 待完成的写入:目标仍是当前 diff 标签时按最新全屏值补一次。 */
  flushPending(): DiffSplitOutcome
  hasPending(): boolean
  state(): DiffSplitState
}

/**
 * 创建状态跟随核心。
 * @param services - 插件解析后的服务集合(每步现解析活实例,不缓存)。
 * @param options - 重试调度与诊断回调。
 * @returns 判定 / 事件入口。
 */
export function createDiffSplitSync(services: Services, options: DiffSplitOptions = {}): DiffSplitSync {
  /** 只读快照变量:模块闭包内,不写 window(HMR 换 fiber 即重置)。 */
  let lastDiffTabId: string | undefined
  let lastFullscreen: boolean | undefined
  let pendingTabId: string | undefined
  let pendingSessionId: string | undefined
  let retryArmed = false
  let writes = 0
  let lastOutcome: DiffSplitOutcome = 'idle'

  /** 记账并回传判定结果。 */
  function record(outcome: DiffSplitOutcome): DiffSplitOutcome {
    lastOutcome = outcome
    return outcome
  }

  /** 全屏真身:布局 store 的 layoutInfo.rightbarFullscreen(读不到即 undefined)。 */
  function readFullscreen(): boolean | undefined {
    const resolved = resolveLayoutStore(services)
    const value = resolved?.snapshot.layoutInfo?.rightbarFullscreen
    return typeof value === 'boolean' ? value : undefined
  }

  /** 当前会话右栏当前面板的当前标签(链路任一层不可用即 undefined)。 */
  function currentActiveTab(sessionId: string): ActiveTab | undefined {
    const rightbar = resolveRightbarStore(services, sessionId)
    if (rightbar === undefined) return undefined
    const layout = layoutOf(rightbar.snapshot, sessionId)
    if (layout === undefined) return undefined
    return activeTabOf(layout)
  }

  /** 记待完成并挂一次有界重试(不轮询:至多一帧,之后靠订阅通知解除)。
   * 会话 id 与标签 id 成对记下:换会话后旧会话的待完成必须作废(见 flushPending)。 */
  function armPending(sessionId: string, tabId: string): void {
    pendingSessionId = sessionId
    pendingTabId = tabId
    const requestRetry = options.requestRetry
    if (retryArmed || typeof requestRetry !== 'function') return
    retryArmed = true
    requestRetry(() => {
      retryArmed = false
      flushPending()
    })
  }

  /** 清待完成。 */
  function clearPending(): void {
    pendingTabId = undefined
    pendingSessionId = undefined
  }

  /**
   * 按当前状态写一次(幂等):
   * sessionId 与全屏值都必须可读,当前标签必须是变更审阅,才可能写。
   */
  function apply(): DiffSplitOutcome {
    const sessionId = currentSessionId(services)
    if (sessionId === undefined) return record('unavailable')
    const fullscreen = readFullscreen()
    if (fullscreen === undefined) return record('unavailable')
    const active = currentActiveTab(sessionId)
    if (active === undefined || active.kind !== CHANGES_REVIEW_KIND) return record('no-target')
    const review = resolveReviewStore(services, sessionId)
    if (review === undefined) return record('unavailable')
    const toggle = review.actions.toggledSplit
    if (typeof toggle !== 'function') return record('unavailable')

    // 桶缺席 = 页 body 还没挂载(上游 effect 才 navigated 播种):记为待完成,不写也不崩
    if (bucketOf(review.snapshot, active.id) === undefined) {
      armPending(sessionId, active.id)
      options.log?.('deferred', { tabId: active.id })
      return record('deferred')
    }
    const current = splitOf(review.snapshot, active.id)
    // 桶在但 split 不是布尔:上游形状漂移,状态未知 → 不猜也不写(不留待完成)
    if (current === undefined) {
      clearPending()
      return record('unknown')
    }
    if (current === fullscreen) {
      clearPending()
      return record('aligned')
    }
    try {
      ;(toggle as (tabId: string) => void).call(review.actions, active.id)
    } catch (error) {
      // 上游对该标签还没有视图状态桶时会抛(bucket() 抛错):同缺席处理
      armPending(sessionId, active.id)
      options.log?.('write-failed', { tabId: active.id, error: String(error) })
      return record('deferred')
    }
    writes += 1
    clearPending()
    options.log?.('write', { tabId: active.id, split: fullscreen })
    return record('written')
  }

  /**
   * 标签事件判定(事件 ①②):当前标签 id 与上一次快照比对。
   * 当前标签不是变更审阅 → 清空快照(**漏触发风险的主要来源**:diff A → 文件 → diff A 必须重新触发);
   * 读不到布局 / 面板 / 标签记录时**不动快照**(读不到 ≠ 没有 diff 标签,避免误判成重新打开)。
   */
  function checkTabEvent(): DiffSplitOutcome {
    const sessionId = currentSessionId(services)
    if (sessionId === undefined) return record('unchanged')
    const active = currentActiveTab(sessionId)
    if (active === undefined) return record('unchanged')
    if (active.kind !== CHANGES_REVIEW_KIND) {
      lastDiffTabId = undefined
      return record('no-target')
    }
    if (active.id === lastDiffTabId) return record('unchanged')
    const opened = lastDiffTabId === undefined
    lastDiffTabId = active.id
    options.log?.(opened ? 'open' : 'switch', { tabId: active.id })
    return apply()
  }

  /** 待完成写入:会话与目标标签都仍是当前值才补;换会话、目标已变(或已不是 diff)即作废。 */
  function flushPending(): DiffSplitOutcome {
    const tabId = pendingTabId
    if (tabId === undefined) return record('idle')
    const sessionId = currentSessionId(services)
    if (sessionId === undefined || sessionId !== pendingSessionId) {
      clearPending()
      return record('idle')
    }
    const active = currentActiveTab(sessionId)
    if (active !== undefined && (active.kind !== CHANGES_REVIEW_KIND || active.id !== tabId)) {
      clearPending()
      return record('idle')
    }
    return apply()
  }

  return {
    apply,
    notifyLayout(): void {
      const fullscreen = readFullscreen()
      if (fullscreen !== undefined) {
        const flipped = lastFullscreen !== undefined && fullscreen !== lastFullscreen
        if (flipped) {
          options.log?.('fullscreen', { fullscreen })
          apply()
        }
        // 首次读到只记快照不写(风险 11:boot 期不算「全屏改变」);读不到则原样保留已知值
        lastFullscreen = fullscreen
      }
      checkTabEvent()
    },
    notifyRightbar(): void {
      checkTabEvent()
    },
    notifyReview(): void {
      flushPending()
    },
    notifyEntries(): void {
      flushPending()
    },
    notifySession(): void {
      // 会话级快照作废:旧会话的标签 id 不能当作新会话的「同一个标签」
      lastDiffTabId = undefined
      clearPending()
      checkTabEvent()
    },
    flushPending,
    hasPending(): boolean {
      return pendingTabId !== undefined
    },
    state(): DiffSplitState {
      return { lastDiffTabId, lastFullscreen, pendingTabId, pendingSessionId, writes, lastOutcome }
    },
  }
}
