/**
 * 本插件的 Web 字典：设置行提示与系统通知标题/正文。
 *
 * 可见文案一律走 Client locale 服务（宿主与其它插件保持同一套语言），组件与判定器只接收
 * 翻译后的字符串。
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotifyReason, NotifyTexts } from './notify-policy.ts'

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'dsh-desktop-notify'

/** 本插件命名空间的类型形态（供注册项 `locale:` 与 `t` 座位使用）。 */
export type NotifyLocaleNS = typeof NS

/** 简体中文字典，同时是键的源集合。 */
export const zh = {
  title: '桌面通知',
  hintUnsupported: '本浏览器不支持桌面通知',
  hintDenied: '桌面通知已被浏览器拒绝:请在 Chrome「设置 → 隐私与安全 → 网站设置 → 通知」里允许 {origin},再回到本页',
  hintPrompt: '开启桌面通知:回合结束或需要你处理时弹系统通知',
  hintOn: '桌面通知已开启,点击关闭',
  hintOff: '桌面通知已关闭,点击开启',
  descUnsupported: '本浏览器不支持桌面通知',
  descDenied: '已被浏览器拒绝:请在上方站点设置里允许通知,再回到本页重新打开',
  descPrompt: '开启后需要先授权(浏览器会弹出授权框)',
  descOn: '已开启:页面不在前台时,回合结束或需要你处理会弹系统通知',
  descOff: '已关闭:不再发送系统通知',
  turnCompleteTitle: 'DSH · 回合完成',
  approvalTitle: 'DSH · 需要你审批',
  questionTitle: 'DSH · 需要你回答',
  planReviewTitle: 'DSH · 计划待确认',
  approvalFallback: '有一条工具调用等你决定',
  planReviewFallback: '计划已就绪,等你确认',
  questionFallback: '有一个提问等你回答',
}

/** 本插件的 locale 键联合。 */
export type NotifyKey = keyof typeof zh

/** 英文字典，按中文键集合校验。 */
export const en = {
  title: 'Desktop notifications',
  hintUnsupported: 'This browser does not support desktop notifications',
  hintDenied: 'Desktop notifications are blocked. Allow {origin} in Chrome settings (Privacy and security → Site settings → Notifications), then return to this page',
  hintPrompt: 'Turn on desktop notifications for completed turns and requests that need you',
  hintOn: 'Desktop notifications are on. Click to turn off',
  hintOff: 'Desktop notifications are off. Click to turn on',
  descUnsupported: 'This browser does not support desktop notifications',
  descDenied: 'Blocked by the browser. Allow notifications in the site settings above, then reopen this page',
  descPrompt: 'Turning this on asks for permission first (the browser shows a prompt)',
  descOn: 'On: when the page is in the background, completed turns and requests that need you trigger a system notification',
  descOff: 'Off: no system notifications are sent',
  turnCompleteTitle: 'DSH · Turn complete',
  approvalTitle: 'DSH · Approval needed',
  questionTitle: 'DSH · Answer needed',
  planReviewTitle: 'DSH · Plan ready',
  approvalFallback: 'A tool call is waiting for your decision',
  planReviewFallback: 'The plan is ready for review',
  questionFallback: 'A question is waiting for your answer',
} satisfies Record<NotifyKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的字典命名空间。 */
    'dsh-desktop-notify': NotifyKey
  }
}

/** locale 服务缺席时的翻译座位：按简体中文字典与 `{name}` 占位符取值。 */
export const translateZh: TranslateNS<NotifyLocaleNS> = ((key: string, params?: Record<string, unknown>) => {
  const template = zh[key as keyof typeof zh] as string
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => name in params ? String(params[name]) : whole)
}) as TranslateNS<NotifyLocaleNS>

/**
 * 把翻译函数收成判定器要的文案面。
 * @param t - 本插件命名空间的翻译函数。
 * @returns 标题与三种兜底正文。
 */
export function notifyTextsOf(t: TranslateNS<NotifyLocaleNS>): NotifyTexts {
  return {
    title: (reason: NotifyReason) => reason === 'turn-complete'
      ? t('turnCompleteTitle')
      : reason === 'approval'
        ? t('approvalTitle')
        : reason === 'question'
          ? t('questionTitle')
          : t('planReviewTitle'),
    approvalDetail: () => t('approvalFallback'),
    questionDetail: () => t('questionFallback'),
    planReviewDetail: () => t('planReviewFallback'),
  }
}

/** 简体中文默认文案：纯逻辑测试与 locale 缺席时使用。 */
export const ZH_TEXTS: NotifyTexts = notifyTextsOf(translateZh)
