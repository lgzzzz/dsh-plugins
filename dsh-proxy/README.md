# dsh-proxy

Split routing for DSH. Rules are structured data (`{ default, rules[] }`), not a
text DSL: the agent writes them through `proxy_routing_write`, verifies them
with `proxy_routing_check` and `proxy_route_explain`, and an upstream
Xray-core binary executes them.

## What it does

- Starts the kernel as soon as the plugin loads once a node is selected
  (`autoStart`, default `true`) and stops it on unload. A missing binary, no
  selected node, occupied ports, or a rejected config never blocks loading;
  rule editing and simulation keep working.
- Stores rules, nodes, and the selected exit in the storage domain `dsh_proxy`
  (rules and selection in the domain's global record; nodes and subscriptions
  in tables), so nothing is written into the workspace.
- Compiles rules into Xray `routing.rules[]` and validates the whole config
  with `xray -test` before restarting the core. A rejected config rolls the
  rules and the running core back to the previous good version.
- Passes `geoDir` to the kernel as `XRAY_LOCATION_ASSET` when it contains
  `.dat` files, so `geosite:` / `geoip:` / `ext:` data placed there is what the
  kernel actually loads.
- Simulates one flow against the current rules, reporting the matching rule and
  why the earlier ones were skipped.
- Appends one line per connection to `<dataDir>/access.log` — destination host
  or IP plus the exit the kernel actually used — and exposes it in the panel's
  Connections tab and through `proxy_traffic_read`. The log is local and can be
  turned off with `accessLog: false`.
- Never downloads a binary, never binds anything but `127.0.0.1`, never changes
  the system proxy, and never routes DSH's own model API traffic.

## Requirements

An `xray` binary. Either install one (`brew install xray`) or set
`coreBinary` in the plugin config to an absolute path. Rule editing, checking,
and simulation work without it; starting the core reports the missing binary.
If you rely on `geosite:` / `geoip:` values, point `geoDir` at the directory
that holds `geosite.dat` / `geoip.dat` (empty means `<DSH_HOME>/proxy/geo`);
a kernel installed with its own asset directory keeps using it when `geoDir`
has no `.dat` files.

## Startup

Loading the plugin resolves the binary and — when `autoStart` is on (the
default) and a node is selected — starts the kernel with the saved rules.
Unloading stops it. Set `autoStart: false` to keep the kernel stopped until the
panel's start button or `POST /proxy-api/core` starts it. Without a selected
node auto-start does nothing. A missing binary or a failed start — including
SOCKS / HTTP ports already in use — is written to the log, and the panel's
start button remains the retry path. Rules and simulation do not depend on the
kernel either way.

## Tools

Five read-only tools are always available; the four that change or prove rules
appear only after the `proxy-routing` skill loads. Those four carry the bulk of
the rule JSON schema — roughly 2.4k tokens between `check` and `write` alone —
and their results (the difference between `uncertain`, `opaque`, and `missing`,
what `patch` means, when a write rolls back) only make sense once the skill's
instructions are in context.

| Tool | Available | Effect |
|---|---|---|
| `proxy_status` | always | Core state, ports, rule count, last error |
| `proxy_nodes_list` | always | Configured exits (redacted) and subscriptions |
| `proxy_latency_test` | always | TCP handshake latency to one node or all exits |
| `proxy_routing_read` | always | Current rule set, compiled preview, available exits |
| `proxy_traffic_read` | always | Recent connections: which exit each host or IP actually used |
| `proxy_routing_check` | after `proxy-routing` | Validate a candidate rule set without saving |
| `proxy_route_explain` | after `proxy-routing` | Simulate one flow against the saved rules |
| `proxy_routing_write` | after `proxy-routing` | Save a rule change; applies it with rollback |
| `proxy_subscription_add` | after `proxy-routing` | Import a subscription URI list, once or updated |

`proxy_route_explain` predicts; `proxy_traffic_read` reports what the kernel
did. The access log only covers connections through the plugin's SOCKS/HTTP
ports, reveals no HTTPS path, and records only an IP when the client resolves
DNS itself — sniffing may still have routed on the SNI, but the log cannot show
that domain.

Activation comes from either entry point: a model `skill` call, or the user's
own `/proxy-routing` message. A native-mode session keeps the declarations in
its request header, so resume and fork stay unlocked; a PTC session records
only `run_code`, and the skill says to load it again when the tools are
missing. Set `toolExposure: 'always'` in the plugin config to expose all nine
tools unconditionally.

## Panel

Sidebar entry「分流路由」 opens on the Connections tab, which is first in the
tab bar; the other tabs hold the rules list, the node inventory, and the log
tail, newest line first. In the rules tab the default-exit dropdown sits on the
left of a row above the list, with check / apply / reset pushed to the right.
Every rule row has the same order: enable, up / down, remove, policy badge
(代理 / 直连 / 拦截), rule name with its match, then the node name — the node
always follows the rule name, whether the rule pins a node in `out` or goes
through the `proxy` alias. The default-exit dropdown lists concrete nodes plus
`direct` / `block`, not the `proxy` alias. Rule names follow
`<subject> → <policy>` (e.g. `GitHub → 代理`, `国内域名 → 直连`); the policy word
is never a node name or a latency, so renaming or switching a node leaves the
rule label untouched.

The Connections tab reads `GET /proxy-api/traffic` and lists one row per
access-log line: time, inbound, destination and verdict (proxied / direct /
blocked). Proxied rows also show the node that was used; direct and blocked
rows show no exit. Filtering runs on the host, so the summary
covers the whole in-memory window rather than the visible page. Records survive
a kernel restart for the life of the plugin; the file itself is capped at 8MiB
and truncated before the kernel starts only when it exceeds that.

The panel is React 18 rendered inside the host slots: `src/client.tsx` registers
the sidebar entry and the `main` panel, `src/ui/` holds the components, styles
(CSS Modules), fetch layer and dictionaries, and `src/ui/use-proxy-panel.ts` /
`src/ui/use-traffic.ts` own polling and writes. Text goes through `ctx.locale`; controls are written
against the `--dsw-alias-*` tokens rather than importing host primitives, except
buttons, which are uniformly black with white text.

## Exit names and tags

Each node carries two strings. The **tag** is the exit name: an ASCII slug
derived from the node name, unique across the inventory, and the value rules
store in `out` (and the value compiled into the Xray outbound tag). The **name**
is what the subscription called the node, in whatever script and emoji it used.
Nodes are matched by `protocol + server + port + credential`, so re-importing a
subscription keeps both.

Everything that a person reads shows a friendly label: the rule row's exit
column shows the policy (代理 / 直连 / 拦截) and the node name comes after the
rule name, exit dropdowns list node names, and the node list shows names.
Diagnostics and logs name the offending exit the same way. The tag stays the
stable identifier because the tag is what `geosite:`-class values cannot be,
what survives a name edit, and what the kernel config refers to; renaming the
node changes the label, not the rule.
