/**
 * Client plugin body for `dsh-change-summary`.
 *
 * Registers the turn-scoped change-summary accumulator (via conversationEvents),
 * the two-group row under the closing message (via the `conversation.chat.turnTail`
 * chain slot), the clickable inline-code file mentions in closing prose (via
 * the `chatFileMentions` provide), and the Monaco file-link interception.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Declaration-merge triggers: load the client `Context.locale` member so
// `ctx.locale.register/bind` are visible. Type-only, erased at compile time.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { NS, zh, en } from './locales.js'
import { changeSummaryDefinition, producedFileMentions, selectChangeFiles } from './change-summary.js'
import { ChangeSummary, fetchExists, installFileLinkInterception, openDiff } from './ChangeSummary.js'

export const name = 'dsh-change-summary'

/** Required services for the tail-slot registration and its dictionaries. */
export const inject = ['slots', 'locale', 'conversationEvents', 'connection', 'dsh-text-editor', 'sessions']

/** Structural face of the `connection` service this plugin reads. */
interface ConnectionFace {
  isLoopback: boolean
  hostDescription: unknown
}

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(changeSummaryDefinition)
  const connection = ctx.get('connection') as ConnectionFace | undefined
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'change-summary: dictionaries')
  // 承接原 dsh-te-file-link-opener 的能力:捕获文件链接点击 → Monaco「文件」标签打开。
  const disposeInterception = installFileLinkInterception(ctx)
  if (disposeInterception !== undefined) {
    ctx.effect(() => disposeInterception, 'change-summary: file-link interception')
  }
  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.turnTail',
        select: selectChangeFiles,
        locale: NS,
        inject: () => ({
          isLoopback: connection?.isLoopback ?? false,
          hooks: { hostDescription: connection?.hostDescription },
          openDiff: (sessionId: string | undefined, path: string, openFile: (path: string) => void, deleted?: boolean) =>
            openDiff(ctx, sessionId, path, openFile, deleted),
          exists: (sessionId: string | undefined, paths: readonly string[]) =>
            fetchExists(ctx, sessionId, paths),
        }),
      },
      ChangeSummary,
    ),
  )
  const t = ctx.locale.bind(NS)
  ctx.provide('chatFileMentions', {
    forClosing: (owner: TurnTailOwnerProps) => {
      const paths = selectChangeFiles(owner)
      if (paths === null) return undefined
      return producedFileMentions(paths, owner.openFile, (path) => t('change.open', { name: path }))
    },
  })
}
