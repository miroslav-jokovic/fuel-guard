# Unit notes — notes on drivers, trucks and trailers · 2026-11-11

**Status: BUILT 2026-11-12 (UN0–UN9). v2 on 2026-11-11 after the owner's second round of rulings (§3: no
removal for now, no hire line, notes are office-wide and refresh by themselves); UN0 froze the contract
and shipped the `notes` surface dark (D-UN14); UN9 switched it on for every office role on 2026-11-12.
It reaches production with the release the owner approves. Progress: [`progress/`](progress/README.md).**
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
| M5 | Section matrix: driver page asks `roster`, truck and trailer pages ask `equipment`. **Accountant has `roster: none`, `equipment: none`, `dispatch: none`** — billing can open none of the four tables. Safety manager has `dispatch: none` (no board) but sees drivers and trucks. Recruiter has `equipment: none`; technician has `roster: none`. `driver` role has `none` everywhere | `packages/shared/src/auth.ts:138-183`, `surfaceCatalogue.ts:209-211,285-288` | If notes followed the table's section, billing would never see a dispatcher's note. Notes need their own gate and a page of their own (D-UN4, D-UN13) |
| M5b | Office chat is the precedent for an office-wide screen: `{ key: "chat", gate: STAFF }`, every office role, never a driver | `surfaceCatalogue.ts:81` | Notes use the same gate |
| M6 | Admin-only named acts live in `ADMIN_ONLY_CAPABILITIES`, each with a label and a reason, shown on the Permissions page and held to routes by `routeGateLedger.test.ts`, which refuses a listed capability that guards no route | `packages/shared/src/namedGrants.ts` | Not used in this release (removal is deferred, D-UN5). When removal is added it is one entry here, in the same PR as its route |
| M7 | The drawer is `apps/web/src/components/SlideOver.vue` (`open`, `title`, `description`, `size md|lg|xl`, default + `footer` slots); the board's truck drawer already uses it | `features/dispatch/DispatchTruckDrawer.vue:107` | No new drawer component |
| M8 | Chat search (0542): `chat_search_vector` (`simple` config, dashes split), `chat_search_query` (every word a prefix, AND), GIN expression index. `pg_trgm` is enabled since 0163 | `0542_office_chat_search.sql`, `0163:7` | Same word search; typo pass with `pg_trgm` |
| M9 | Mentions exist in chat: body tokens `<@uuid>` (D-CHAT22), `message_mentions` kept by triggers (0521), bell via `modules/messaging/notify.ts`, categories in contract **and** a DB CHECK held equal by `notificationCategoryCheck.test.ts` | `0521`, `chatNotify.ts`, `notificationsContract.ts:112,200` | Same token format; a new category ships with its CHECK in one PR |
| M10 | Web mention pieces live inside `features/chat` (`mentionDraft.ts`, `chatNames.ts`, `ChatBody.vue`, `ChatComposer.vue`); `lint:boundaries` forbids a feature reaching into a sibling feature and the standing rule is "promote the shared thing out of `features/`" | `scripts/check-feature-boundaries.mjs:72-79` | Step UN4 promotes the mention primitives; nothing copies them |
| M11 | `merge_driver` moves rows through `DRIVER_REASSIGNMENTS` (`{table, column, orgScoped}`); a table left out is lost or stops the merge | `modules/roster/mergeDriver.ts:23` | The notes table is listed in the same PR as its migration |
| M12 | PostgREST caps every response at 1,000 rows; a long `.in()` list overflows Node 22 headers | memory, measured 2026 | List summaries come back as **one jsonb value** from an RPC, never as rows and never by id list |
| M13 | McLeod `dbo.comments`, text-only rows: drivers 1,551 on 980; trucks 1,453 on 639; trailers 860 on 345. No comment type means "hiring"; the driver types are receipts (recruiting hotel/flight, travel expense, Uber). Only 360 of 1,510 drivers have any text note within 7 days of their hire date. `driver.hire_date` is filled for 1,445 of 1,510 and for all 170 active drivers | sandbox `lme_analytics`, restore 2026-10-09 | There is no identifiable hiring note to pull (D-UN9) |
| M14 | `drivers.hire_date` exists in 360 and the McLeod roster sweep carries `hire_date` | schema snapshot; `modules/mcleod/rosterApplicantHire.ts:86,102` | Not used: the owner ruled the hire date unimportant for notes (D-UN9) |
| M15 | Hot files near their budget: `surfaceCatalogue.ts` is 495 of 500 lines (measured 2026-11-11; 498 after UN0), `app.ts` 499 (**corrected 2026-11-12: 484**, and roster has no mount file of its own — its routers mount in `app.ts` directly) | `git show origin/main:…` | The `notes` surface is ONE line in the catalogue; the router mounts inside roster's existing mount so `app.ts` is untouched |

### 1.2 Unverified — each is checked by the named step before anything depends on it

| # | Question | Checked in | If the answer is "no" |
|---|---|---|---|
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

**D-UN3: a note is permanent and signed.** No edit and no removal in this release. The database
guard refuses every UPDATE except pinning and the driver merge's subject move, and every DELETE.
Text only, 1 to 4,000 characters; papers belong in Files.

**D-UN4: notes are office-wide (owner, 2026-11-11, second round; confirmed as Q-UN4 (a)).** The owner: *"notes and comments
so everyone can see — if dispatch leaves a note related to billing or safety they can see it"*.
Measured (M5), that is not what the tables' own permissions give: billing can open none of the four
tables. So notes get their own gate: surface `notes`, gate `STAFF` — every office role reads, writes
and pins notes on any driver, truck or trailer of the carrier; the `driver` role is refused. This is
chat's gate (M5b), asked by the API on every route with `requireSurface("notes")`. It replaces the
first round's "a note follows its subject's section". Consequence, stated so nobody is surprised: a
recruiter can read a truck's notes and a technician a driver's. The driver app reaches nothing; no
route is added under `modules/driver-app`.

**D-UN5: no removal in this release (owner, 2026-11-11, second round: "we will see how it works and
add it later").** No remove route, no permission, no removal columns. When it is added it is a named
admin act (M6) in its own migration and PR. Until then a wrong note is answered by a new note.

**D-UN6: one pin per unit**, shown above the list to everyone, set by anyone who can write.

**D-UN7: search.** Inside the drawer: words match as prefixes, all words must match, unit numbers and
hyphenated words split the way chat's do (M8). When nothing matches, a second pass uses trigram
word similarity and the drawer says "No exact match. Close matches:". Filters: author, date range.
A switch widens the search from this unit to every unit of the carrier; each hit then names its
unit. The Notes page (D-UN13) is the same search with no unit chosen.
No AI search: notes average 25 to 40 characters (M13), where word and typo matching is more
reliable than meaning matching.

**D-UN8: mentions.** Body tokens `<@uuid>` (D-CHAT22's format). `unit_note_mentions` is derived by
trigger. Any office member of the carrier can be mentioned (they can all read notes, D-UN4). A
mention rings the bell (category `unit_note_mention`) and opens the drawer on that note; the author
is never notified of their own note.

**D-UN9: nothing is imported from McLeod and there is no hire line (owner, 2026-11-11).** Measured
(M13): McLeod has no hiring-note type and most drivers have no note near their hire date, so there
is nothing reliable to pull. The owner then ruled the hire date "not really important"; the drawer
does not show it. After launch the office writes notes in 360 only.

**D-UN10: live by refresh, not by socket.** The owner asked for "live sticky notes". An open drawer
and the Notes page ask for new notes every 10 seconds (chat's own fallback interval) and on window
focus; table counts refresh every 60 seconds and with their list. The request is a keyset read of
"notes after the newest I hold", so an idle drawer costs one small indexed query. A mention arrives
through the bell at once. Push over Realtime is not built: it would need a private topic per carrier
with its own authorisation, for a gain of seconds.

**D-UN11: left out on purpose** — editing, removal (D-UN5), attachments, watching a unit, AI
search, the hire date, any McLeod import, applicant notes on the driver drawer (they stay on the
applicant record), notes in the driver app.

**D-UN12: where the column sits.** A "Notes" column in Vehicles, Trailers, Drivers and the Dispatch
Board, default visible, showing the count and the age of the latest note; empty shows a quiet "Add".
On the Dispatch Board it is **one** column per row whose drawer holds the truck's, the driver's and
the trailer's notes together with a chip per unit, because the dispatchers' own verdict on the board
was "too much information" (DISPATCH-BOARD-V2-PLAN). The three detail pages get a "Notes" button
that opens the same drawer. The drawer's state is in the URL (`?notes=<kind>:<id>&note=<id>`), so
the bell and a pasted link open it.

**D-UN13: a Notes page.** `/notes`, in the sidebar's top group beside Chat, for every office role.
It is the wall: every note of the carrier, newest first, each naming its unit, with the same search
and filters (unit kind, author, date range) and the same refresh. A row opens that unit's drawer in
place. This is where billing and safety read what dispatch wrote without needing the fleet tables.


**D-UN14: the `notes` surface ships dark and UN9 turns it on (orchestrator, 2026-11-11, at UN0).**
Measured at UN0, §6 could not run in the order first written: `requireSurface` throws at load on a
key the catalogue lacks (`middleware/requireSurface.ts`), so UN2's routes need the `notes` line
before they can even be tested; and `lint:surfaces` refuses a catalogue line whose path is not a
declared route or that has no sidebar icon (`scripts/check-surfaces.mjs`). The line, the `/notes`
route and its icon therefore land together in UN0, before the page exists. Two choices make that
honest rather than a dead link: the surface carries `startsOnFor: []`, so only admins see it (and
the Notes columns, which follow the same surface) while it is built — Q-SET2's own mechanism, with
an admin able to switch roles on for a staging walk on the Permissions page; and the route shows
`PlaceholderPage.vue`, its comment labelled as the workaround it is, until UN8 points it at
`NotesPage.vue`. UN9 removes `startsOnFor`, which makes the line chat's exact shape (D-UN4, M5b).
Rejected: gating the API on a hand-written role check (a second source of truth for D-UN4), and
merging the API and the page in one PR (breaks the tracks apart).

---

## 4. Shape

### 4.1 Database (one migration, step UN1)

```
unit_notes
  id, org_id → organizations (cascade)
  subject_kind  text  check in ('driver','vehicle','trailer')
  subject_id    uuid                      -- guard: exists in this org, in the table the kind names;
                                          -- a driver in status 'applicant' is refused (UN013)
  body          text  check 1..4000 after trim
  author_id → auth.users (set null), author_name text 1..200
  pinned        boolean default false     -- unique (org_id, subject_kind, subject_id) where pinned
  created_at
  index (org_id, subject_kind, subject_id, created_at desc, id)
  GIN (search vector of body)  ·  GIN (body gin_trgm_ops)
  RLS on, no client policies (deny-all; the API uses the service role and org-filters)

unit_note_mentions (note_id → unit_notes cascade, user_id, org_id, created_at; pk (note_id, user_id))
  kept by trigger from the body's <@uuid> tokens; a token naming a non-member is refused (UN015)
```

Guards and functions (error codes `UN0xx`):

- `guard_unit_notes` — UN010 never deleted, UN011 never edited; allows `pinned`, and `subject_id`
  only for kind `driver` to a driver of the same org (UN012).
- Subject deletion is loud: a `before delete` trigger on `drivers`, `vehicles`, `trailers` raises
  UN014 while notes exist — the `on delete restrict` a single subject column cannot declare.
- `set_unit_note_pinned(p_org, p_note, p_pinned)` — unpins the unit's other note.
- `unit_note_summary(p_org, p_kinds text[])` → **one jsonb**: `{ kind: { subject_id: { count,
  last_at } } }` (M12).
- `unit_notes_search(p_org, p_kinds, p_subjects jsonb, p_q, p_author, p_from, p_to, p_before_at,
  p_before_id, p_after_at, p_after_id, p_limit)` → rows with the unit's label plus `fuzzy boolean`;
  keyset on `(created_at, id)` both ways (older pages, and D-UN10's "newer than I hold"); limit
  clamp 50. With no `p_subjects` it is the Notes page's wall; with no `p_q` it is a plain list.
- Notification category `unit_note_mention`: the CHECK restated from the last migration that
  restates it, plus the contract line and label, in this same PR (M9).
- `DRIVER_REASSIGNMENTS` gains `{ table: "unit_notes", column: "subject_id", orgScoped: true }`
  (M11); the matrix proves a merge moves the notes and that a vehicle id is never touched by it.
- Registries in the same PR: `table-modules.json`, `table-writers.json`, table-lifecycle (growth
  word `time`), `tenantIsolation`, regenerated `schema.generated.sql`.
- Not evidence: not in `RETENTION_FORBIDDEN`. No purge job and no removal (D-UN5).

### 4.2 Contract (frozen in UN0) — `packages/shared/src/unitNotesContract.ts`

`UNIT_NOTE_KINDS`, `UNIT_NOTE_MAX_LENGTH`, `UNIT_NOTE_REFRESH_MS`, `unitNoteCreateSchema`
`{kind, subjectId, body}`, `unitNotePinSchema`, `unitNoteListQuerySchema`, the `UnitNote` row
(with `subjectLabel` and `mentions`),
`UnitNoteSummary`, `UnitNoteSearchHit` (adds `subjectLabel`, `fuzzy`), `UnitNotePerson`,
`parseNotesParam` / `formatNotesParam` for the URL, and `orderUnitNotes` (pinned first, then newest).
The `<@uuid>` token rule is not written twice. Measured at UN0: chat's parser is already in shared
(`chatMentionIds`, `chatBodyParts`, `chatBodyText`, `chatMentionToken` in `chatContract.ts`), so the
contract names it and adds nothing. UN0 also froze what §4.2 had left implicit: `UNIT_NOTE_KIND_LABELS`,
`UNIT_NOTE_MAX_SUBJECTS` (8), `UNIT_NOTE_PAGE_LIMIT` (50), `UNIT_NOTE_SUMMARY_REFRESH_MS` (60 s),
`UNIT_NOTE_AUDIENCE_LINE` (Q-UN3's words), the keyset cursor (`<created_at>~<id>`), the response
types, and `unitNoteSummaryQuerySchema`. Fields are camelCase; the API maps the row.

### 4.3 API — `/api/notes` (roster module)

Every route asks `requireSurface("notes")` (D-UN4).

| Route | Answer |
|---|---|
| `GET /summary?kinds=` | `{ kinds: { vehicle: { id: {count,lastAt} } } }` |
| `GET /?subjects=kind:id,…&q=&kind=&author=&from=&to=&before=&after=` | `{ notes, fuzzy, next }`; no `subjects` = the wall (D-UN13) |
| `GET /people` | the carrier's office members, for the `@` list |
| `POST /` | 201 `{ note }`; audit `notes.added`; rings mentions |
| `POST /:id/pin` | `{ pinned }`; audit |

Every query org-filters and is asserted with `expectOrgScoped`. The `driver` role gets 403 on all
five (test asserts the error code, not only the status).

### 4.4 Web

`apps/web/src/components/notes/` (outside `features/`, so pages and `features/dispatch` may import
it): `NotesCell.vue` (count + age, opens the drawer), `NotesDrawer.vue` (on `SlideOver`, size `lg`:
composer, search + filters, pinned, list), `NoteComposer.vue`, `NoteRow.vue`, `NotesList.vue`
(shared by the drawer and the page), `useUnitNotes.ts` (queries, mutations, the D-UN10 refresh),
`useNotesDrawer.ts` (URL state). `apps/web/src/pages/NotesPage.vue` is the wall (D-UN13). Mention primitives move to `apps/web/src/components/mentions/` and chat imports them
from there (M10).

---

## 5. Blockers and open questions

| ID | Item | Who | Blocks | If not cleared |
|---|---|---|---|---|
| B1 | ~~Another chat has unfinished work on chat's composer (`claude/chat-ch7-files`, handoff 2026-11-01). UN4 moves files that branch edits~~ **Cleared 2026-11-11 at UN0:** the branch merged as #1906 on 2026-11-02 with no commit left outside `main`, and no open PR touches `features/chat/` | orchestrator | — | — |

**Q-UN1.** 360 drivers have a McLeod text note within 7 days of hire; their content was not read.
Import those as read-only "From McLeod" notes? (a) No, D-UN9 stands — **recommended**; (b) the
owner reads a sample in McLeod first and decides.

**Q-UN2.** Closed 2026-11-11: no removal in this release (D-UN5).

**Q-UN3.** Ruled yes 2026-11-11: the composer carries one line, "Visible to the whole office. No
medical or test results."

**Q-UN5.** Ruled (a) 2026-11-12 by the orchestrator (raised by track D, `progress/2026-11-11-1600-D-UN6.md`):
the board row could name neither the trailer (it sent `trailerUnit` as text) nor a team's second seat,
so the merged drawer could not be built. Before UN6, step **UN6a** (track D) adds
`trailerId` (from `plan.currentTrailerId`, which the board already holds) and `coDriver` (from the
roster pairing, `vehicles.co_driver_id`, the source `driver` already comes from) to
`dispatchBoardRowSchema`. API and contract only, no migration. Roster's pairing over the load's
`co_driver_id` so the board, the map and the drawer name the same two people; a slip-seat day where
the two differ is left to the board's own pairing rules. (b) resolving the unit number to an id in
the browser was rejected as a second copy of what the API knows.

**Q-UN4.** Ruled (a) 2026-11-11 (owner: "notes are office-wide as recommended"): D-UN4 stands.
Nothing blocks UN0. Q-UN1 proceeds on its recommendation.

---

## 6. Steps

Each step is one PR to `main` from its own worktree and branch. "Done when" is the proof.

| Step | Track | What | Depends on | Done when |
|---|---|---|---|---|
| **UN0** | O | This plan; `unitNotesContract.ts` + its unit tests; the `notes` surface line (dark), its `/notes` route on the placeholder and its icon (D-UN14); progress folder | — | Contract merged; tracks may start |
| **UN1** | A — database | §4.1 whole; matrix `supabase/tests/unit-notes.test.mjs`; merge list; registries | UN0 | Matrix prints `RESULT`; each guard proved by a mutation (drop the guard → red); `verify:live staging` shows the migration |
| **UN2** | B — API | §4.3 except mentions ringing; `modules/roster/notes/` | UN0 (builds on recorder fixtures); merges after UN1 | Route tests incl. org scope and driver-role 403 by code; curl on staging answers 401 unauthenticated |
| **UN3** | B — API | Mentions: `/people`, `notify()` with dedupe key, no self-notify | UN2 | Tests for each |
| **UN4** | E — mentions (web) | Promote mention primitives to `components/mentions/`; chat imports from there; no behaviour change | UN0; B1 cleared | Chat's own tests green unchanged; `lint:boundaries` green |
| **UN5** | C — web core | `components/notes/` whole against a mock API (raw JSON), incl. pin and the D-UN10 refresh; Notes column + drawer on Vehicles, Trailers, Drivers; Notes button on the three detail pages | UN0 (mock); merges after UN2 | Component tests; browser pass at 1440 and 390 with data / empty / failed fixtures |
| **UN6a** | D — dispatch | Q-UN5: `trailerId` and `coDriver` on the board row (contract + API, no migration) | UN0 | Contract and board API tests; each new field proved by a mutation |
| **UN6** | D — dispatch | Notes column on the board; merged drawer with unit chips; summary for three kinds in one call | UN5's components merged; UN6a | Board tests; browser pass |
| **UN7** | E — mentions (web) | Composer typeahead in `NoteComposer`; name chips in `NoteRow`; bell route for `unit_note_mention` opens the drawer on the note | UN3, UN4, UN5 | Tests; staging walk: mention → bell → drawer on that note |
| **UN8** | C — web core | The Notes page (D-UN13): the `/notes` route's component becomes `NotesPage.vue` (route, icon and sidebar entry already exist, D-UN14), wall with search and filters, row opens the drawer | UN5 | Tests incl. route table and sidebar; staging walk as an accountant-shaped member: sees the page, reads a dispatcher's note |
| **UN9** | O | Remove the `notes` surface's `startsOnFor: []` (D-UN14); staging walk of the whole feature with the role-scoped test members; release note; owner approves the release | all | Walk recorded in the progress folder |

Order of merges: UN0 → UN1 → UN2 → (UN3 ‖ UN5 ‖ UN4 ‖ UN6a) → (UN6 ‖ UN7 ‖ UN8) → UN9. UN6a touches
no notes file and may merge any time after UN0.
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
| O | orchestrator | this plan, `packages/shared/src/unitNotesContract.ts` (+ test, + its `index.ts` export line), the `notes` line in `surfaceCatalogue.ts`, the `notes` icon line in `lib/navIcons.ts`, `docs/plans/notes/progress/README.md` |
| A | database | the migration, `supabase/tests/unit-notes.test.mjs`, `schema.generated.sql`, `scripts/table-*.json`, `supabase/tests/lib/tenantIsolation.mjs`, `modules/roster/mergeDriver.ts`, the `unit_note_mention` lines of `notificationsContract.ts` |
| B | API | `apps/api/src/modules/roster/notes/**`, roster's mount file, the boundary edge line if U3 says so |
| C | web core | `apps/web/src/components/notes/**`, the Notes column and button lines in `VehiclesPage.vue`, `TrailersPage.vue`, `features/roster/driverRosterColumns.ts`, `DriversPage.vue`, the three detail pages, `pages/NotesPage.vue`, and the `/notes` route entry in `router/routes/core.ts` with its line in `routeTable.test.ts` and the snapshot (made by O in UN0, C's from UN0's merge). Every Notes column and button shows only when the viewer holds the `notes` surface (D-UN14) |
| D | dispatch | `apps/web/src/features/dispatch/**` (the Notes column and its drawer wiring only); for UN6a, the `trailerId`/`coDriver` lines of `packages/shared/src/dispatchBoardContract.ts`, `apps/api/src/modules/livemap/dispatchBoard.ts` and `apps/api/src/modules/roster/fleetIdentityReads.ts` with their tests; the `NotesDrawer` mount in `apps/web/src/pages/AssignmentsPage.vue` (the board page, which is not under `features/dispatch/`) |
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
