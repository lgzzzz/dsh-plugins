/**
 * Host half of `dsh-new-session`: register the bare `/new` command and settle its lifecycle; create-and-navigate happens in the browser half via `uiWorkspace.startSession()`.
 */
export const name = 'dsh-new-session'
export const inject = ['commands']

export function apply(ctx) {
  ctx.effect(() => ctx.commands.register({
    name: 'new',
    description: '新建会话并跳转',
    handler: () => ({ kind: 'success' }),
  }))
}
