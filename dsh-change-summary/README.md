# dsh-change-summary

Local persistent DSH plugin (host + browser halves), rewritten from plain JS in
TypeScript. After each agent turn ends (completed or user-stopped), it lists the
files modified this turn under the last message — split into current-workspace
and outside-workspace groups, styled like the stock `ui-deliverables` row — and
restores clickable inline-code file mentions in closing prose.

Clicking a listed file is git-aware, decided by the **file's own directory**
(not the session workspace):

- **workspace-group file (工作区修改) whose own directory is inside a git work
  tree** — clicking it fetches the **staged (index) vs working tree** diff for
  EVERY file of that group at once (concurrent per-file route requests) and
  shows them all in one 差异 tab via the dsh-text-editor `showDiff` capability,
  positioned at the clicked file (`initialIndex`). Files without a diff
  (non-git, unchanged, binary, oversized, failed fetch) are skipped. The
  plugin never stages the worktree itself: the baseline is whatever the index
  currently holds (last committed or manually staged state), and each diff
  shows the change between that index state and the current file.
- **workspace-group file without a diff of its own** — no 差异 tab opens, no
  matter whether other group files have diffs; clicking just opens the clicked
  file normally (the Monaco「文件」tab). A deleted file that cannot diff has
  nothing to open, so that click is a no-op.
- **outside-workspace file** — single-file behavior: inside a git work tree it
  opens just that file's staged-vs-worktree Monaco diff; otherwise it opens the
  file normally.

Every produced path is listed under the closing message — existing or deleted,
git workspace or not. A file that no longer exists on disk (deleted during the
turn) carries a **「已删除 / deleted」 marker** on its row. Clicking a deleted
row is then git-aware (again by the file's own directory):

- **file's directory inside a git work tree** — the index still holds the
  file's content, so the group diff includes it as all-content-deleted (before
  = index blob, after = empty); clicking the deleted row itself also opens the
  group diff.
- **file's directory not a git work tree** — nothing to diff against and no
  worktree file to open; the click is a no-op.

(One case still never appears in the list: a path the turn's tools never
reported a location for — e.g. a file removed purely with a `bash rm` that was
never written or edited this turn — since the accumulator is driven by tool
follow-along `locations`, not by filesystem state.)

## Layout

```
src/
├── index.ts                  # host half: serve /dsh-change-summary/diff
│                             #   (index-vs-worktree, git-ness decided by the
│                             #   file's own directory) and
│                             #   /dsh-change-summary/exists (on-disk existence
│                             #   for deleted marking); no auto-staging on user
│                             #   messages
├── git.ts                    # host half: git helpers (isInsideWorkTree /
│                             #   workTreeRoot / readIndex /
│                             #   diffStagedVsWorktree, pathExists)
└── client/
    ├── index.ts              # client plugin body (inject / apply)
    ├── change-summary.ts     # turn-scoped Conversation Definition + pure helpers
    ├── ChangeSummary.tsx     # ChangeRow / ChangeSummary components, diff-then-open,
    │                         #   workspace-group multi-diff (showDiff all at once),
    │                         #   deleted-marked rows, file-link interception,
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

## Loading

This plugin is mounted via the Web Profile `link:` dependency (see the
workspace `AGENTS.md` 「挂载与激活」). Its `lib/` is not committed, so build
first, then add:

```sh
npm install && npm run build     # produces lib/index.js + lib/client.js
dsh plugin --profile web add link:<repo-root>/dsh-change-summary
# restart App to take effect
```

`dsh plugin` is a pnpm forwarder: it runs `pnpm add` and then auto-checks
`dsh.profile.bundles` — deps declaring `dsh.bundle` are merged into the bundle
list, no manual `~/.dsh/profiles/web/package.json` edit needed.

Uninstall:

```sh
dsh plugin --profile web remove dsh-change-summary
```

> Loading is a user operation: after delivering a plugin, the agent must not run
> `dsh plugin add`, `pnpm install`, or restart the App itself (强制规范第 1 条).

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
