/** 本插件的 Web 字典。文案与模型菜单里的团队开关保持同一套说法。 */

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'dsh-agent-team-hero-toggle'

/** 简体中文字典，同时是键的源集合。 */
export const zh = {
  label: '团队协作',
  ariaLabel: '启用智能体团队协作',
  description: '通过共享任务板协调多个智能体的分工与进度，复杂任务表现更佳，token 开销也相应更高。',
  failed: '无法确认团队协作设置已保存，请重试：{message}',
}

/** 本插件的 locale 键联合。 */
export type HeroToggleKey = keyof typeof zh

/** 英文字典，按中文键集合校验。 */
export const en = {
  label: 'Agent team',
  ariaLabel: 'Enable agent teamwork',
  description: 'Coordinate multiple agents with a shared task board for better results on complex tasks, at a correspondingly higher token cost.',
  failed: 'Could not confirm the agent teamwork setting was saved. Try again: {message}',
} satisfies Record<HeroToggleKey, string>
