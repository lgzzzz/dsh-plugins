/**
 * Node half of the local `dsh-code-card-fonts` patch row.
 *
 * The browser half (lib/client.js) carries the actual CSS override; this
 * half only exists so the composition row resolves as a valid host plugin
 * entry that `dsh-client-modules` can scan (it looks at Loader entries
 * whose package.json declares `dsh.client.platform: "web"`).
 */
export const name = 'dsh-code-card-fonts'
export function apply() {}