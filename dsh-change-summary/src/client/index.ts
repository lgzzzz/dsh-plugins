/**
 * Client plugin body for `dsh-change-summary`.
 *
 * Registers the turn-scoped change-summary accumulator (via `uiConversation.events`),
 * the two-group row under the closing message (via the `conversation.chat.turnTail`
 * chain slot), the clickable inline-code file mentions in closing prose (via
 * the `chatFileMentions` provide), and the Monaco file-link interception.
 *
 * The `dsh-client-ui-slots` / `dsh-client-ui-primitives` type packages are absent
 * from the shipped bundle, so the consumed service faces (`slots`, `locale`,
 * `uiConversation`) are declared structurally here, exactly as the `dsh-text-editor`
 * consumer face is.
 */
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { NS, zh, en } from './locales.js'
import { changeSummaryDefinition, producedFileMentions, selectChangeFiles } from './change-summary.js'
import { ChangeSummary, fetchExists, installFileLinkInterception, openDiff, openGroupDiffs } from './ChangeSummary.js'

export const name = 'dsh-change-summary'

/** Required services for the tail-slot registration and its dictionaries. */
export const inject = ['slots', 'locale', 'uiConversation', 'dsh-text-editor', 'sessions']

/** Structural slice of the `locale` service this plugin reads. */
interface LocaleFace {
  register(ns: string, dicts: Record<string, unknown>): () => void
  bind(ns: string): (key: string, params?: Record<string, string>) => string
}

/** Structural slice of the `slots` service this plugin reads. */
interface SlotsFace {
  inject(slot: string, register: () => unknown): void
  register(spec: Record<string, unknown>, component: unknown): unknown
}

/** Structural slice of the `uiConversation` service this plugin reads. */
interface UiConversationFace {
  events: { register(definition: unknown): () => void }
}

/** Client root context face consumed by this plugin body. */
interface ClientContext {
  get(name: string): unknown
  effect(callback: () => void | (() => void), label?: string): void
  provide(name: string, value: unknown): () => void
  slots: SlotsFace
  locale: LocaleFace
  uiConversation: UiConversationFace
}

export function apply(ctx: ClientContext): void {
  ctx.uiConversation.events.register(changeSummaryDefinition)
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
          openDiff: (sessionId: string | undefined, path: string, openFile: (path: string) => void, deleted?: boolean) =>
            openDiff(ctx, sessionId, path, openFile, deleted),
          openGroupDiff: (
            sessionId: string | undefined,
            paths: readonly string[],
            clickedPath: string,
            openFile: (path: string) => void,
            deleted: ReadonlySet<string>,
          ) => openGroupDiffs(ctx, sessionId, paths, clickedPath, openFile, deleted),
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