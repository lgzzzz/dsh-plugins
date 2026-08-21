/**
 * 公开能力契约：dsh-text-editor 提供给其他客户端插件的能力面。
 *
 * 本插件定位为「基础能力提供方」，不再自行实现具体功能（如点击文件链接自动打开）。
 * 其他客户端插件在自身导出的 `inject` 里声明本服务名，然后在 apply 里取用：
 *
 *   export const inject = ['slots', 'dsh-text-editor']
 *   apply(ctx) {
 *     const te = ctx.get('dsh-text-editor')   // 未就绪时返回 undefined，使用前请判空
 *     te?.openFile({ path, cwd, sessionId })  // 能力 1：打开文件到「文件」tab（可编辑/保存）
 *     te?.showDiff({ files })                 // 能力 2：在「差异」tab 顺序展示文件 diff
 *   }
 *
 * 提供方（本插件）在 apply 里用 ctx.provide(TEXT_EDITOR_SERVICE, api) 注册；
 * 框架保证：消费方声明 inject 后会在提供方就绪时再 apply，卸载时自动 park。
 */
export const TEXT_EDITOR_SERVICE = 'dsh-text-editor'

/** 能力 1：打开一个文件到「文件」tab，可编辑、可保存（保存走会话沙箱策略）。 */
export interface OpenFileRequest {
  /** 文件路径（支持 `~` 展开；相对路径按 cwd 解析）。 */
  path: string
  /** 相对路径解析基准（可选）。 */
  cwd?: string
  /** 保存时解析沙箱策略所用的会话 id（可选）。 */
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

/** 能力 2：在「差异」tab 顺序展示一组文件的 diff（手动 上一个/下一个 推进）。 */
export interface ShowDiffRequest {
  files: DiffFile[]
  /** 透传给视图，目前不参与渲染（预留）。 */
  sessionId?: string
}

/** dsh-text-editor 对外提供的能力面。 */
export interface TextEditorService {
  openFile(request: OpenFileRequest): void
  showDiff(request: ShowDiffRequest): void
}
