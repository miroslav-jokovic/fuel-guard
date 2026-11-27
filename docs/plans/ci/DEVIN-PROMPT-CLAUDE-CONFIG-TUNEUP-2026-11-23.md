# Task: shrink the Claude Code project instructions in the fuel-guard repo (one PR, docs/config only)

Repository: `github.com/miroslav-jokovic/fuel-guard`. Base branch: `main`. This prompt was written
against `main` at commit `450d2dcdb`. All line numbers below refer to `CLAUDE.md` **at that
commit**. Before you start, run `git show 450d2dcdb:CLAUDE.md | sed -n '68p;91p;190p'` and confirm
the three lines begin with `- CI is **eight parallel jobs**`, `- **Browser tests run in`, and
`A knowledge graph of this repo lives at`. If `main` has moved and `origin/main:CLAUDE.md` no longer
has these lines at these numbers, locate the same text by its exact wording and use that. If the
text itself has changed, STOP and report what differs. Do not guess.

## Goal

The root `CLAUDE.md` (212 lines, 17 KB) loads into every Claude Code session. Move the sections
that matter only for specific files into path-scoped rule files that load on demand, fix one
misplaced block, add compaction instructions, and block Claude from reading four very large
generated files. **No application code changes.** Moved text must stay word-for-word the same. Do
not reword, reflow, re-wrap, or "improve" any sentence you move.

## Branch, commit, PR

- Branch: `claude/claude-config-tuneup`, cut from `origin/main`.
- One commit. Message (one sentence, no prefix tag):
  `Claude's project instructions load less per session: CI and browser-test rules move to path-scoped files under .claude/rules, the graphify section shrinks to its rules with the measurements kept in docs/GRAPHIFY.md, and the largest generated files are blocked from Read.`
- PR title: `Claude's working instructions are trimmed so each session starts lighter (no change to the app)`
- PR body: use exactly the four headings of `.github/pull_request_template.md`. Content:
  - What changes for a user: nothing. Only Claude Code's instruction files and project settings change.
  - Migration and risk: no migration. Risk: a moved rule loads only when Claude touches a matching
    file. The pointer bullet left in `CLAUDE.md` covers the other cases.
  - How to check it on staging: not applicable (no deployed code changes).
  - Tests: the output of `pnpm ci:local --job gates`, plus the three `diff` checks in §8, all empty.

## 1. `CLAUDE.md`: move the misplaced Package-map bullets (lines 41–45)

Lines 41–45 (the three bullets beginning `- \`packages/shared\``, `- \`packages/ui\``, and
`- \`supabase/\``, including their indented continuation lines) currently sit under
`## Hosting: AWS only — Railway is retired`. That is wrong: they belong to `## Package map`.

- Cut lines 41–45 exactly.
- Paste them directly after line 23 (the bullet `- \`apps/admin\` + \`apps/admin-api\` — internal platform console (the \`console\` Compose service).`), before the blank line that precedes `## Hosting`.
- The Hosting section must then end with the paragraph ending
  `` `infra/image/Dockerfile` and `infra/server/` set. ``, followed by one blank line, then `## Commands`.

## 2. `CLAUDE.md`: move the CI bullets (lines 68–90) to `.claude/rules/ci-and-release.md`

Lines 68–90 are three bullets: `- CI is **eight parallel jobs**…`, `` - `native-android` compiles… ``,
and `- **A merge does not wait for main's CI…**`. Cut them **exactly**, with all continuation lines.

Create `.claude/rules/ci-and-release.md` with exactly this header, then one blank line, then the
23 cut lines unchanged:

```markdown
---
paths:
  - ".github/**"
  - "scripts/ci-local.mjs"
  - "scripts/check-ci-verdict.sh"
  - "scripts/release-train.mjs"
  - "railway.json"
  - "**/*.kt"
  - "**/*.swift"
---

# CI jobs and the merge rule (moved from the root CLAUDE.md)
```

## 3. `CLAUDE.md`: move the browser-test bullet (lines 91–96) to `.claude/rules/browser-tests.md`

Line 91 begins `- **Browser tests run in \`bundle\`**`. The bullet ends at line 96 (`…then run \`e2e:apply\`.`).
Cut lines 91–96 exactly. Create `.claude/rules/browser-tests.md` with exactly this header, then one
blank line, then the 6 cut lines unchanged:

```markdown
---
paths:
  - "apps/web/e2e-apply/**"
  - "apps/web/e2e/**"
  - "apps/web/tutorials/**"
  - "apps/web/playwright*.ts"
  - ".github/workflows/smoke.yml"
---

# Browser tests (moved from the root CLAUDE.md)
```

## 4. `CLAUDE.md`: put one pointer bullet where lines 68–96 were

Where lines 68–96 were (directly after the bullet that ends
`` …saying so in its `"//lint:*"` comment. ``, and before the blank line that precedes
`## Hard rules`), insert exactly these three lines:

```markdown
- CI's job layout, the `native-android` job, the tested-tree merge rule and the browser tests live in
  `.claude/rules/ci-and-release.md` and `.claude/rules/browser-tests.md`. They load by themselves when
  you touch a matching file; read them first for any CI failure, workflow change or Playwright work.
```

## 5. `CLAUDE.md`: shrink the graphify section; keep the full text in `docs/GRAPHIFY.md`

a. Create `docs/GRAPHIFY.md` containing exactly this line, one blank line, then lines 190–212 of
   `CLAUDE.md` unchanged (from `A knowledge graph of this repo lives at` through
   `` …`post-commit`/`post-merge` git hooks already run it. ``):

```markdown
# graphify — rules and the measurements behind them (moved from the root CLAUDE.md)
```

b. In `CLAUDE.md`, replace lines 190–212 (keep the `## graphify` heading on line 188 and the blank
   line after it) with exactly:

```markdown
A knowledge graph of this repo lives at `graphify-out/` (gitignored; a fresh clone runs
`pnpm graph:update` once, ~30s). Full rules and the measurements behind them: `docs/GRAPHIFY.md`.

- Use it by exact symbol name: `graphify explain "<symbol>"`, `graphify affected "<symbol>"`,
  `graphify path "<A>" "<B>"` (~150–300 tokens each). To DISCOVER code, grep — `graphify query`
  matches question words, not meaning, and returns unrelated results.
- Never Read files under `graphify-out/` (`GRAPH_REPORT.md` is ~450 KB, `graph.json` ~49 MB); use
  the CLI above.
- ⚠ It is a map, not the territory: verify anything load-bearing at the call site, above all a
  NEGATIVE. `built_at_commit` is not a staleness check; when in doubt run `pnpm graph:update`.
- Rebuild only with `pnpm graph:update`, never a bare `graphify update .` (it can silently drop
  every migration — `scripts/graphify-update.sh`).
```

## 6. `CLAUDE.md`: append a compaction section at the very end of the file

After the graphify section, add one blank line, then exactly:

```markdown
## Compact instructions

When the conversation is compacted, keep: every decision and open-question ID (D-*, Q-*, F-*) with
its current status; PR numbers, branch names and commit SHAs; migration numbers; the exact text of
any failing test or gate output not yet fixed; the paths of files changed so far; and every ruling
the owner gave in this session. Drop: full file contents already read, passing test output, and
search results.
```

Do not change any other line of `CLAUDE.md`. That includes the HTML comment on lines 6–11, the
`- Check in three tiers.` bullet on lines 49–52 (merged in #2632, the owner's current testing rule),
Hard rules, No workarounds and Conventions.

## 7. `.claude/settings.json`: four Read blocks and two plugins off

Edit only these two keys. Keep every other key and value unchanged, including the five existing `.env`
deny entries, `extraKnownMarketplaces`, `hooks`, and `permissions.allow` and `permissions.ask`.

a. Append these four strings to the end of the existing `permissions.deny` array (after
   `"Read(!*.example.env)"`), in this order:

```json
"Read(**/pnpm-lock.yaml)",
"Read(graphify-out/**)",
"Read(apps/web/dist/**)",
"Read(apps/admin/dist/**)"
```

b. In `enabledPlugins`, change these two values from `true` to `false`. Do not delete the keys, so
   turning them back on stays a one-word change. Leave `frontend-design@claude-plugins-official` and
   `playwright@claude-plugins-official` at `true`:

```json
"ui-ux-pro-max@ui-ux-pro-max-skill": false,
"impeccable@impeccable": false
```

## 8. Checks you must run, and paste into the PR's Tests section

```sh
jq . .claude/settings.json > /dev/null && echo settings-ok
wc -l CLAUDE.md                                  # expect 184–188 lines (was 212)
sed -n '/^- CI is \*\*eight/,$p' .claude/rules/ci-and-release.md \
  | diff - <(git show 450d2dcdb:CLAUDE.md | sed -n '68,90p') && echo ci-identical
sed -n '/^- \*\*Browser tests/,$p' .claude/rules/browser-tests.md \
  | diff - <(git show 450d2dcdb:CLAUDE.md | sed -n '91,96p') && echo browser-identical
sed -n '/^A knowledge graph/,$p' docs/GRAPHIFY.md \
  | diff - <(git show 450d2dcdb:CLAUDE.md | sed -n '190,212p') && echo graphify-identical
grep -c 'packages/shared' CLAUDE.md               # expect 1, and it must sit above "## Hosting"
pnpm install --frozen-lockfile && pnpm --filter @silvicom/shared build:rn
pnpm ci:local --job gates
```

All three `diff`s must print nothing before their `…-identical` line. If `pnpm ci:local --job gates`
fails on any gate, do not change the gate, the gate's script, or `package.json` to get past it, and do
not reword moved text. Report the failing gate's name and its full output in the PR description,
then stop.

## Out of scope: do NOT touch

- Anything outside these five paths: `CLAUDE.md`, `.claude/settings.json`,
  `.claude/rules/ci-and-release.md`, `.claude/rules/browser-tests.md` and `docs/GRAPHIFY.md`.
- `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, `supabase/CLAUDE.md`, `.claude/skills/**`,
  `.claude/launch.json`, and any user-level file (`~/.claude/**`). You do not have access to those,
  and they are not part of this task.
- Do not merge the PR. Open it and leave it for the owner.
