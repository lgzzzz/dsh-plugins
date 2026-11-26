/**
 * 「本地变更」行内评论框的键盘约定：Enter 添加到输入框、Shift+Enter 换行、Esc 取消。
 *
 * 上游 forge 包的行内评论框（`ReviewComposer`）是一个普通 `<textarea>` 加一排按钮：取消、
 * 添加到输入框、待审 / 发布，以及插件经 `forge.diff.comment.actions` 加进来的按钮。它没有
 * 任何按键处理——Enter 就是换行，Esc 什么都不做。本插件把这三个动作接过来：
 *
 * | 按键 | 结果 |
 * |---|---|
 * | `Enter` | 与「添加到输入框」按钮等价：评论文本进会话输入框，评论框关闭 |
 * | `Shift+Enter` | 不拦，浏览器原生换行 |
 * | `Esc` | 与「取消」按钮等价：关闭评论框，草稿随组件卸载丢弃 |
 *
 * **为什么在 `document` 捕获阶段**：Enter 的默认动作（插入换行）必须赶在 textarea 收到按键
 * 之前拦掉；Esc 还要在冒泡到 `window` 上的全局快捷键之前收口（`dsh-client-shortcuts` 的
 * 固定键在 `window` 冒泡阶段读 `defaultPrevented`，被 `preventDefault` 的手势会自行让位）。
 *
 * **为什么按文案认按钮、而不是直接调 props 上的 `addToInput`**：按钮的 `onClick` 就是上游
 * 完整路径——`settleQuote` 的接受 / 拒绝两个分支、拒绝时在评论框里显示告警（会话输入框被
 * 占住时会发生）、接受时 `onQuoted` 留下引用再 `close()`。自己调 `addToInput` 会漏掉拒绝时
 * 的提示。认按钮用的是当前语言的按钮文案：文案 key 从同一个组件的 props 上读
 * （`actions.quoteCopy?.add ?? 'review.addToInput'`），再由它的 `t` 翻出来，所以切语言、
 * 改按钮顺序都不影响。
 *
 * 输入法：`isComposing` / `keyCode === 229` 一律放行——中文输入法里回车选词不会把评论交出去。
 * 长按重复（`repeat`）也放行：按住 Enter 不该连续往输入框里塞同一段评论。
 *
 * 作用域：只认 `[data-forge-comment]` 里的 `<textarea>`。这个属性只由行内评论框输出，
 * 「本地变更」与「变更请求」两个改动页共用同一个组件，因此两处都生效；会话输入框、变更请求
 * 回复框等其它输入面不受影响。上游把它挂在评论框的 `<section>` 上，`ReviewComposer` 直接
 * 返回这个 section，所以从它向上第一层组件 fiber 就是评论框的 props（见 `fiber.ts`）。
 *
 * 降级：取不到 props / 找不到按钮 / `onClick` 抛错时只告警（同一句只报一次），并且**不拦**
 * 这次按键——Enter 退回换行，不会吞掉输入；其它行为不受影响。装上时在文档根留一个
 * `data-dsh-changes-behavior-comment-keys` 标记，卸载时连同监听一起清掉。
 *
 * 上游锚点与手工验证方式见 docs/dsh-changes-behavior.md。
 */
import { findAncestorProps, findClickHandler } from './fiber.ts'

/** 行内评论框 `<section>` 上的锚点属性；上游只在这里输出它。 */
export const COMPOSER_ATTRIBUTE = 'data-forge-comment'

/** 评论框选择器：`[data-forge-comment]`。 */
export const COMPOSER_SELECTOR = `[${COMPOSER_ATTRIBUTE}]`

/** 「添加到输入框」按钮的默认文案 key（上游 `INPUT_QUOTE_COPY.add`）。 */
export const ADD_LABEL_KEY = 'review.addToInput'

/** 文档根元素上的生效标记；存在即表示本行为装上了。 */
export const MARKER_ATTRIBUTE = 'data-dsh-changes-behavior-comment-keys'

/** 本模块接管的两个动作，与评论框里那两个按钮一一对应。 */
export type ComposerAction = 'add' | 'cancel'

/**
 * 一次按键的处理结论：
 * - `applied`：已经按上游按钮的路径执行；
 * - `skipped`：不归本模块管（别的按键 / 输入法 / 空文本 / 按钮禁用），按键原样放行；
 * - `unavailable`：认出了评论框但取不到句柄，按键放行并已告警。
 */
export type ComposerKeyOutcome = 'applied' | 'skipped' | 'unavailable'

/** `keydown` 里本模块用到的字段（生产环境是 `KeyboardEvent`，测试接缝）。 */
export interface KeyEventLike {
  readonly key?: string
  readonly keyCode?: number
  readonly isComposing?: boolean
  readonly repeat?: boolean
  readonly shiftKey?: boolean
  readonly metaKey?: boolean
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
  readonly defaultPrevented?: boolean
  readonly target?: unknown
  preventDefault(): void
  stopPropagation(): void
}

/** 评论框子树里本模块用到的元素面（生产环境是 `Element` / `HTMLTextAreaElement`，测试接缝）。 */
export interface ComposerElementLike {
  /** textarea 的当前文本（React 受控 / 非受控都读得到）。 */
  readonly value?: string
  /** 按钮的可见文案，用来认「添加到输入框」。 */
  readonly textContent?: string | null
  /** 原生按钮的禁用态：禁用时上游的 `onClick` 本来也不会跑。 */
  readonly disabled?: boolean
  /** 已脱离文档的节点不再响应（防止卸载后残留的按键再点一次）。 */
  readonly isConnected?: boolean
  closest(selector: string): ComposerElementLike | null
  querySelectorAll?(selector: string): ArrayLike<ComposerElementLike>
}

/** 认出来的评论框：section 与它里面的输入区。 */
export interface ComposerField {
  readonly section: ComposerElementLike
  readonly field: ComposerElementLike
}

/** 上游 `ReviewComposer` 那一份 props 里本模块用到的面（React 内部结构，测试接缝）。 */
export interface ComposerPropsFace {
  /** 选中范围（含 `comment.body` 的底稿）。 */
  readonly selection: Record<string, unknown>
  /** 评论框动作集合：`addToInput` / `quoteCopy` / `onQuoted` 在这里。 */
  readonly actions: Record<string, unknown>
  /** 取消：上游「取消」按钮的 `onClick` 就是它。 */
  readonly close: () => void
  /** 上游 `PropsLocale` 的翻译函数。 */
  readonly t?: unknown
}

/** 安装期可注入项（测试接缝）。 */
export interface CommentKeysRuntime {
  /** 输出一条不带前缀的诊断；生产环境由 `install.ts` 补上插件前缀。 */
  readonly warn?: (message: string) => void
}

/** 安装需要的文档能力：捕获监听 + 根标记（生产环境是 `Document`，测试接缝）。 */
export interface CommentKeysDocument {
  readonly documentElement?: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void } | null
  addEventListener(type: string, listener: (event: KeyEventLike) => void, capture: boolean): void
  removeEventListener(type: string, listener: (event: KeyEventLike) => void, capture: boolean): void
}

/** 默认不输出诊断（单元测试与无告警安装共用）。 */
const noWarn = (): void => {}

/** 一个可被 `Object.keys` 读取的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 鸭子类型判定「可 `closest` 的节点」，与仓库内其它捕获层同一手法。 */
function hasClosest(value: unknown): value is ComposerElementLike {
  return typeof value === 'object'
    && value !== null
    && 'closest' in value
    && typeof (value as { closest?: unknown }).closest === 'function'
}

/**
 * 把一次按键翻成评论框动作。
 *
 * `Shift+Enter` 返回 null（交给浏览器换行）；带任何修饰键的 Enter / Esc 也返回 null，
 * 让 `⌘Enter` 这类组合留给上游或其它插件。
 *
 * @param event - 一次 `keydown`。
 * @returns `add` / `cancel`，或 null（不归本模块管）。
 */
export function keyAction(event: KeyEventLike): ComposerAction | null {
  if (event.defaultPrevented === true) return null
  if (event.isComposing === true || event.keyCode === 229) return null
  if (event.repeat === true) return null
  if (event.shiftKey === true || event.metaKey === true || event.ctrlKey === true || event.altKey === true) return null
  if (event.key === 'Escape') return 'cancel'
  return event.key === 'Enter' ? 'add' : null
}

/**
 * 事件目标落在行内评论框的 `<textarea>` 里就返回它的 section。
 *
 * @param target - `keydown` 的事件目标。
 * @returns 评论框；不是评论框的输入区、或节点已经脱离文档时为 null。
 */
export function composerOf(target: unknown): ComposerField | null {
  if (!hasClosest(target)) return null
  // 目标必须**自己**是 textarea：评论框标题、按钮上的按键不归这里管。
  if (target.closest('textarea') !== target) return null
  const section = target.closest(COMPOSER_SELECTOR)
  if (section === null || section.isConnected === false) return null
  return { section, field: target }
}

/** 一份 props 是不是 `ReviewComposer` 的那份：`selection` / `actions` 是对象，`close` 是函数。 */
function isComposerProps(props: Record<string, unknown>): boolean {
  return isRecord(props.selection) && isRecord(props.actions) && typeof props.close === 'function'
}

/**
 * 从评论框的 section 向上取 `ReviewComposer` 的 props。
 *
 * @param section - `[data-forge-comment]` 那个 section。
 * @returns props；不是 React 节点、上溯超限或结构对不上时为 null。
 */
export function composerPropsOf(section: unknown): ComposerPropsFace | null {
  const props = findAncestorProps(section, isComposerProps)
  return props === null ? null : (props as unknown as ComposerPropsFace)
}

/**
 * 当前语言里「添加到输入框」的按钮文案。
 *
 * @param props - 评论框的 props。
 * @returns 文案；没有 `t`、`t` 抛错或翻出来不是字符串时为 null。
 */
export function addLabelOf(props: ComposerPropsFace): string | null {
  const actions = props.actions
  const quoteCopy = isRecord(actions.quoteCopy) ? actions.quoteCopy : null
  const key = quoteCopy !== null && typeof quoteCopy.add === 'string' && quoteCopy.add.trim() !== ''
    ? quoteCopy.add
    : ADD_LABEL_KEY
  const translate = props.t
  if (typeof translate !== 'function') return null
  try {
    const label = (translate as (key: string) => unknown)(key)
    if (typeof label !== 'string') return null
    const trimmed = label.trim()
    return trimmed === '' ? null : trimmed
  } catch {
    return null
  }
}

/**
 * 按文案认「添加到输入框」按钮，不依赖按钮顺序。
 *
 * @param section - 评论框的 section。
 * @param props - 评论框的 props（用来翻出当前语言的文案）。
 * @returns 那个按钮；文案缺省或没有按钮对得上时为 null。
 */
export function addButtonOf(section: ComposerElementLike, props: ComposerPropsFace): ComposerElementLike | null {
  const label = addLabelOf(props)
  if (label === null) return null
  const buttons = section.querySelectorAll?.('button')
  if (buttons === undefined || buttons === null) return null
  for (const button of Array.from(buttons)) {
    if ((button.textContent ?? '').trim() === label) return button
  }
  return null
}

/**
 * 处理一次 `keydown`：Enter 点「添加到输入框」、Esc 点「取消」。
 *
 * 只在确认按键属于评论框、且句柄都在时才 `preventDefault`；认不出来一律放行，让按键退回
 * 浏览器默认（Enter 换行）。
 *
 * @param event - 一次 `keydown`。
 * @param warn - 诊断输出；同一句由安装层去重。
 * @returns 处理结论。
 */
export function handleComposerKey(event: KeyEventLike, warn: (message: string) => void = noWarn): ComposerKeyOutcome {
  const action = keyAction(event)
  if (action === null) return 'skipped'
  const composer = composerOf(event.target)
  if (composer === null) return 'skipped'
  const props = composerPropsOf(composer.section)
  if (props === null) {
    warn('找不到行内评论框的 props，Enter / Esc 没有接管')
    return 'unavailable'
  }
  if (action === 'cancel') {
    // Esc 顺手在捕获阶段收口，别让同一个手势再触发页面级快捷键。
    event.preventDefault()
    event.stopPropagation()
    try {
      props.close()
    } catch {
      warn('关闭行内评论框失败，Esc 这次没有生效')
      return 'unavailable'
    }
    return 'applied'
  }
  // Enter：先确认这次真的有按钮可点，再去拦默认换行；句柄缺失时把按键原样留给浏览器。
  const button = addButtonOf(composer.section, props)
  if (button === null) {
    warn('找不到评论框的「添加到输入框」按钮，Enter 没有接管')
    return 'unavailable'
  }
  const handler = findClickHandler(button)
  if (handler === null) {
    warn('「添加到输入框」按钮上没有 onClick，Enter 没有接管')
    return 'unavailable'
  }
  event.preventDefault()
  // 空文本（按钮此时是禁用的）只拦换行，不提交。
  if (button.disabled === true || (composer.field.value ?? '').trim() === '') return 'skipped'
  try {
    handler()
  } catch {
    warn('「添加到输入框」按钮的 onClick 抛错，这次 Enter 没有生效')
    return 'unavailable'
  }
  return 'applied'
}

/**
 * 装上评论框键盘约定。
 *
 * @param doc - 目标文档；非浏览器环境省略时整体为空操作。
 * @param runtime - 测试可注入的诊断输出。
 * @returns 卸载函数：移除捕获监听与文档标记。
 */
export function installCommentKeys(
  doc: CommentKeysDocument | undefined = typeof document === 'undefined'
    ? undefined
    : document as unknown as CommentKeysDocument,
  runtime: CommentKeysRuntime = {},
): () => void {
  if (doc === undefined) return () => {}
  // 结构对不上时每次按键都会走到告警；同一句只报一次，避免刷屏。
  const reported = new Set<string>()
  const warn = (message: string): void => {
    if (reported.has(message)) return
    reported.add(message)
    runtime.warn?.(message)
  }
  const listener = (event: KeyEventLike): void => { handleComposerKey(event, warn) }
  doc.addEventListener('keydown', listener, true)
  doc.documentElement?.setAttribute(MARKER_ATTRIBUTE, '')
  return () => {
    doc.removeEventListener('keydown', listener, true)
    doc.documentElement?.removeAttribute(MARKER_ATTRIBUTE)
  }
}
