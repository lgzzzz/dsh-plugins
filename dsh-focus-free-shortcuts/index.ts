/**
 * Host half: the plugin has no Host-side behaviour at all.
 *
 * The whole feature lives in the browser (see `src/client.ts`); this entry
 * exists so the bundle patch can mount one row that the client roster then
 * resolves through `dsh.client.platform = "web"`.
 */
export const name = 'dsh-focus-free-shortcuts'
export function apply(): void {}
