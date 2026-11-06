# Ads agent progress log — one file per entry

The progress log of [`ADS-AGENT-BUILD-WORKFLOW.md`](../ADS-AGENT-BUILD-WORKFLOW.md) continues here
(owner's ruling, 2026-11-06). Entries up to 2026-11-06 stay at the end of that file.

**Why files:** three ads chats (Tracks S, W, G) run in parallel, and each appended its entry to the end of
the same file. Every merge then made the other open ads PRs CONFLICTING, and a rebase restarts a ~25-minute
CI run; #2075 (E1c) needed six. Two new files never conflict.

**How to add an entry** (in the PR that does the work, never a separate PR):

- File name: `YYYY-MM-DD-HHMM-<track>-<step>.md`, Central time, e.g. `2026-11-06-0930-S-E2.md`. `<track>` is
  `S`, `W`, `G` or `owner`; `<step>` is the step id from the workflow's §4 or the orchestrator's prompt. The
  name sorts the folder in order; a PR that sits in CI keeps the name it was written with.
- Content, in the register of the entries in the workflow file: a first line `**<date> · Track <x> · <step>
  (#<PR>)**`, then what was built, what was NOT built and why, the mutants, the open questions it opened or
  closed (Q-AD ids), traps.
- Never edit another entry. A correction is a new entry that names the one it corrects.
