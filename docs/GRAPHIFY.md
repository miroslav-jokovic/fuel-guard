# graphify — rules and the measurements behind them (moved from the root CLAUDE.md)

A knowledge graph of this repo lives at `graphify-out/` (gitignored; a fresh clone runs
`pnpm graph:update` once, ~30s). A `PreToolUse` hook reminds of it on `Grep` only.

- **Use it by exact symbol name.** `graphify explain "<symbol>"` for what defines, imports and calls
  one symbol; `graphify affected "<symbol>"` for the blast radius of a change (it follows
  re-exports grep misses); `graphify path "<A>" "<B>"` for how two symbols connect. These are
  accurate and cost ~150–300 tokens.
- **Do not use `graphify query "<question>"` to find code.** It matches question WORDS, not
  meaning: measured 2026-10-21, "where is the IFTA sync scheduler" returned eight unrelated test
  helpers (it matched "call" and "sync") and "which code computes fleet MPG" returned the hazmat
  placard engine, each at up to ~2,000 tokens, while one grep found `samsaraScheduler.ts`. To
  DISCOVER code, grep; once you have a name, switch to `explain`/`affected`. That measurement is
  also why the hook no longer fires on Bash, Read or Glob — it added ~50 tokens to every call and
  steered toward `query`. Read `GRAPH_REPORT.md` only for broad architecture review.
- ⚠ **It is a map, not the territory.** Verify anything load-bearing at the call site, and be most
  careful with a NEGATIVE — "there is no such function" is the answer a stale or partial graph
  gives confidently and wrongly.
- ⚠ **`built_at_commit` is NOT a staleness check.** It is the HEAD of the last build that CHANGED
  TOPOLOGY, so it trails HEAD after every docs-only or body-only commit while the graph is current.
  When in doubt run `pnpm graph:update`: idempotent, ~30s, a no-op when nothing changed.
- **Rebuild with `pnpm graph:update`, never a bare `graphify update .`** — a graphify without the
  optional `tree_sitter_sql` grammar silently drops every migration; the wrapper refuses to let
  that pass (`scripts/graphify-update.sh`). `post-commit`/`post-merge` git hooks already run it.
