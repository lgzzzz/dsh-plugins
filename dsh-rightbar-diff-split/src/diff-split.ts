/** 判定核心:把「当前 diff 标签的左右对比」**持续回正**到「右栏是否全屏」。
 *
 * 与旧版「只认三种事件」的根本差别:这里**没有事件筛选、没有记忆、没有重试**。
 * 每一条通知(三份 store 的提交、slots 注册变化、换会话)以及插件加载各跑一次
 * `drive()`,唯一判据是「**现读**快照里的 `split` 与**现读**的全屏值是否相等」。
 *
 * **为什么必须同步完成、绝不能起定时器**(三条上游事实合起来才成立):
 * ① 写面只有 `toggledSplit`(`tab.split = !tab.split`)——是 **toggle 语义、没有 setSplit**,
 *    所以只能「先读后写」,读与写之间不能被别的提交插进来,否则会把别人的翻转吃掉;
 * ② 该 store 由 `defineStore` 声明且**不传 `flush`** ⇒ `createSnapshotStore(init)` 默认
 *    **sync flush**:`api.subscribe(fn)` 在 zustand 的通知里**同一次调用栈内**就调回调;
 * ③ 渲染端只有一个 uSES 桥,其订阅回调只把「上一次**渲染**的值」与 `getSnapshot()` 相比。
 * 于是「用户点击提交 → 我们在同一次同步通知里回正提交」这条序列结束时,React 要么被合并成
 * 一次渲染、要么因「与上次渲染值相同」根本不排渲染 —— **视觉上等于点击没反应,一帧中间态
 * 都没有**。若改成 `requestAnimationFrame` / `setTimeout` / `queueMicrotask` / `Promise.then`
 * 之后再回正,中间那一帧就会真的画出来(按钮闪一下、图标转一下),所以本文件不出现任何调度器。
 *
 * 推论:**页头「左右对比」按钮降级为只读状态指示器**(`aria-pressed` / 图标旋转 / tooltip 文案
 * 仍准确反映当前状态,但点击改变不了状态);热键同理。按钮本身保留、DOM 不动、样式不加。
 * 也正因为如此,这里**不需要**任何「上次写入值」之类的记忆:点击带来的第 2 条通知会照常
 * 走进同一个幂等读,读到的就是已经被我们回正过的状态,于是终止。
 *
 * 桶缺席(页 body 未挂载 ⇒ 上游 `navigated` 还没播种)不再是「待完成」:上游播种本身会提交
 * 同一个 store ⇒ 会再通知我们一次,所以本次**不写、不抛、不留簿记**,等下一次通知自愈。 */
import { activeTabOf, bucketOf, CHANGES_REVIEW_KIND, currentSessionId, layoutOf, resolveLayoutStore, resolveReviewStore, resolveRightbarStore, splitOf } from './resolve.ts'
import type { ActiveTab } from './resolve.ts'
import type { Services } from './types.ts'

/** 一次回正的判定结果。 */
export type DiffSplitOutcome =
  /** 真的调了 toggledSplit(发生了回正)。 */
  | 'written'
  /** 现状已等于全屏值(幂等读:稳态下每条通知都走这里)。 */
  | 'aligned'
  /** 桶缺席(页 body 未挂载,上游 `navigated` 尚未播种)→ 本次不写,靠下一次通知自愈。 */
  | 'no-bucket'
  /** 桶在但 split 不是布尔:形状漂移,不猜也不写。 */
  | 'unknown'
  /** 当前标签不是变更审阅(只对 diff 动手)。 */
  | 'no-target'
  /** 会话 / 全屏值 / 变更审阅 store / toggledSplit 动作面读不到。 */
  | 'unavailable'
  /** toggledSplit 抛错(如上游 `bucket()` 抛):不崩,靠下一次通知自愈。 */
  | 'write-failed'

/** 只读诊断状态(全部不参与判定)。 */
export interface DiffSplitState {
  /** 最近一次成功读到的全屏值(只读诊断,不参与判定)。 */
  readonly fullscreen: boolean | undefined
  /** 本 fiber 内累计回正次数。 */
  readonly writes: number
  /** 最近一次判定结果。 */
  readonly lastOutcome: DiffSplitOutcome
}

export interface DiffSplitOptions {
  /** 诊断回调(默认静默;不写 window 标记、不留全局态)。 */
  log?: (event: string, detail: Readonly<Record<string, unknown>>) => void
}

export interface DiffSplitSync {
  /** 唯一入口:读全屏 + 读当前 diff 标签 → 幂等回正;同一次同步通知内完成,绝不起定时器。 */
  drive(): DiffSplitOutcome
  /** 只读诊断。 */
  state(): DiffSplitState
}

/**
 * 创建「持续回正」核心。
 * @param services - 插件解析后的服务集合(每步现解析活实例,不缓存)。
 * @param options - 诊断回调。
 * @returns 判定入口与只读诊断。
 */
export function createDiffSplitSync(services: Services, options: DiffSplitOptions = {}): DiffSplitSync {
  /** 只读诊断变量:模块闭包内,不写 window(HMR 换 fiber 即重置)。 */
  let fullscreen: boolean | undefined
  let writes = 0
  let lastOutcome: DiffSplitOutcome = 'unavailable'

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

  /**
   * 回正一次(幂等):sessionId 与全屏值都必须可读,当前标签必须是变更审阅,
   * 桶要存在、`split` 要是布尔,才可能写。任何一环不可用都只是本次 no-op ——
   * 不抛、不记待完成、不排重试,等下一次通知(这才是新的「自愈」口径)。
   */
  function drive(): DiffSplitOutcome {
    const sessionId = currentSessionId(services)
    if (sessionId === undefined) return record('unavailable')
    const desired = readFullscreen()
    if (desired === undefined) return record('unavailable')
    fullscreen = desired

    const active = currentActiveTab(sessionId)
    if (active === undefined || active.kind !== CHANGES_REVIEW_KIND) return record('no-target')

    const review = resolveReviewStore(services, sessionId)
    if (review === undefined) return record('unavailable')
    const toggle = review.actions.toggledSplit
    if (typeof toggle !== 'function') return record('unavailable')

    // 桶缺席 = 页 body 还没挂载(上游 effect 才 navigated 播种):上游播种会再通知一次,故直接等
    if (bucketOf(review.snapshot, active.id) === undefined) return record('no-bucket')
    const current = splitOf(review.snapshot, active.id)
    // 桶在但 split 不是布尔:上游形状漂移,状态未知 → 不猜也不写
    if (current === undefined) return record('unknown')
    if (current === desired) return record('aligned')

    try {
      ;(toggle as (tabId: string) => void).call(review.actions, active.id)
    } catch (error) {
      // 上游对该标签还没有视图状态桶时会抛(bucket() 抛错):当次放弃,靠下一次通知自愈
      options.log?.('write-failed', { tabId: active.id, error: String(error) })
      return record('write-failed')
    }
    writes += 1
    options.log?.('write', { tabId: active.id, split: desired })
    return record('written')
  }

  return {
    drive,
    state(): DiffSplitState {
      return { fullscreen, writes, lastOutcome }
    },
  }
}
