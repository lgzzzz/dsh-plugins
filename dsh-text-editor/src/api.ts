/**
 * 公开能力契约：dsh-text-editor 提供给其他客户端插件的能力面。
 *
 * 本插件自身就是文件面的实现者：右栏（文件树 / 对话文件链接）的文本文件由
 * src/sidebar.ts 注册的右栏资源 tab 类型接管。本服务是给**其他插件**主动调用的
 * 入口：把某个路径开进右栏编辑器，或在会话主区展示一组 diff。
 *
 * 其他客户端插件在自身导出的 `inject` 里声明本服务名，然后在 apply 里取用：
 *
 *   export const inject = ['slots', 'dsh-text-editor']
 *   apply(ctx) {
 *     const te = ctx.get('dsh-text-editor')   // 未就绪时返回 undefined，使用前请判空
 *     te?.openFile({ path, cwd, sessionId })  // 能力 1：在右栏打开文件（可编辑/保存）
 *     te?.showDiff({ files, initialIndex })   // 能力 2：在会话主区「差异」tab 顺序展示文件 diff
 *   }
 *
 * 提供方（本插件）在 apply 里用 ctx.provide(TEXT_EDITOR_SERVICE, api) 注册；
 * 框架保证：消费方声明 inject 后会在提供方就绪时再 apply，卸载时自动 park。
 */
export const TEXT_EDITOR_SERVICE = 'dsh-text-editor'

/**
 * 能力 1：把文件开进**右栏编辑器**（Monaco，可编辑、可保存；保存走会话沙箱策略）。
 *
 * 路径按 `dsh-resource://file/session/<会话>/<路径>` 地址打开：文本文件由本插件接管，
 * 图片 / PDF 由内置文档预览接管；同一文件已打开时只是聚焦既有 tab。
 * 目标会话的右栏未挂载（空白会话 / 右栏插件缺席）时不动作。
 */
export interface OpenFileRequest {
  /** 文件路径（工作区相对路径，或绝对路径；`cwd` 缺省时相对路径按该会话工作区根解析）。 */
  path: string
  /** 相对路径解析基准 / 判定「工作区根内」用的根（可选）。 */
  cwd?: string
  /** 打开到哪个会话的右栏、以及保存时解析沙箱策略所用的会话 id（可选，缺省当前活动会话）。 */
  sessionId?: string
}

/** 一个文件的 diff 数据：调用方传入状态前后内容，纯客户端渲染（不经宿主读取磁盘）。 */
export interface DiffFile {
  /** 展示名；缺省用 path 的 basename，无 path 时回落为「文件 i」。 */
  label?: string
  /** 可选路径：仅用于语言高亮与展示，不参与任何磁盘解析。 */
  path?: string
  /** 之前的状态（可为空串，表示新增文件）。 */
  before: string
  /** 之后的状态（可为空串，表示删除文件）。 */
  after: string
}

/** 能力 2：在会话主区「差异」tab 顺序展示一组文件的 diff（手动 上一个/下一个 推进）。 */
export interface ShowDiffRequest {
  files: DiffFile[]
  /** 初始展示第几个文件的 diff（0 起；越界自动 clamp 到合法范围；缺省 0 = 第一个文件）。 */
  initialIndex?: number
  /** 透传给视图，目前不参与渲染（预留）。 */
  sessionId?: string
}

/** dsh-text-editor 对外提供的能力面。 */
export interface TextEditorService {
  openFile(request: OpenFileRequest): void
  showDiff(request: ShowDiffRequest): void
}
