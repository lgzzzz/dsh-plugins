# dsh-proxy

Split routing for DSH. Rules are structured data (`{ default, rules[] }`), not a
text DSL: the agent writes them through `proxy_routing_write`, verifies them
with `proxy_routing_check` and `proxy_route_explain`, and an upstream
Xray-core binary executes them.

## What it does

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

## Tools

Four read-only tools are always available; the four that change or prove rules
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
| `proxy_routing_check` | after `proxy-routing` | Validate a candidate rule set without saving |
| `proxy_route_explain` | after `proxy-routing` | Simulate one flow against the saved rules |
| `proxy_routing_write` | after `proxy-routing` | Save a rule change; applies it with rollback |
| `proxy_subscription_add` | after `proxy-routing` | Import a subscription URI list, once or updated |

Activation comes from either entry point: a model `skill` call, or the user's
own `/proxy-routing` message. A native-mode session keeps the declarations in
its request header, so resume and fork stay unlocked; a PTC session records
only `run_code`, and the skill says to load it again when the tools are
missing. Set `toolExposure: 'always'` in the plugin config to expose all eight
tools unconditionally.

## Panel

Sidebar entry「分流路由」 → rules list with enable toggles and reordering,
node inventory, traffic simulator, and a log tail.
