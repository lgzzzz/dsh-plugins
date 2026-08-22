# dsh-change-summary

Local persistent DSH plugin (host + browser halves), rewritten from plain JS in
TypeScript. After each agent turn ends (completed or user-stopped), it lists the
files modified this turn under the last message — split into current-workspace
and outside-workspace groups, styled like the stock `ui-deliverables` row — and
restores clickable inline-code file mentions in closing prose.

Clicking a listed file is git-aware:

- **git workspace** — the host stages the worktree (`git add .`) the moment a
  direct human prompt is admitted, so the index is the round baseline. Clicking
  a changed file then opens a Monaco diff of **staged (index) vs working tree**:
  exactly what the agent changed in that round.
- **non-git workspace** — no diff; clicking just opens the file normally (the
  Monaco「文件」tab).

The listed rows are also filtered by current on-disk existence: a file that was
created and then deleted during a turn (e.g. a scratch file) no longer appears
in the workspace-changes list.

## Layout

```
src/
├── index.ts                  # host half: stage on user/message (session/event),
│                             #   serve /dsh-change-summary/diff (index-vs-worktree)
│                             #   and /dsh-change-summary/exists (row filtering)
├── git.ts                    # host half: git helpers (isInsideWorkTree / stageAll /
│                             #   workTreeRoot / readIndex / diffStagedVsWorktree,
│                             #   pathExists)
└── client/
    ├── index.ts              # client plugin body (inject / apply)
    ├── change-summary.ts     # turn-scoped Conversation Definition + pure helpers
    ├── ChangeSummary.tsx     # ChangeRow / ChangeSummary components, diff-then-open,
    │                         #   exists-filtered rows, file-link interception,
    │                         #   inline CSS injection
    └── locales.ts            # change-summary namespace dictionaries (zh/en)

tsconfig.json            # host program (compiles src/, excluding src/client)
tsconfig.client.json     # client program (src/client, jsx: react-jsx, DOM lib)
tsdown.config.ts         # bundles lib/client/* → lib/client.js (ModuleLoader closure)
scripts/verify.mjs       # offline smoke test (host route + client bundle logic)
cordis.patch.yml         # host patch row (inject: [webServer, sessions])
```

## Build

```sh
npm install        # devDependencies; requires a workspace-local npm cache if the
                   # default cache is blocked (npm_config_cache=<writable dir>)
npm run build      # tsc host → tsc client → tsdown → lib/index.js + lib/client.js
npm run typecheck  # both tsc programs, --noEmit
npm run verify     # offline smoke test of both halves
```

## Type resolution

DSH's `@deepseek-ai/*` packages are pre-release and not installed from the
registry here; the plugin's `node_modules/@deepseek-ai` is a **junction** to the
installed `@deepseek-ai/dsh` package's bundled scope
(`<npm root>/@deepseek-ai/dsh/node_modules/@deepseek-ai`), which ships the
`lib/types` declarations. If you reinstall/move the global dsh package, recreate
that junction (`New-Item -ItemType Junction ...`). Two DSH type packages
(`dsh-client-ui-slots`, `dsh-client-ui-primitives`) are absent from the shipped
bundle, so `skipLibCheck` is on and those surfaces type as `any` — the client
source types its own structural slices (`TextEditorCapability`, session snapshot
faces, the `t` seat) instead.

## Runtime dependencies (kept external in the client bundle)

- `react` / `react/jsx-runtime` — shell-seeded
- `@deepseek-ai/dsh-client-runtime/client` — module-table row

Everything else (the plugin's own modules) is inlined by tsdown.
