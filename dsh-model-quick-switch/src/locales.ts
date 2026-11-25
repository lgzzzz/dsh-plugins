/**
 * 本插件的 Web 字典：快捷菜单 / 思考等级浮层、设置页、快捷操作行与错误提示。
 *
 * 可见文案全部走 Client locale；纯逻辑模块（`actions.ts` / `model.ts`）接收一个默认取简体
 * 中文的文案面，浏览器半部按当前 locale 换掉。
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { QuickActionTexts } from './actions.ts'
import type { ModelTexts } from './model.ts'

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'dsh-model-quick-switch'

/** 本插件命名空间的类型形态（供注册项 `locale:` 与 `t` 座位使用）。 */
export type ModelLocaleNS = typeof NS

/** 简体中文字典，同时是键的源集合。 */
export const zh = {
  modelTitle: '快捷菜单',
  modelUnit: '个模型',
  modelEmptyCount: '列表里还没有模型',
  modelEmptyHint: '在「设置 → 模型快速切换」里添加要在这里出现的模型。',
  modelListLabel: '模型与操作',
  modelEnterHint: 'Enter 切换模型',
  effortTitle: '选择思考等级',
  effortUnit: '个等级',
  effortEmptyCount: '没有可选等级',
  effortEmptyHint: '这个模型没有公布思考等级。',
  effortListLabel: '思考等级',
  effortEnterHint: 'Enter 切换模型',
  footerMove: '↑ ↓ 选择',
  footerPage: '← → 翻一屏',
  footerEnter: 'Enter',
  footerEscClose: 'Esc 关闭',
  footerEscBack: 'Esc 返回',
  footerEnterExecute: 'Enter 执行',
  currentBadge: '当前',
  countRange: '{total} {unit} · 显示 {from}–{to}',
  countActions: '{models} {unit} · {actions} 个操作',
  subhead: '模型：{title} · {subtitle}',
  pendingModel: '正在切换模型…',
  pendingCatalog: '正在读取模型目录…',
  worktreeTitle: '新建工作树',
  worktreeCancel: '取消工作树',
  worktreeOn: '已开启',
  worktreeOff: '已关闭',
  teamTitle: '团队协作',
  teamOn: '已开启',
  teamOff: '已关闭',
  actionBadge: '操作',
  defaultTitle: '默认',
  defaultSubtitle: '跟随模型目录的默认强度',
  defaultFollow: '跟随目录默认 · {value}',
  effortSubtitle: '思考等级',
  outsideBadge: '目录外',
  settingsTitle: '模型快速切换',
  settingsIntro: '按 ⌘⌥U（Windows / Linux 上是 Ctrl+Alt+U）打开快捷菜单：顶部两行是「新建工作树」与「团队协作」开关，生效于当前会话；下面是模型列表，先选模型，模型公布了思考等级时再选一档，最后切换当前会话使用的模型。下面这份列表就是模型候选，顺序与浮层一致。',
  settingsModelsTitle: '浮层里的模型',
  settingsCount: '{count} 个',
  settingsUnavailable: '当前 DSH 没有提供本插件的设置命名空间（dsh-model-quick-switch 未启用或被组合排除），无法保存模型列表。',
  settingsLoading: '正在读取设置…',
  settingsEmpty: '还没有添加模型。点下面的「添加模型」从当前模型目录里挑，添加后按快捷键就能选它。',
  settingsReadonly: '当前设置文档是只读的，添加与删除已禁用。',
  settingsAdd: '添加模型',
  settingsCollapse: '收起模型目录',
  settingsRefresh: '刷新模型目录',
  settingsCatalogLoading: '正在加载目录…',
  settingsDelete: '删除',
  settingsDeleteAria: '从列表删除 {title}',
  settingsAdded: '已添加',
  settingsAddOne: '添加',
  settingsNoProviderModels: '这个提供方没有可用模型。',
  settingsCatalogEmpty: '模型目录为空：先在「设置 → 模型」里配置提供方与 API 密钥。',
  currentNoSession: '当前没有打开的会话。',
  currentNoDefault: '当前会话：还没有选择模型，模型目录也没有给出默认值。',
  currentFollowDefault: '当前会话：跟随默认（{detail}）',
  currentDetail: '当前会话：{detail}',
  errNoSessionSwitch: '当前没有打开的会话：先在左侧栏打开或新建一个会话，再切换模型。',
  errNoSessionAction: '当前没有打开的会话：先在左侧栏打开或新建一个会话，再使用这里的开关。',
  errCatalogUnavailable: '模型目录服务不可用（remote.session 尚未就绪）。',
  errCatalogDisconnected: '模型目录服务不可用（remote.session 已断开）。',
  errSelectUnavailable: '模型选择服务不可用（remote.session 尚未就绪）。',
  errSwitchFailed: '切换失败：{message}',
  errWorktreeUnavailable: '工作树服务不可用（forge 面板未启用）。',
  errWorktreeExists: '当前会话已经有工作树：{detail}。',
  errWorktreeCreated: '已创建',
  errActionFailed: '{action}失败：{message}',
  errTeamUnavailable: '团队协作服务不可用（agentTeams 未挂载）。',
  errTeamSaveFailed: '保存团队协作设置失败：{message}',
  errSettingsUnavailable: '设置服务不可用，无法保存模型列表。',
  errSettingsRejected: 'Host 拒绝了这次写入：设置不可写，或列表没有通过校验。',
  errSaveFailed: '保存失败：{message}',
  fixedLabel: '模型快速切换',
  settingsLabel: '模型快速切换',
}

/** 本插件的 locale 键联合。 */
export type ModelKey = keyof typeof zh

/** 英文字典，按中文键集合校验。 */
export const en = {
  modelTitle: 'Quick menu',
  modelUnit: 'models',
  modelEmptyCount: 'No models in the list',
  modelEmptyHint: 'Add models in Settings → Model quick switch, then they appear here.',
  modelListLabel: 'Models and actions',
  modelEnterHint: 'Enter switches model',
  effortTitle: 'Choose reasoning effort',
  effortUnit: 'efforts',
  effortEmptyCount: 'No efforts available',
  effortEmptyHint: 'This model does not publish reasoning efforts.',
  effortListLabel: 'Reasoning efforts',
  effortEnterHint: 'Enter switches model',
  footerMove: '↑ ↓ select',
  footerPage: '← → page',
  footerEnter: 'Enter',
  footerEscClose: 'Esc close',
  footerEscBack: 'Esc back',
  footerEnterExecute: 'Enter run',
  currentBadge: 'Current',
  countRange: '{total} {unit} · showing {from}–{to}',
  countActions: '{models} {unit} · {actions} actions',
  subhead: 'Model: {title} · {subtitle}',
  pendingModel: 'Switching model…',
  pendingCatalog: 'Loading model catalog…',
  worktreeTitle: 'New worktree',
  worktreeCancel: 'Cancel worktree',
  worktreeOn: 'On',
  worktreeOff: 'Off',
  teamTitle: 'Agent team',
  teamOn: 'On',
  teamOff: 'Off',
  actionBadge: 'Action',
  defaultTitle: 'Default',
  defaultSubtitle: 'Follow the catalog default effort',
  defaultFollow: 'Follow catalog default · {value}',
  effortSubtitle: 'Reasoning effort',
  outsideBadge: 'Not in catalog',
  settingsTitle: 'Model quick switch',
  settingsIntro: 'Press ⌘⌥U (Ctrl+Alt+U on Windows / Linux) to open the quick menu: the top two rows toggle "New worktree" and "Agent team" for the current session; below is the model list. Pick a model, then an effort when the model publishes one, and the current session switches. This list is the quick-menu candidates, in the same order.',
  settingsModelsTitle: 'Models in the quick menu',
  settingsCount: '{count}',
  settingsUnavailable: 'This DSH does not provide the plugin settings namespace (dsh-model-quick-switch is disabled or excluded), so the model list cannot be saved.',
  settingsLoading: 'Loading settings…',
  settingsEmpty: 'No models added yet. Use "Add model" below to pick one from the current model catalog; after that the shortcut selects it.',
  settingsReadonly: 'The settings document is read-only, so adding and removing are disabled.',
  settingsAdd: 'Add model',
  settingsCollapse: 'Hide catalog',
  settingsRefresh: 'Refresh catalog',
  settingsCatalogLoading: 'Loading catalog…',
  settingsDelete: 'Remove',
  settingsDeleteAria: 'Remove {title} from the list',
  settingsAdded: 'Added',
  settingsAddOne: 'Add',
  settingsNoProviderModels: 'This provider has no available models.',
  settingsCatalogEmpty: 'The model catalog is empty: configure a provider and API key in Settings → Models first.',
  currentNoSession: 'No session is open.',
  currentNoDefault: 'Current session: no model selected yet, and the catalog provides no default.',
  currentFollowDefault: 'Current session: following the default ({detail})',
  currentDetail: 'Current session: {detail}',
  errNoSessionSwitch: 'No session is open: open or create one in the sidebar, then switch the model.',
  errNoSessionAction: 'No session is open: open or create one in the sidebar, then use these toggles.',
  errCatalogUnavailable: 'The model catalog service is unavailable (remote.session is not ready yet).',
  errCatalogDisconnected: 'The model catalog service is unavailable (remote.session disconnected).',
  errSelectUnavailable: 'The model selection service is unavailable (remote.session is not ready yet).',
  errSwitchFailed: 'Switch failed: {message}',
  errWorktreeUnavailable: 'The worktree service is unavailable (the forge panel is not enabled).',
  errWorktreeExists: 'This session already has a worktree: {detail}.',
  errWorktreeCreated: 'created',
  errActionFailed: '{action} failed: {message}',
  errTeamUnavailable: 'The agent team service is unavailable (agentTeams is not mounted).',
  errTeamSaveFailed: 'Could not save the agent teamwork setting: {message}',
  errSettingsUnavailable: 'The settings service is unavailable, so the model list cannot be saved.',
  errSettingsRejected: 'The Host rejected this write: settings are not writable, or the list failed validation.',
  errSaveFailed: 'Save failed: {message}',
  fixedLabel: 'Model quick switch',
  settingsLabel: 'Model quick switch',
} satisfies Record<ModelKey, string>

/** locale 服务缺席时的翻译座位：按简体中文字典与 `{name}` 占位符取值。 */
export const translateZh: TranslateNS<ModelLocaleNS> = ((key: string, params?: Record<string, unknown>) => {
  const template = zh[key as keyof typeof zh] as string
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => name in params ? String(params[name]) : whole)
}) as TranslateNS<ModelLocaleNS>

/** 快捷操作行的文案面（默认简体中文）。 */
export function quickActionTextsOf(t: TranslateNS<ModelLocaleNS>): QuickActionTexts {
  return {
    worktreeTitle: t('worktreeTitle'),
    worktreeOn: t('worktreeOn'),
    worktreeOff: t('worktreeOff'),
    teamTitle: t('teamTitle'),
    teamOn: t('teamOn'),
    teamOff: t('teamOff'),
    actionBadge: t('actionBadge'),
  }
}

/** 模型/思考等级行的文案面（默认简体中文）。 */
export function modelTextsOf(t: TranslateNS<ModelLocaleNS>): ModelTexts {
  return {
    defaultTitle: t('defaultTitle'),
    defaultSubtitle: t('defaultSubtitle'),
    defaultFollow: value => t('defaultFollow', { value }),
    effortSubtitle: t('effortSubtitle'),
    outsideBadge: t('outsideBadge'),
  }
}

/** 快捷操作行的简体中文默认文案。 */
export const ZH_QUICK_ACTION_TEXTS: QuickActionTexts = quickActionTextsOf(translateZh)

/** 模型 / 思考等级行的简体中文默认文案。 */
export const ZH_MODEL_TEXTS: ModelTexts = modelTextsOf(translateZh)

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的字典命名空间。 */
    'dsh-model-quick-switch': ModelKey
  }
}
