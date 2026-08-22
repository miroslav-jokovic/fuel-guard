# Recruiting & DQF UI surface plan — the half that no gate measures

**Created 2026-08-21, after `HANDOFF-2026-08-21-NIGHT.md`.** Child plan of
`RECRUITING-SYSTEM-PLAN.md`; sibling of the completed `APPLICATION-SYSTEM-PLAN.md`. Executes under
that document's §4 protocol without exception — this plan adds steps, never a second protocol.

Scope: the **surfaces** of recruitment, driver qualification and the driver application — their
entry points, their composition, and the primitives they were forced to hand-roll. Not their
regulation, not their schema, not their services. Those are correct and shipped.

---

## 0. Why this document exists

`APPLICATION-SYSTEM-PLAN.md` A0–A11b are all DONE and all live at schema 0233. The work is
regulation-correct: §391.21(b)(6) read verbatim off FMCSA's own form, §64.1200 consent modelled as a
consent regime, an append-only evidence line held. Its handoff is accurate about every claim it
makes.

It is also silent about the surfaces, and says so plainly in its own §7:

> ⚠ **nothing in A1–A11b has been exercised in a browser or against a real inbox.**

That silence is not an oversight in the handoff. It is the shape of the gates. `lint:ui-adoption`
and `lint:tokens` both pass **clean** on every file named in this plan, and the design contract
states the reason in its own §0:

> The linter currently passes clean. So every deviation below is a *design-system* violation the
> linter cannot see. That is the point: the linter only catches colour, not structure.

Eleven steps of correct work therefore shipped into surfaces that satisfy every machine check and
still do not compose. This plan is the measured list, and the steps that close it.

⚠ **The most consequential finding is not cosmetic.** The application system has no front door: the
only path to `/apply/:token` runs through creating a driver record by hand first (§2.1). A
walkthrough of the flow — which the night handoff correctly ranks as worth more than the next
feature — is **not presently possible for a recruiter**, because the act that starts it is not
offered anywhere in recruitment.

---

## 1. Ground truth — established 2026-08-21, not recalled

| Fact | Value | How it was established |
|---|---|---|
| Migration head | 0233, live | `pnpm verify:live` |
| Deploy drift | commit only (`263b8bd` local vs `239778b` live) — the docs-only handoff merge; schema matches | `pnpm verify:live` |
| `lint:ui-adoption` | ✓ clean — shared controls only, 0 visible raw tables | run |
| `pnpm --filter web lint:tokens` | ✓ clean | run |
| Pages with a page-level test | `ApplyPage.test.ts`, `DashboardPage.test.ts` — and nothing else | `ls pages/*.test.ts` |

⚠ Everything this plan proposes is **web-only**: no migration, no API change, no contract change.
It cannot break `migrate.yml`, and its whole risk surface is rendering.

---

## 2. The findings — each measured, each with its file

### 2.1 ⚠ D-UI1 · The application system has no entry point

`ApplicationInviteCard` takes a `driverId` prop and is mounted in exactly one place —
`DriverDetailPage.vue:190`, inside the tab labelled **"Employment"**. There is no other mount.
A driver row must therefore already exist before anybody can be invited to apply, and the only
affordance that creates one is **Fleet → Drivers → New driver** (`DriversPage.vue:240`).

The full path a recruiter must find, unaided:

> Fleet → Drivers → *New driver* → complete the driver form → open that driver → **Employment** tab
> → scroll past the invite card's siblings → create link → copy → send the email themselves

`RecruitmentPage.vue` — the page that owns applicants — offers no way to create one. Its empty state
(`RecruitmentPage.vue:138`) reads *"Somebody becomes an applicant when they start an application"*,
which is true and circular: the surface that starts one is not reachable from it.

⚠ **This is `RECRUITING-SYSTEM-PLAN.md` §4's own frontend rule, already written, already violated:**

> A new routed page ships **in one commit** with … **an entry point** — a nav entry (`lib/nav.ts`)
> or an in-product button. **A route reachable by no link is the P0b incident again.**

`/apply/:token` is a public token route and correctly has no nav entry. But the *act that mints the
token* is subject to that rule, and it is buried three levels deep in a different section under a
noun ("Employment") that does not name it.

**Corollary — the dashboard.** `DashboardPage.vue` drills into eight destinations: `/fuel-log`,
`/transactions`, `/driver-performance`, `/idling`, `/anomalies`, `/coverage`, `/reefer-coverage`,
`/rejections`. Not one recruitment, qualification or application tile. A carrier whose §391 files
are the compliance risk opens a page that only discusses fuel.

**Corollary — two invisible pages.** `nav.ts` publishes one recruitment item (**Applicants** →
`/recruitment`). `/recruitment/screening` and `/recruitment/inquiries` are routed, gated and built,
and are reachable **only** from two buttons in `RecruitmentPage`'s header slot
(`RecruitmentPage.vue:102-103`). A recruiter who lands on `/recruitment/inquiries` from a
notification has no nav item to return to.

### 2.2 D-UI2 · Four KPI tiles, four different anatomies

`docs/DESIGN-SYSTEM-CONTRACT.md` §2.4 is prescriptive to the class string:

| Role | Exact classes |
|---|---|
| KPI label | `text-xs font-medium tracking-wide text-ink-muted uppercase` |
| KPI value | `mt-1 text-2xl font-bold text-ink` |
| KPI sub-caption | `mt-0.5 text-xs text-ink-tertiary` |

Measured against it:

| Surface | What it renders | Verdict |
|---|---|---|
| `CompliancePage.vue:175` attention strip | `BaseCard padding="sm"`, label + value exactly as prescribed | ✅ the reference |
| `RecruitmentPage.vue:108` | `BaseCard padding="sm"`, label `text-sm font-medium text-ink`, value `mt-2 text-2xl font-bold` | ❌ label is a body role, not a KPI label |
| `InquiryQueuePage.vue:87` | bare `<div>` grid inside one card, label `text-sm text-ink-muted` | ❌ not a tile at all |
| `ScreeningReadinessPage.vue:120` | `<dl>` of `rounded-surface bg-surface-muted p-3`, value **`text-lg font-bold`** | ❌ hand-rolled tile; `text-lg` is the h2 role, not a KPI |

`features/dashboard/StatCard.vue` already exists and carries the full anatomy — label, value,
sub-caption, icon chip with tone, optional sparkline, optional whole-tile link, loading skeleton.
Four surfaces each re-approximated a subset of it. `lint:boundaries` constrains **feature → feature**
imports only (`check-feature-boundaries.mjs:5-6`), so a *page* may import it — `DashboardPage` does —
but a component four pages share is a `components/ui/` composite by §1.1b's own definition, not a
dashboard internal.

⚠ `ScreeningReadinessPage.vue:97` carries `<PageHeader />` with no description — the **only** empty
PageHeader in the app. `PageHeader` renders the h1 from `route.meta.title`, so the page is not broken;
it is the one page that says nothing about itself.

### 2.3 D-UI3 · One area, two list shells — and R0b sanctioned it

R0b (DONE 2026-08-20) recorded contract §5.2b: new list pages compose `DataWorkspace` →
`FilterBar embedded` → `DataTable embedded`; **existing standalone-cards pages are left alone**, with
`DriversPage` as the reference. It rebuilt `InquiryQueuePage` and `ScreeningReadinessPage` on that
shell (`ea2c9b9`).

`RecruitmentPage` was touched the same day by a different commit (`e95cd05`) and was **not** rebuilt.
The result is correct by R0b's letter and wrong to look at: three sibling pages one click apart, two
of them a seamless workspace, the third a loose `FilterBar` floating above a separate `BaseCard`.

App-wide, `DataWorkspace` is the minority (6 pages) and the loose composition the majority (22). This
plan does **not** propose a fleet-wide migration. It proposes that one *area* not straddle the line.

### 2.4 D-UI4 · Two primitives do not exist, so 34 files hand-roll them

- **No tabs primitive.** Six pages build `role="tablist"` out of `BaseButton` with manual class
  overrides — `CompliancePage`, `DriverDetailPage`, `AssignmentsPage`, `AuditPage`,
  `DispatchLoadsPage`, `DriverAppSettingsPage`. The recipe is byte-similar in each
  (`flex gap-1 rounded-surface bg-surface-muted p-1 text-sm` + a per-item
  `rounded-control px-3 py-1.5 font-medium transition`), which is how a copied pattern looks.
- **No callout primitive.** 28 files hand-roll `bg-<role>-50 … ring-1 ring-<role>-100`, including
  `CompliancePage.vue:144`. The barrel has no `AppCallout`; `EnvironmentBanner`, `UpdateBanner` and
  `PlanStatusBanner` are three single-purpose banners, none general.

Both pass every gate: the colours are token roles and the controls are `App*` primitives. The
structure is what repeats, and no script reads structure. **This is the cause of "inline design" in
the areas you flagged — not a shortcut taken in those areas.**

### 2.5 D-UI5 · One component misuse, and one place the documentation is wrong

- `CompliancePage.vue:189` — each attention tile renders a **badge whose text is "filter" /
  "filtering"**. `lib/badges.ts` is the *status* vocabulary; a badge used as the affordance label for
  a toggle teaches the badge to mean two things. The tile is already `:as="'button'"` with
  `aria-pressed` — the state is conveyed correctly and the badge is a second, conflicting signal.

⚠ **Corrected 2026-08-21 during U1, and left standing as the worked example.** An earlier draft of
this section called `RecruitmentPage.vue:166` — `<BaseButton class="kebab-item">` inside `KebabMenu`
— a misuse, on the authority of contract §1.2 ("children must be `<button class="kebab-item">`").
**That is backwards, and the contract is the stale half.** `lint:ui-adoption` counts raw `<button>`
in `pages/` and `features/` as a failure (`ui-system-inventory.mjs:91,124`), `apps/web/CLAUDE.md`
lists `BaseButton class="kebab-item"` among its non-negotiables, and **all nine call sites in the app
already do it that way**. `RecruitmentPage` is correct and was never the defect.

The finding that survives is a documentation one, and it is worth fixing because it is what produced
the wrong reading: **three places tell you to write a raw `<button>` that the gate rejects** —
contract §1.2, `KebabMenu.vue:9` ("Put `<button class="kebab-item">` children in the default slot")
and `DataTable.vue:23`'s usage docblock. All three predate the gate.

⚠ This is `RECRUITING-SYSTEM-PLAN.md` §4's own standing warning, demonstrated on this plan's own
author: *"The gates outrank the contract … read the two gate scripts before writing UI, and trust
them over the contract."* Every remaining finding in §2 was re-checked against the gate scripts and
the call sites after this one was caught.

⚠ Related, app-wide, out of this plan's scope but recorded: **`AppBadge` is exported from
`@fuelguard/ui` and imported by zero files** — 56 files use `BADGE_BASE` from `lib/badges.ts`. One of
the two is dead. R0b chose `lib/badges.ts` deliberately (it owns the tone vocabulary); the export
should either be deleted or documented as admin-only.

### 2.6 D-UI6 · Three icon defects, all in `nav.ts`

- **`ClipboardDocumentCheckIcon` is bound to two unrelated nav items** — "Assignments" (Dispatch) and
  "Driver Qualification" (Safety). One glyph, two meanings, both visible at once in an expanded
  sidebar.
- **"Applicants" renders `BuildingOffice2Icon`** → `Building02Icon` (`icons.ts:93`). A building, for
  the person applying.
- The Recruitment **section** icon is `ClipboardDocumentListIcon` → `ClipboardIcon`, which carries a
  standing `// ⚠ verify` comment at `icons.ts:120`, and sits directly above a second clipboard-family
  glyph in Safety.

⚠ Icon-less **pages** are the app-wide norm (33 of 60+), because icons live in nav, `StatCard` and
`DataTable` rather than in page bodies. That norm is not a defect and this plan does not propose
sprinkling icons into page bodies. The defects are the three bindings above.

### 2.7 D-UI7 · The Employment tab is four features under one noun

`DriverDetailPage.vue:188-197`, the `employment` section, stacks on one scroll:

| Component | Lines | What it is |
|---|---|---|
| `ApplicationInviteCard` | 195 | mint/revoke an application link |
| `EmploymentHistorySection` | 256 | §391.21(b)(10) employment history |
| `EmployerInquirySection` | 293 | §391.23 safety-history investigation |
| `PspRecordsSection` | 282 | PSP orders and returned records |

≈ **1,026 lines of UI under a tab labelled "Employment"**, spanning four regulations and three
different actors' work. The header's own description for the page reads "Profile, qualification file
and fueling history" — it does not mention any of it.

Each section's placement is individually argued in comments (H5/D-HIRE2 puts the application above
the history it produces; P14 puts PSP beside the history it corroborates). The arguments are sound
pairwise. The sum is one scroll nobody scoped.

### 2.8 What is **not** broken — recorded so it is not "fixed"

- **`ApplyPage.vue`.** Consent → four-instrument ceremony → seven screens → review → certify is
  regulation-shaped, not over-designed: §390.32(d) puts the 7001(c) consent first, FCRA §604(b)(2)
  forbids anything sharing the screen with a disclosure, and §391.21(b)(12) requires the whole
  document be visible before it is sworn to. It is also the **one** surface in this plan with a real
  page test. Its deliberate omission of `PageHeader` is correct — it has no session and no
  `route.meta.title` to render.
- **Filter/pagination discipline.** All three recruitment list pages carry `FilterBar` with search,
  a domain-noun count and `TablePagination` in the table footer, as §4 requires.
- **Badge tone centralisation.** No `.vue` file in these areas carries a local status tone `Record`;
  R0b's rule held through A1–A11b.
- **The gates.** Nothing in this plan is a gate failure, and no gate needs relaxing to execute it.

---

## 3. Decisions this plan takes

| ID | Decision |
|---|---|
| **D-UI1** | Recruitment owns the act of inviting an applicant. The invite affordance moves to `/recruitment` as its primary action; the driver-detail card stays for the already-created driver. |
| **D-UI2** | The KPI tile becomes one shared component. `StatCard` is promoted out of `features/dashboard/` into `components/ui/` and the four hand-rolled variants are retired onto it. `CompliancePage`'s strip is the anatomy that wins, because it already matches contract §2.4. |
| **D-UI3** | The **area** is the unit of shell consistency, not the app. `RecruitmentPage` moves onto `DataWorkspace` to match its two siblings. No other page is touched. |
| **D-UI4** | `AppTabs` and `AppCallout` are built in `@fuelguard/ui` and adopted **only** by the surfaces this plan touches. The remaining hand-rolled instances are recorded, not migrated — a fleet-wide sweep is its own step with its own risk. |
| **D-UI5** | A badge never labels an affordance. The attention tile's filter state is carried by `aria-pressed` and the existing ring, which it already has. ⚠ Where a gate and a document disagree, the gate is right and the **document** is the thing to fix — see §2.5's correction. |
| **D-UI6** | Every nav item has a glyph no sibling shares. ⚠ The **label** "Applicants" is **not** renamed here — `RECRUITING-SYSTEM-PLAN.md` R9 explicitly owns that word ("the nav label 'Applicants' is renamed to match what the page now is (R9 decides the word, the rename ships with the board)"). This plan changes the icon only. |
| **D-UI7** | "Employment" splits into the recruiting work and the qualification work by *who does it*, not by which regulation names it. |
| **D-UI8** | ⚠ **Nothing in this plan may pre-empt R9.** R9 grows `/recruitment` into the recruiter board with the four-stage view demoted to a slice. Every surface built here composes shared components so R9 re-arranges them rather than rewriting them; no new page is created that R9 would have to delete. |

---

## 4. Steps — U1 … U6

Executed under `RECRUITING-SYSTEM-PLAN.md` §4 verbatim: one step per branch `claude/<topic>`, PR to
`main`, wait for CI, merge commit, `pnpm verify:live`. Mark **DONE <date>** in place with a "What
shipped" list and a "Verified by:" line naming the gates run.

**Gates for every step in this plan** (no migration, so the schema gates are inapplicable but still
run as part of `pnpm lint`): `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:ui-adoption`,
`pnpm --filter web lint:tokens`, `pnpm lint:ui-contrast`, `pnpm lint:tokens-parity`,
`pnpm lint:filesize`, `pnpm lint:funcsize`, `pnpm lint:boundaries`, `pnpm lint:comment-claims`.

⚠ `pnpm lint` scans `.claude/worktrees/`. Filter before believing a failure:
`pnpm lint 2>&1 | grep -E "^/Users" | grep -v "\.claude/worktrees"`.

---

### U1 · The front door — DONE 2026-08-21 (no migrations)

**Prerequisites:** none. Nothing in §5 of the parent plan blocks it and it blocks the walkthrough the
night handoff §7 asks for.

**Build.**
1. **`/recruitment` gains "Invite an applicant"** as `PageHeader`'s primary action — a `SlideOver`
   that takes the name and email, creates the applicant record and mints the invitation in one act,
   then shows the link once with the copy affordance `ApplicationInviteCard` already has. ⚠ The
   token is shown **once** (the server keeps only a SHA-256) — reuse that card's existing copy and
   its "cannot be shown again" wording verbatim; do not restate the rule in new words.
2. ⚠ **Reuse, do not re-implement:** the mutation is `useCreateApplicationInvite`, the state
   vocabulary is `applicationInviteBadge` in `lib/badges.ts`, and the role gate is
   `rolesThatManage("recruitment")` — all three already exist and are tested
   (`useApplicationInvites.test.ts`). If creating the applicant record and minting the invitation
   cannot be one call today, the drawer performs them in sequence and **says so on failure of the
   second** — a driver row with no invitation is a recoverable state, and silence about it is not.
3. **`nav.ts` publishes the two invisible pages** — "Screening readiness" (`/recruitment/screening`)
   and "Safety-history inquiries" (`/recruitment/inquiries`) under Recruitment, both gated
   `canViewSection(role, "recruitment")`. Keep the header buttons; a nav item and an in-context
   button answer different questions.
4. **Route records get `parent`** so the back chevron works, per §4's frontend rule.

**Verify.** A component test mounting `RecruitmentPage` that asserts: the action is absent for a role
failing `rolesThatManage("recruitment")`; present for one passing it; the drawer surfaces the link
exactly once. A `buildNavGroups` unit test pinning three recruitment items for a recruiter and zero
for a driver.

**Done when:** a recruiter who has never seen the app can start an application from the page named
after applicants, and the two sibling pages are reachable without knowing they exist.

**What shipped.**
- `InviteApplicantDrawer.vue` + `useCreateApplicant.ts` — "Invite an applicant" is now the primary
  action on `/recruitment` and on its empty state. Creates the person as `status: "applicant"` (what
  `GET /api/recruitment/pipeline` selects on) and mints the invitation against them.
- ⚠ **Through `POST /api/roster/drivers`, not PostgREST.** 0212 grants the recruiter that INSERT, so
  the client-side `useCreateDriver` shortcut would have worked — and would have skipped
  `driverCreateSchema`, the `driver.created` audit row, and `identity_source: 'manual'`. The last
  matters most: an applicant is in nobody's telematics, and a row the Samsara sync believes it owns
  has its name and phone overwritten on the next poll.
- **The halfway state is named.** No endpoint does both acts, so the drawer does them in sequence and
  reports *which half* succeeded — the applicant exists on the board, and their own Application card
  is where the link is minted. Pinned by "when the invitation fails, says the applicant exists and
  where to finish".
- `ApplicationLinkOnce.vue` — the shown-once promise extracted from `ApplicationInviteCard` so both
  birthplaces make the identical promise. The card renders it now rather than its own copy.
- The empty state stopped being circular: "Invite one and they fill in their own §391.21(b)
  application", replacing "somebody becomes an applicant when they start an application".
- `nav.ts` publishes **Screening readiness** and **Safety-history inquiries**, each with a glyph no
  other nav item uses. The header buttons stay: one answers "from here", the other "at all".
- `pipelineKey` exported from `useEmployment.ts` so the new mutation can invalidate the board.

⚠ **Two corrections made during execution, both folded in place.** The `parent` route meta this step
promised to add **already existed** on both sub-routes — they were registered 2026-08-20 to close P0b
and simply never got nav entries, so step 4 was a no-op. And §2.5's kebab-item finding was wrong; see
its ⚠, which is left standing as the worked example of §4's "gates outrank the contract".

⚠ **A test that passed for the wrong reason, caught and pinned.** `session.role` is a COMPUTED over
the decoded access token, so `session.role = "recruiter"` is a no-op and both gate assertions in
`InviteApplicantDrawer.test.ts` passed while the calls they were meant to prove never fired. The store
is stubbed instead (`PspRecordsSection.test.ts:103`'s precedent). **A gating test that never exercised
the ungated path is worse than no test**, and this one only surfaced because a sibling assertion
demanded the calls.

⚠ **Not verified in a browser.** `vite` crashes on this machine in `prepareRolldownOptimizerRun`
(a rolldown WASM memory error) while scanning `node_modules`, before reaching project code —
reconfirmed today on **Node 26.7.0**, having first been seen on Node 23.6.0. Three major Node versions
behave identically, so the standing "needs a Node downgrade" theory is **disproven**: the local dev
server is simply unavailable, and CI runs `pnpm build` on its own runners. **U7's walkthrough must run
against the deployed Railway app.**

**Verified by:** `pnpm test` (all unit suites + 18 PGlite matrices) · `pnpm typecheck` · `pnpm lint`
(701 errors, all from 32 files inside `.claude/worktrees/`; **zero** in the tracked tree) ·
`lint:ui-adoption` · `pnpm --filter web lint:tokens` · `lint:ui-contrast` · `lint:tokens-parity` ·
`lint:boundaries` · `lint:filesize` · `lint:funcsize` · `lint:comment-claims` · `lint:migrations` ·
`lint:rls` · `lint:upserts` · `lint:tests` · `lint:secrets` — all green.

---

### U2 · The dashboard says something about §391

**Prerequisites:** U1 (the destinations should be reachable before they are advertised).

**Build.** A recruitment/qualification row on `DashboardPage` beside the existing trust strip, built
from queries that already exist — `useComplianceOverviewQuery` (the attention-strip counts),
`useInquiryQueueQuery` (`summary.overdue`), `usePipelineQuery` (applicants by stage). Tiles drill into
`/compliance`, `/recruitment/inquiries`, `/recruitment`.

⚠ **Gate it.** The dashboard is ungated so drivers keep it (`nav.ts`'s own comment). This row renders
only for `canViewSection(role, "recruitment")` **or** `canViewSection(role, "fleet")` — a driver must
not see the fleet's overdue investigations on their home page.

⚠ **Do not add a query.** If a count needs a round-trip the dashboard does not already make, the tile
does not ship in U2 — it waits for R9, which folds these sources properly. Three honest tiles beat
five that cost a request each.

**Verify.** `DashboardPage.test.ts` already exists — extend it: the row renders for a recruiter,
is absent for a driver, and every tile's `to` resolves to a routed path.

**Done when:** the compliance risk is visible from the page the owner opens first.

---

### U3 · `AppStatCard` — one tile, four call sites retired

**Prerequisites:** none; independent of U1/U2, but U2 should land on the finished component rather
than a fifth variant.

**Build.**
1. Promote `features/dashboard/StatCard.vue` → `components/ui/AppStatCard.vue` (contract §1.1b is
   where page-level composites live), keeping `DashboardPage`'s call sites working. ⚠ Its
   `chartTheme` import for `viz` must not drag the dashboard's chart layer into pages that show no
   chart — pass `sparkColor` in, as the props already allow, and let the import go.
2. Retire onto it: `RecruitmentPage` (4 stage tiles), `InquiryQueuePage` (3 summary figures),
   `ScreeningReadinessPage` (the `blockedBy` `<dl>`), `CompliancePage` (the 5-tile attention strip,
   which needs the `as="button"` + `aria-pressed` + active-ring behaviour as a supported variant
   rather than a class override).
3. Give `ScreeningReadinessPage` a `PageHeader` description.
4. Apply **D-UI5**: the attention tile's "filter"/"filtering" badge is removed; pressed state is the
   ring and `aria-pressed` it already carries.

**Verify.** A snapshot-free component test per variant (plain, linked, toggle) asserting the
contract's class strings for label/value/sub — so the anatomy is pinned by a test rather than by this
document. ⚠ `lint:comment-claims`: any comment claiming this coverage must quote the real test title.

**Done when:** one tile component renders every KPI in recruitment, qualification and the dashboard,
and contract §2.4 is asserted somewhere a gate can fail.

---

### U4 · `AppTabs` and `AppCallout`

**Prerequisites:** none.

**Build.** Two primitives in `packages/ui/src/components/`, exported from the barrel, with the
`tokens.css` roles they need already present (both patterns are built from existing roles today, so
no token is added):

- **`AppTabs`** — the extracted recipe: `flex gap-1 rounded-surface bg-surface-muted p-1 text-sm`,
  items `rounded-control px-3 py-1.5 font-medium transition`, selected `bg-surface text-ink`. Owns
  `role="tablist"`/`role="tab"`, `aria-selected`, `aria-controls`, and ⚠ **roving-tabindex arrow-key
  navigation**, which not one of the six hand-rolled instances implements — the accessibility of a
  tab list is the argument for the primitive, not the deduplication.
- **`AppCallout`** — `tone` (`brand|info|caution|warning|danger|success`), optional icon, `#actions`
  slot. Renders the `bg-<role>-50 ring-1 ring-<role>-100` recipe from one place.

Adopt in **this plan's surfaces only**: `CompliancePage` (its tab bar and its seed banner),
`DriverDetailPage` (its tab bar).

⚠ **Record, do not migrate.** The remaining four tab bars and ~27 callouts are listed in §2.4 above
and stay as they are. A fleet-wide sweep touches `AnomaliesPage`, `ImportPage`, `VehiclesPage` and
twenty more with no test between them; it is its own step, with its own PR, after these two
primitives have proven themselves on four call sites.

**Verify.** Unit tests for both, including `AppTabs` keyboard navigation (Left/Right/Home/End) and
that `AppCallout` emits no colour class not defined in `tokens.css`. `lint:ui-adoption` and
`lint:tokens-parity` green.

**Done when:** the two most-copied structures in the app have one home, and the surfaces this plan
owns use it.

---

### U5 · The area stops straddling two shells, and the icons stop colliding

**Prerequisites:** U3 (the tiles must already be shared, or this step re-lays out variants it is
about to delete).

**Build.**
1. `RecruitmentPage` moves onto `DataWorkspace` → `FilterBar embedded` → `DataTable embedded`,
   matching its two siblings and contract §5.2b. ⚠ This is R0b's *new-page* rule applied to an
   existing page **deliberately and narrowly**, because the area's internal split is the defect; it
   does not reopen R0b's "existing pages are left alone" decision for anywhere else.
2. **Fix the three stale docs that contradict the gate** (§2.5): contract §1.2, `KebabMenu.vue:9`
   and `DataTable.vue:23` all instruct a raw `<button class="kebab-item">`, which
   `lint:ui-adoption` fails. They should say `BaseButton class="kebab-item"`, which is what every
   call site and `apps/web/CLAUDE.md` already say. ⚠ No `.vue` file changes for this — the code was
   right and the prose was wrong.
3. **Icons (D-UI6):** give "Driver Qualification" a glyph that "Assignments" does not share; give
   "Applicants" a person rather than `Building02Icon`; resolve or remove the `// ⚠ verify` on
   `ClipboardDocumentListIcon` at `icons.ts:120`. ⚠ **Never import from
   `@hugeicons/core-free-icons` directly** — add to `packages/ui/src/icons.ts` first (contract §1.3),
   and keep `lint:tokens-parity` green.
4. ⚠ **No label changes.** "Applicants" stays until R9 renames it with the board (D-UI8).

**Verify.** A `nav.ts` unit test asserting **no glyph is bound to two items** — the defect becomes
un-reintroducible. Existing recruitment page tests stay green through the shell change.

**Done when:** the three recruitment pages read as one area, and no two sidebar items wear the same
glyph.

---

### U6 · "Employment" becomes work somebody actually does

**Prerequisites:** U3, U4 (it re-composes with the shared tile and the shared tabs).

**Build.** Split `DriverDetailPage`'s `employment` section (D-UI7). The recommended cut, by actor:

- **Application** — `ApplicationInviteCard` alone. The recruiter's act of asking.
- **Employment history** — `EmploymentHistorySection` + `EmployerInquirySection`. The §391.21(b)(10)
  record and the §391.23 investigation *of that record*; they are one job and were correctly placed
  adjacent.
- **Screening** — `PspRecordsSection`, which is a vendor ledger and not employment at all.

Update the page description, which currently says "Profile, qualification file and fueling history"
and names none of this.

⚠ **The `?section=` query is load-bearing** — `/compliance/:id` redirects into it
(`router/index.ts:223`), `notificationRoute.ts` deep-links to it, and `InquiryQueuePage` and
`RecruitmentPage` both push `?section=employment`. Every existing value must keep resolving; add
`parent`-style redirects for any renamed section and update all four call sites in the same commit.

⚠ **Check the budget before writing.** `DriverDetailPage.vue` is 242 lines against a 500-line budget
warning at 450; `QualificationFleetTable.vue` is already 408. If the split pushes the page over,
sections become components rather than the file growing — `lint:filesize` will say so, and
grandfathered files may only shrink.

**Verify.** A routing test that every historical `?section=` value still lands somewhere, including
the redirect from `/compliance/:id` and each `notificationRoute` target.

**Done when:** no tab holds four regulations, and every old link still works.

---

### U7 · The walkthrough — the night handoff's §7, now possible

**Prerequisites:** U1 at minimum. U2–U6 improve it; U1 makes it *possible*.

Not a build step. Walk a real invitation end to end in the **`FuelGuard EFS QA`** org
(`07fe4058-…`, null `dot_number`) — ⚠ never Silvicom — from "Invite an applicant" through consent,
the ceremony (or its read-only fallback while wording is draft), all seven screens on a **phone
viewport**, staged captures, submit, and the promoted documents landing in the qualification file.

⚠ Expect the SMS half to be inert: 10DLC registration opened 2026-08-21, `SMS_PROVIDER=none` until it
completes, and A11b's transport has never touched the wire.

⚠ The public apply surface has **two stacked rate limiters** (`app.ts`), budget = the intersection,
**20/min**. A brisk walkthrough with a reload loop can trip it; that is the limiter working.

**Done when:** what the plans assert and what the browser does have been compared by a person, and
every difference is either fixed or written down.

---

## 5. Sequencing, and what this costs

```
U1  front door            ← DONE 2026-08-21; unblocks U7
U2  dashboard row         ← after U1
U3  AppStatCard           ← independent; do before U2 lands if running in parallel
U4  AppTabs / AppCallout  ← independent
U5  shell + icons         ← after U3
U6  Employment split      ← after U3, U4
U7  the walkthrough       ← after U1; repeat after U6
```

**U1 alone closed the finding that matters (2026-08-21).** U2–U6 are the consistency pass; they are worth doing
and none of them is urgent in the way U1 is.

⚠ **Against R1.** `RECRUITING-SYSTEM-PLAN.md` §7 ranks **R1 (leads)** as the next step, and it is the
right next *feature*. This plan argues U1 precedes it on one ground only: R1's payoff is a lead
becoming an applicant, and the act of turning a lead into an applicant is exactly the act §2.1 shows
does not exist. R1 built on top of a missing front door builds a second surface that cannot reach the
first. **U1 is ~one PR; it should not delay R1 by more than that.**

---

## 6. Open questions — owner decisions, none blocking

1. **Does "Invite an applicant" create the driver row, or should applicants be their own entity?**
   Today `drivers` holds both (D-HIRE2: "Recruitment owns the applicant, DQF owns the driver"), and
   R1 introduces leads as a distinct thing. U1 takes the existing shape and does **not** decide this
   — if R1 later gives applicants their own table, U1's drawer changes its mutation and keeps its
   place. Recorded so U1 is not read as having settled it.
2. **Which dashboard tiles?** U2 proposes overdue §391.23 investigations, drivers with no
   qualification file, and applicants ready to screen. The owner may rank these differently; the
   component does not care.
3. **The word for "Applicants".** R9's, explicitly (D-UI8). Not asked here.
4. **`AppBadge`'s fate** (§2.5) — delete the dead export, or document it as admin-only? Neither
   affects this plan; it wants an owner.

---

## 7. What this plan deliberately does not do

- **No migration, no API change, no contract change.** If a step appears to need one, it is the wrong
  step — stop and say so in this document, per §4.
- **No fleet-wide sweep** of the 22 loose list pages, 4 remaining tab bars or ~27 remaining callouts.
  Recorded in §2.3 and §2.4, deliberately deferred.
- **No relitigating `ApplyPage`'s flow.** §2.8 records why its seven screens are the regulation's
  shape and not an excess.
- **No renaming of nav labels or `?section=` values beyond what U6's redirects cover.**
- **No new gate.** ⚠ Tempting — a structural linter would have caught most of §2 — but a gate written
  against four surfaces mid-refactor pins the wrong shape. Revisit after U6, when the shapes are
  settled, and note that U3's and U5's tests each pin one rule a script would otherwise have to guess.
