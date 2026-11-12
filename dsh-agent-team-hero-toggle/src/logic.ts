/**
 * 团队协作 Hero 开关的纯逻辑：可见性、写入结果与错误文案。
 *
 * 独立成文件是为了让 `node test/*.test.mjs` 能直接 import（Node 的类型擦除）
 * 而不必拉进 React；组件只做「读投影 + 调回调 + 画控件」。
 */

/** 远程调用失败：与 typert `RemoteResult` 的失败分支同形。 */
export interface RemoteFailure {
  readonly ok: false
  readonly error: { readonly message: string }
}

/** 远程调用成功：成功分支的 value 本控件不消费。 */
export interface RemoteSuccess {
  readonly ok: true
  readonly value: void
}

/** `remote.agentTeams.setEnabled` 的返回形状。 */
export type RemoteResult = RemoteSuccess | RemoteFailure

/** 控件可见性输入：两类子代理判定 + 投影是否已到达。 */
export interface VisibilityInput {
  /** 当前地址指向一个子代理会话。 */
  readonly addressedChild: boolean
  /** 会话目录里登记为 subagent 来源。 */
  readonly listedChild: boolean
  /** `agentTeam` 投影已加载。 */
  readonly hasProjection: boolean
}

/**
 * 是否渲染开关。
 *
 * 只对根会话显示：子代理会话里 Host 会以 `TEAM_LEAD_REQUIRED` 拒绝写入，
 * 投影缺席时（未挂团队服务）也不显示。
 *
 * @param input - 当前会话与投影状态。
 * @returns 是否渲染开关。
 */
export function shouldRender(input: VisibilityInput): boolean {
  return !input.addressedChild && !input.listedChild && input.hasProjection
}

/**
 * 读取一次写入失败的原因；成功返回 null。
 *
 * @param result - 远程调用结果。
 * @returns 失败原因，或 null。
 */
export function failureMessage(result: RemoteResult): string | null {
  return result.ok ? null : result.error.message
}

/**
 * 把异常收敛成一行可读文案。
 *
 * @param cause - 任意抛出值。
 * @returns 异常消息或字符串化结果。
 */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
