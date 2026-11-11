# Unit notes — notes on drivers, trucks and trailers · 2026-11-11

**Status: PLANNED 2026-11-11. Nothing built.** Owner rulings of 2026-11-11 are recorded in §3.
This document is both the plan (what and why) and the build workflow (which chat builds what, in
which files, in what order, and how each step proves it is done). It is written so that several
chats can build at once under one orchestrator chat (§7).

The owner's ask (2026-11-11): *notes for drivers, trucks, trailers that everyone with access can see
and contribute to; visible and easy to reach as a separate column in the Vehicles, Drivers, Trailers
and Dispatch Board tables; a click opens our existing drawer with all notes for that unit, newest
first, with a smart search; everyone who can see can write; only an admin with a named permission
can remove; mentions in the first release; drivers do not see notes; plan the first release as the
final one; build it in separate chats under one orchestrator.*

**How "assume nothing" is kept.** Every fact below is either **MEASURED** (read on `origin/main`
`1ab5c7a`, 2026-11-11, or counted in the McLeod sandbox restored 2026-10-09) or **UNVERIFIED** with
the step that verifies it before anything depends on it (§1.2).

---

## 1. Ground truth

### 1.1 Measured

| # | Fact | Evidence | What it means for the build |
|---|---|---|---|
| M1 | No notes exist for units. `drivers`, `vehicles`, `trailers` have no notes column and no notes table | `supabase/schema.generated.sql` | New table, exempt from the two-merge rule (`lint:migration-ordering`) |
| M2 | Applicant notes exist: `applicant_notes` (0535), append-only guard, one pin, author name stored, service-role only | `0535_applicant_notes.sql`, `modules/recruiting/applicantNotes.ts` | The shape to follow. Not the table to reuse: it is keyed to an invitation and purged with the applicant |
| M3 | Last migration on main is **0587**; open PR #1703 holds a stale 0509 | `git ls-tree origin/main supabase/migrations` | The number is checked **by name at merge**, never reserved |
| M4 | `roster` owns `drivers`, `vehicles`, `trailers` (D-ARC3) | `docs/ARCHITECTURE.md` §3 | The notes table is roster's (D-UN2) |
| M5 | Section matrix: driver page asks `roster`, truck and trailer pages ask `equipment`. Recruiter has `equipment: none`; technician has `roster: none`; dispatcher has both at `view`; `driver` role has `none` everywhere | `packages/shared/src/auth.ts:138-183`, `surfaceCatalogue.ts:209-211,285-288` | Read and write derive from this matrix; no new role list |
| M6 | Admin-only named acts live in `ADMIN_ONLY_CAPABILITIES`, each with a label and a reason, shown on the Permissions page and held to routes by `routeGateLedger.test.ts`, which refuses a listed capability that guards no route | `packages/shared/src/namedGrants.ts` | "Remove notes" is one more entry, added in the same PR as its route |
| M7 | The drawer is `apps/web/src/components/SlideOver.vue` (`open`, `title`, `description`, `size md|lg|xl`, default + `footer` slots); the board's truck drawer already uses it | `features/dispatch/DispatchTruckDrawer.vue:107` | No new drawer component |
| M8 | Chat search (0542): `chat_search_vector` (`simple` config, dashes split), `chat_search_query` (every word a prefix, AND), GIN expression index. `pg_trgm` is enabled since 0163 | `0542_office_chat_search.sql`, `0163:7` | Same word search; typo pass with `pg_trgm` |
| M9 | Mentions exist in chat: body tokens `<@uuid>` (D-CHAT22), `message_mentions` kept by triggers (0521), bell via `modules/messaging/notify.ts`, categories in contract **and** a DB CHECK held equal by `notificationCategoryCheck.test.ts` | `0521`, `chatNotify.ts`, `notificationsContract.ts:112,200` | Same token format; a new category ships with its CHECK in one PR |
| M10 | Web mention pieces live inside `features/chat` (`mentionDraft.ts`, `chatNames.ts`, `ChatBody.vue`, `ChatComposer.vue`); `lint:boundaries` forbids a feature reaching into a sibling feature and the standing rule is "promote the shared thing out of `features/`" | `scripts/check-feature-boundaries.mjs:72-79` | Step UN4 promotes the mention primitives; nothing copies them |
| M11 | `merge_driver` moves rows through `DRIVER_REASSIGNMENTS` (`{table, column, orgScoped}`); a table left out is lost or stops the merge | `modules/roster/mergeDriver.ts:23` | The notes table is listed in the same PR as its migration |
| M12 | PostgREST caps every response at 1,000 rows; a long `.in()` list overflows Node 22 headers | memory, measured 2026 | List summaries come back as **one jsonb value** from an RPC, never as rows and never by id list |
| M13 | McLeod `dbo.comments`, text-only rows: drivers 1,551 on 980; trucks 1,453 on 639; trailers 860 on 345. No comment type means "hiring"; the driver types are receipts (recruiting hotel/flight, travel expense, Uber). Only 360 of 1,510 drivers have any text note within 7 days of their hire date. `driver.hire_date` is filled for 1,445 of 1,510 and for all 170 active drivers | sandbox `lme_analytics`, restore 2026-10-09 | There is no identifiable hiring note to pull (D-UN9) |
| M14 | `drivers.hire_date` exists in 360 and the McLeod roster sweep carries `hire_date` | schema snapshot; `modules/mcleod/rosterApplicantHire.ts:86,102` | The hire date is shown from the driver row, not stored as a note |
| M15 | Hot files near their budget: `surfaceCatalogue.ts` ~498 of 500 lines, `app.ts` 499 | memory 2026-10-25 | Neither is touched: no new surface (M6), and the router mounts inside roster's existing mount |

### 1.2 Unverified — each is checked by the named step before anything depends on it

| # | Question | Checked in | If the answer is "no" |
|---|---|---|---|
| U1 | Is `drivers.hire_date` filled on production for active drivers? | UN0 (one read-only count) | Blocker B2: fix the roster sweep's hire-date write first; the drawer shows no hire line until then. Not routed around |
| U2 | Does a migration calling messaging's `chat_search_vector`/`chat_search_query` from a roster function pass the module gates with a `cross-module-waiver` comment? | UN1 | Move the two functions to neutral names in the same migration and re-point 0542's callers; never a second copy |
| U3 | Is `roster -> messaging` (for `notify`) a declared edge in `lint:boundaries`? | UN3 | Declare the edge with its reason, through messaging's index only |
| U4 | Does `tenantIsolation.mjs` seed a table whose subject is one `subject_id` + `subject_kind` pair without a new exemption? | UN1 | Add the seeder entry in the same PR (the `chat_holds` precedent, 0517) |
| U5 | Where exactly does roster's router mount, so `/api/notes` adds no line to `app.ts`? | UN2 | Mount beside the roster routers in roster's own mount file; if none exists, extract one first (app.ts may only shrink) |
| U6 | Do the four tables share one column-definition shape and do saved views tolerate a new default-visible column? | UN5 | Record the per-table difference in the step's progress entry before building |

---

## 2. Research findings (2026-11-11)

What proven products do, and what we take from each.

| Source | Finding | Taken |
|---|---|---|
| Fleetio | Comments live in a side panel on the vehicle; `@name` mentions; a mention reaches the notification centre; the author is not notified of their own comment; "watching" a record is a separate opt-in | Side drawer, mentions to the bell, no self-notify. Watching is left out (D-UN11) |
| HubSpot | One pinned activity per record, visible to everyone; the timeline has a search that matches note text; a deleted note is recoverable | One pin per unit; search inside the drawer |
| Salesforce Chatter | Automatic "field changed" posts are purged after 45 days when nobody reacted | Human notes are kept apart from system events: the notes table holds only what a person wrote |
| Audit-trail practice | A correction is a new entry; the database itself refuses UPDATE and DELETE | Append-only guard in the database, as 0535 |
| PostgreSQL search guides | Word index (`tsvector` + GIN) first; trigram similarity as a second pass only when the first finds nothing; build highlights only for the rows returned | D-UN7 |

Sources: Fleetio help centre (team collaboration with @mentioning; watching a record; notification
center); HubSpot knowledge base (pin an activity on a record; record layout); Salesforce Trailhead
(feed tracking); Nanopim (audit trail best practices); Prisma, Tacnode and Grizzly Peak guides on
PostgreSQL full-text search.

---

## 3. Decisions

**D-UN1: one table for the three subjects.** `unit_notes` carries `subject_kind`
(`driver | vehicle | trailer`) and `subject_id`. One drawer, one API, one search.

**D-UN2: roster owns it.** The subjects are roster's tables (M4). Code in
`apps/api/src/modules/roster/notes/`, routes at `/api/notes`.

**D-UN3: a note is permanent and signed.** No edit. The database guard refuses every UPDATE except
pinning, removal (once) and the driver merge's subject move, and every DELETE. Text only, 1 to 4,000
characters; papers belong in Files.

**D-UN4: who can see can write (owner, 2026-11-11).** Read, write and pin all ask the subject's
section at `view`: driver → `roster`, vehicle and trailer → `equipment`. The map is one shared
constant (`UNIT_NOTE_SECTION`) read by the API and the web; nothing restates it. The `driver` role
holds neither section, so the driver app reaches nothing (owner: drivers do not see notes); no route
is added under `modules/driver-app`.

**D-UN5: removal is a named admin act (owner, 2026-11-11).** New entry `notes.remove` in
`ADMIN_ONLY_CAPABILITIES`, label "Remove a note", shown on the Permissions page with its reason.
Removal asks for a fresh sign-in and a written reason, is audited, **erases the text** and leaves a
line in the list: "Removed by NAME on MM/DD/YYYY — reason". Erasing is the point: the case for
removing a note is that it holds something that must not stay (Q-UN2).

**D-UN6: one pin per unit**, shown above the list to everyone, set by anyone who can write.

**D-UN7: search.** Inside the drawer: words match as prefixes, all words must match, unit numbers and
hyphenated words split the way chat's do (M8). When nothing matches, a second pass uses trigram
word similarity and the drawer says "No exact match. Close matches:". Filters: author, date range.
A switch widens the search from this unit to every unit the reader may see; each hit then names its
unit. The reader's permitted kinds are computed by the API from D-UN4 and passed to the function.
No AI search: notes average 25 to 40 characters (M13), where word and typo matching is more
reliable than meaning matching.

**D-UN8: mentions.** Body tokens `<@uuid>` (D-CHAT22's format). `unit_note_mentions` is derived by
trigger. Only an office member who can see that subject can be mentioned; the API refuses anybody
else with 422 `mention_cannot_see_unit`. A mention rings the bell (category `unit_note_mention`) and
opens the drawer on that note; the author is never notified of their own note.

**D-UN9: nothing is imported from McLeod; the hire date is shown (owner, 2026-11-11).** The owner
ruled "only the hiring note, if we have it; we can pull the hiring date". Measured (M13): McLeod has
no hiring-note type and most drivers have no note near their hire date, so there is nothing reliable
to pull. The driver drawer shows one fixed first line, "Hired MM/DD/YYYY", read from
`drivers.hire_date` (M14) — derived, not stored as a note, so it can never disagree with the roster.
Trucks and trailers have no such line. After launch the office writes notes in 360 only (owner).

**D-UN10: no live socket.** The drawer refetches on save and on window focus; list counts refetch
with their list. Mentions already travel through the bell.

**D-UN11: left out on purpose** — editing, attachments, watching a unit, AI search, applicant notes
on the driver drawer (they stay on the applicant record), notes in the driver app.

**D-UN12: where the column sits.** A "Notes" column in Vehicles, Trailers, Drivers and the Dispatch
Board, default visible, showing the count and the age of the latest note; empty shows a quiet "Add".
On the Dispatch Board it is **one** column per row whose drawer holds the truck's, the driver's and
the trailer's notes together with a chip per unit, because the dispatchers' own verdict on the board
was "too much information" (DISPATCH-BOARD-V2-PLAN). The three detail pages get a "Notes" button
that opens the same drawer. The drawer's state is in the URL (`?notes=<kind>:<id>&note=<id>`), so
the bell and a pasted link open it.

---

## 4. Shape

### 4.1 Database (one migration, step UN1)

```
unit_notes
  id, org_id → organizations (cascade)
  subject_kind  text  check in ('driver','vehicle','trailer')
  subject_id    uuid                      -- guard: exists in this org, in the table the kind names;
                                          -- a driver in status 'applicant' is refused (UN013)
  body          text  check 1..4000 after trim, or '' once removed
  author_id → auth.users (set null), author_name text 1..200
  pinned        boolean default false     -- unique (org_id, subject_kind, subject_id) where pinned
  removed_at, removed_by, removed_by_name, removal_reason (1..500)   -- all four or none
  created_at
  index (org_id, subject_kind, subject_id, created_at desc, id)
  GIN (search vector of body)  ·  GIN (body gin_trgm_ops)
  RLS on, no client policies (deny-all; the API uses the service role and org-filters)

unit_note_mentions (note_id → unit_notes cascade, user_id, org_id, created_at; pk (note_id, user_id))
  kept by trigger from the body's <@uuid> tokens; a token naming a non-member is refused (UN015)
```

Guards and functions (error codes `UN0xx`):

- `guard_unit_notes` — UN010 never deleted, UN011 never edited; allows `pinned`, the one-time
  removal columns with `body := ''`, and `subject_id` only for kind `driver` to a driver of the same
  org (UN012).
- Subject deletion is loud: a `before delete` trigger on `drivers`, `vehicles`, `trailers` raises
  UN014 while notes exist — the `on delete restrict` a single subject column cannot declare.
- `set_unit_note_pinned(p_org, p_note, p_pinned)` — unpins the unit's other note.
- `remove_unit_note(p_org, p_note, p_actor, p_actor_name, p_reason)` — UN020 not found, UN021
  already removed; clears the pin.
- `unit_note_summary(p_org, p_kinds text[])` → **one jsonb**: `{ kind: { subject_id: { count,
  last_at } } }`, removed notes not counted (M12).
- `unit_notes_search(p_org, p_kinds, p_subjects jsonb, p_q, p_author, p_from, p_to, p_before_at,
  p_before_id, p_limit)` → rows plus `fuzzy boolean`; keyset on `(created_at, id)`; limit clamp 50.
- Notification category `unit_note_mention`: the CHECK restated from the last migration that
  restates it, plus the contract line and label, in this same PR (M9).
- `DRIVER_REASSIGNMENTS` gains `{ table: "unit_notes", column: "subject_id", orgScoped: true }`
  (M11); the matrix proves a merge moves the notes and that a vehicle id is never touched by it.
- Registries in the same PR: `table-modules.json`, `table-writers.json`, table-lifecycle (growth
  word `time`), `tenantIsolation`, regenerated `schema.generated.sql`.
- Not evidence: not in `RETENTION_FORBIDDEN`. No purge job; removal is the only way text leaves.

### 4.2 Contract (frozen in UN0) — `packages/shared/src/unitNotesContract.ts`

`UNIT_NOTE_KINDS`, `UNIT_NOTE_SECTION`, `UNIT_NOTE_MAX_LENGTH`, `unitNoteCreateSchema`
`{kind, subjectId, body}`, `unitNotePinSchema`, `unitNoteRemoveSchema {reason}`,
`unitNoteListQuerySchema`, the `UnitNote` row (with `removed` tombstone fields and `mentions`),
`UnitNoteSummary`, `UnitNoteSearchHit` (adds `subjectLabel`, `fuzzy`), `UnitNotePerson`,
`parseNotesParam` / `formatNotesParam` for the URL, and `orderUnitNotes` (pinned first, then newest).
The `<@uuid>` token rule is not written twice: UN0 reads where chat keeps its parser (shared or
`features/chat/mentionDraft.ts`) and, if it is web-only, moves the pure part into shared for both.

### 4.3 API — `/api/notes` (roster module)

| Route | Gate | Answer |
|---|---|---|
| `GET /summary?kinds=` | `view` on each kind's section; kinds the caller lacks are left out; 403 when none remain | `{ kinds: { vehicle: { id: {count,lastAt} } } }` |
| `GET /?subjects=kind:id,…&q=&author=&from=&to=&before=` | `view` per subject; a subject the caller lacks is dropped; 403 when none remain | `{ notes, fuzzy, next, hireDate? }` |
| `GET /search?q=…&kinds=` | as `/summary` | `{ hits, fuzzy, next }` across units |
| `GET /people?kind=` | `view` on the kind | office members who can see that kind |
| `POST /` | `view` on the kind (D-UN4) | 201 `{ note }`; audit `notes.added`; rings mentions |
| `POST /:id/pin` | `view` on the note's kind | `{ pinned }`; audit |
| `POST /:id/remove` | `notes.remove` + `requireFreshAuth()` | tombstone; audit with the reason, never the text |

Every query org-filters and is asserted with `expectOrgScoped`. The `driver` role gets 403 on all
seven (test asserts the error code, not only the status).

### 4.4 Web

`apps/web/src/components/notes/` (outside `features/`, so pages and `features/dispatch` may import
it): `NotesCell.vue` (count + age, opens the drawer), `NotesDrawer.vue` (on `SlideOver`, size `lg`:
composer, search + filters, pinned, list, tombstones, hire line), `NoteComposer.vue`, `NoteRow.vue`,
`RemoveNoteDialog.vue`, `useUnitNotes.ts` (queries, mutations, invalidation), `useNotesDrawer.ts`
(URL state). Mention primitives move to `apps/web/src/components/mentions/` and chat imports them
from there (M10).

---

## 5. Blockers and open questions

| ID | Item | Who | Blocks | If not cleared |
|---|---|---|---|---|
| B1 | Another chat has unfinished work on chat's composer (`claude/chat-ch7-files`, handoff 2026-11-01). UN4 moves files that branch edits | orchestrator checks the branch state before UN4 starts | UN4 | UN4 waits for that branch to merge, or rebases it; never a copy of the mention code |
| B2 | U1: production hire dates | UN0 | the hire line only | The line is hidden and the sweep fix is planned as its own step |

**Q-UN1.** 360 drivers have a McLeod text note within 7 days of hire; their content was not read.
Import those as read-only "From McLeod" notes? (a) No, D-UN9 stands — **recommended**; (b) the
owner reads a sample in McLeod first and decides.

**Q-UN2.** Removal erases the text (D-UN5). (a) Erase — **recommended**; (b) keep the text hidden
and restorable by an admin.

**Q-UN3.** A note written about a driver may be read by every role with roster access (dispatcher,
recruiter, auditor). The composer carries one line: "Visible to everyone who can open this driver.
No medical or test results." (a) Keep the line — **recommended**; (b) no line.

The build proceeds on the recommended answers; each is one small change to reverse before release.

---

## 6. Steps

Each step is one PR to `main` from its own worktree and branch. "Done when" is the proof.

| Step | Track | What | Depends on | Done when |
|---|---|---|---|---|
| **UN0** | O | This plan; `unitNotesContract.ts` + its unit tests; progress folder; U1 measured | — | Contract merged; tracks may start |
| **UN1** | A — database | §4.1 whole; matrix `supabase/tests/unit-notes.test.mjs`; merge list; registries | UN0 | Matrix prints `RESULT`; each guard proved by a mutation (drop the guard → red); `verify:live staging` shows the migration |
| **UN2** | B — API | §4.3 except mentions ringing and removal; `modules/roster/notes/` | UN0 (builds on recorder fixtures); merges after UN1 | Route tests incl. org scope, driver-role 403 by code, kinds dropped per role; curl on staging answers 401 unauthenticated |
| **UN3** | B — API | Mentions: `/people`, 422 refusal, `notify()` with dedupe key, no self-notify; removal route + `notes.remove` in `ADMIN_ONLY_CAPABILITIES` | UN2 | Tests for each; `routeGateLedger.test.ts` green; Permissions page lists "Remove a note" |
| **UN4** | E — mentions (web) | Promote mention primitives to `components/mentions/`; chat imports from there; no behaviour change | UN0; B1 cleared | Chat's own tests green unchanged; `lint:boundaries` green |
| **UN5** | C — web core | `components/notes/` whole against a mock API (raw JSON); Notes column + drawer on Vehicles, Trailers, Drivers; Notes button on the three detail pages | UN0 (mock); merges after UN2 | Component tests; browser pass at 1440 and 390 with data / empty / failed fixtures |
| **UN6** | D — dispatch | Notes column on the board; merged drawer with unit chips; summary for three kinds in one call | UN5's components merged | Board tests; a recruiter-shaped session sees only the driver chip; browser pass |
| **UN7** | E — mentions (web) | Composer typeahead in `NoteComposer`; name chips in `NoteRow`; bell route for `unit_note_mention` opens the drawer on the note | UN3, UN4, UN5 | Tests; staging walk: mention → bell → drawer on that note |
| **UN8** | C — web core | Remove dialog (fresh sign-in, reason), tombstone row, pin control, cross-unit search switch | UN3, UN5 | Tests; staging walk as admin and as dispatcher (no Remove offered) |
| **UN9** | O | Staging walk of the whole feature with the role-scoped test members; release note; owner approves the release | all | Walk recorded in the progress folder |

Order of merges: UN0 → UN1 → UN2 → (UN3 ‖ UN5 ‖ UN4) → (UN6 ‖ UN7 ‖ UN8) → UN9.
Tracks A, B, C and E start together the moment UN0 merges; D starts when UN5 is open for review.

A production release that lands mid-build ships only inert parts (a table, routes nothing calls),
because every web step merges after the API it calls.

---

## 7. Running this in several chats

**One orchestrator chat, five builder chats.** The orchestrator never builds a track's step; it
keeps the order, the contract and the merges.

### 7.1 The orchestrator's job

1. Build and merge UN0. From then on the contract file is **frozen**: a builder who needs it changed
   stops and writes a progress entry naming the change; the orchestrator makes it in its own PR and
   tells the tracks to rebase.
2. Start each builder chat with its prompt (§7.4).
3. Read `docs/plans/notes/progress/` before every decision; it is the only shared record.
4. Give the migration its number: UN1 takes the next free number **read from `origin/main` right
   before its merge**.
5. Merge in §6's order when CI is green; say plainly which PRs are green and which are not. Where
   the app refuses a merge, list the green PRs for the owner.
6. Own every blocker and question in §5; run UN9.

### 7.2 Rules every builder chat follows

- Own worktree `~/Projects/FuelGuard-notes-<track>` and branch `claude/unit-notes-<step>`, both made
  from a fresh `origin/main`. Never work in the main checkout; other sessions share it.
- Touch only the files §7.3 gives your track. A needed change elsewhere is a progress entry, not an
  edit.
- Progress is **one new file per entry** in `docs/plans/notes/progress/`, named
  `YYYY-MM-DD-HHMM-<track>-<step>.md`, added in the step's PR. Never edit another entry or this
  plan's tables; a correction is a new entry naming the one it corrects.
- Run the gates before the first push (`pnpm ci:local --job gates`, `pnpm lint`, `pnpm typecheck`,
  the step's tests) and check each exit code.
- Prove every new test fails without the thing it tests.
- PR title is one sentence for an office reader; the body follows the four template headings.

### 7.3 File ownership (no file has two owners)

| Track | Chat | Owns |
|---|---|---|
| O | orchestrator | this plan, `packages/shared/src/unitNotesContract.ts` (+ test, + its `index.ts` export line), `docs/plans/notes/progress/README.md` |
| A | database | the migration, `supabase/tests/unit-notes.test.mjs`, `schema.generated.sql`, `scripts/table-*.json`, `supabase/tests/lib/tenantIsolation.mjs`, `modules/roster/mergeDriver.ts`, the `unit_note_mention` lines of `notificationsContract.ts` |
| B | API | `apps/api/src/modules/roster/notes/**`, roster's mount file, `packages/shared/src/namedGrants.ts`, the boundary edge line if U3 says so |
| C | web core | `apps/web/src/components/notes/**`, the Notes column and button lines in `VehiclesPage.vue`, `TrailersPage.vue`, `features/roster/driverRosterColumns.ts`, `DriversPage.vue`, the three detail pages |
| D | dispatch | `apps/web/src/features/dispatch/**` (the Notes column and its drawer wiring only) |
| E | mentions (web) | `apps/web/src/components/mentions/**`, the import lines in `features/chat/**`, `NoteComposer.vue`'s mention wiring and `NoteRow.vue`'s chips (handed over by C once UN5 merges), `lib/notificationRoute.ts` |

### 7.4 Prompts that start each builder chat

Paste one per new chat. Each begins the same way:

> Read `docs/plans/notes/UNIT-NOTES-PLAN.md` whole, then every file in
> `docs/plans/notes/progress/`. You are track **X**. Build step **UNn** exactly as §4 and §6
> describe, following §7.2 and touching only your files in §7.3. Stop and write a progress entry if
> the plan and the code disagree.

| Chat | X | First step | Then |
|---|---|---|---|
| Database | A | UN1 | — |
| API | B | UN2 | UN3 |
| Web core | C | UN5 | UN8 |
| Dispatch | D | UN6 (after UN5 is open) | — |
| Mentions | E | UN4 (after B1 is cleared) | UN7 |

---

## 8. Progress log

Entries live as one file each in [`progress/`](progress/README.md).
