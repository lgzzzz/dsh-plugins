/**
 * 本插件的 Web 字典：浮层标题/底栏、候选角标与相对时间、固定行名称。
 *
 * 两张浮层共用同一份组件与同一套状态，所以视图文案在这里按浮层分组；组件只接收翻译函数，
 * 不写死任何可见文字。
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'dsh-workspace-quick-switch'

/** 本插件命名空间的类型形态（供注册项 `locale:` 与 `t` 座位使用）。 */
export type PaletteLocaleNS = typeof NS

/** 简体中文字典，同时是键的源集合。 */
export const zh = {
  workspaceTitle: '新建会话于工作区',
  workspaceUnit: '个工作区',
  workspaceEmptyCount: '左侧栏还没有工作区',
  workspaceEmptyHint: '先在左侧栏添加一个工作区。',
  workspaceListLabel: '工作区',
  workspaceEnterHint: 'Enter 新建会话',
  sessionTitle: '切换会话',
  sessionUnit: '个会话',
  sessionEmptyCount: '左侧栏还没有会话',
  sessionEmptyHint: '先在左侧栏新建一个会话。',
  sessionListLabel: '会话',
  sessionEnterHint: 'Enter 打开会话',
  footerMove: '↑ ↓ 选择',
  footerPage: '← → 翻一屏',
  footerEnter: 'Enter',
  footerEsc: 'Esc 关闭',
  currentBadge: '当前',
  countRange: '{total} {unit} · 显示 {from}–{to}',
  blankTitle: '新会话',
  untitledTitle: '未命名',
  pinnedBadge: '置顶',
  runningBadge: '进行中',
  justNow: '刚刚',
  minutesAgo: '{count}分钟前',
  hoursAgo: '{count}小时前',
  daysAgo: '{count}天前',
  monthsAgo: '{count}个月前',
  yearsAgo: '{count}年前',
  workspaceFixedLabel: '工作区快速切换',
  sessionFixedLabel: '会话快速切换',
}

/** 本插件的 locale 键联合。 */
export type PaletteKey = keyof typeof zh

/** 英文字典，按中文键集合校验。 */
export const en = {
  workspaceTitle: 'New session in workspace',
  workspaceUnit: 'workspaces',
  workspaceEmptyCount: 'No workspaces in the sidebar',
  workspaceEmptyHint: 'Add a workspace in the sidebar first.',
  workspaceListLabel: 'Workspace',
  workspaceEnterHint: 'Enter creates a session',
  sessionTitle: 'Switch session',
  sessionUnit: 'sessions',
  sessionEmptyCount: 'No sessions in the sidebar',
  sessionEmptyHint: 'Create a session in the sidebar first.',
  sessionListLabel: 'Sessions',
  sessionEnterHint: 'Enter opens the session',
  footerMove: '↑ ↓ select',
  footerPage: '← → page',
  footerEnter: 'Enter',
  footerEsc: 'Esc close',
  currentBadge: 'Current',
  countRange: '{total} {unit} · showing {from}–{to}',
  blankTitle: 'New session',
  untitledTitle: 'Untitled',
  pinnedBadge: 'Pinned',
  runningBadge: 'Running',
  justNow: 'just now',
  minutesAgo: '{count}m ago',
  hoursAgo: '{count}h ago',
  daysAgo: '{count}d ago',
  monthsAgo: '{count}mo ago',
  yearsAgo: '{count}y ago',
  workspaceFixedLabel: 'Workspace quick switch',
  sessionFixedLabel: 'Session quick switch',
} satisfies Record<PaletteKey, string>

/** locale 服务缺席时的翻译座位：按简体中文字典与 `{name}` 占位符取值。 */
export const translateZh: TranslateNS<PaletteLocaleNS> = ((key: string, params?: Record<string, unknown>) => {
  const template = zh[key as keyof typeof zh] as string
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => name in params ? String(params[name]) : whole)
}) as TranslateNS<PaletteLocaleNS>

/** 会话候选的可见文案；与工作区候选共用同一份 locale 字典。 */
export interface SessionPaletteTexts {
  /** 空白会话的标题。 */
  readonly blankTitle: string
  /** 没有标题的会话。 */
  readonly untitledTitle: string
  /** 置顶角标。 */
  readonly pinnedBadge: string
  /** 进行中角标。 */
  readonly runningBadge: string
  /** 会话行的相对时间（「刚刚」「3分钟前」…）。 */
  relative(updatedAt: number, now: number): string
}

/**
 * 把翻译函数收成会话候选要的文案面。
 *
 * @param t - 本插件命名空间的翻译函数。
 * @returns 标题、角标与相对时间。
 */
export function sessionTextsOf(t: TranslateNS<PaletteLocaleNS>): SessionPaletteTexts {
  return {
    blankTitle: t('blankTitle'),
    untitledTitle: t('untitledTitle'),
    pinnedBadge: t('pinnedBadge'),
    runningBadge: t('runningBadge'),
    relative(updatedAt, now) {
      if (!Number.isFinite(updatedAt) || !Number.isFinite(now)) return ''
      const distance = now - updatedAt
      if (distance < 60_000) return t('justNow')
      const minutes = Math.floor(distance / 60_000)
      if (minutes < 60) return t('minutesAgo', { count: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('hoursAgo', { count: hours })
      const days = Math.floor(hours / 24)
      if (days < 30) return t('daysAgo', { count: days })
      const months = Math.floor(days / 30)
      if (months < 12) return t('monthsAgo', { count: months })
      return t('yearsAgo', { count: Math.floor(months / 12) })
    },
  }
}

/** 简体中文的默认文案：测试与原样兜底使用。 */
export const ZH_SESSION_TEXTS: SessionPaletteTexts = sessionTextsOf(translateZh)

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的字典命名空间。 */
    'dsh-workspace-quick-switch': PaletteKey
  }
}
