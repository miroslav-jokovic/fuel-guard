# Ads lead intake — build plan (LQ5–LQ9)

**Status:** planned 2026-11-09, from [`ADS-LEAD-INTAKE-AUDIT-2026-11-09.md`](ADS-LEAD-INTAKE-AUDIT-2026-11-09.md).
**Owner's instruction (2026-11-09):** "analyze and plan, and rule on the open questions with the best possible
solutions for us — precision, reliability, flawless work." The rulings on Q-AD62–Q-AD66 are therefore made here
(§1), each with its reason, and recorded in `ADS-AGENT-PLAN.md` §9. The owner may overrule any of them; a ruling
changed after a step is built is a new step, not an edit.
**Parent:** [`ADS-LEAD-QUALITY-PLAN.md`](ADS-LEAD-QUALITY-PLAN.md) (LQ1–LQ4); workflow rules per
[`ADS-AGENT-BUILD-WORKFLOW.md`](ADS-AGENT-BUILD-WORKFLOW.md) (mutation-proved tests, progress entry per PR,
`pnpm ci:local --job gates,typecheck` + touched suites, CI the authority).

Measured on main `1c26ac7` + open PRs (2026-11-09): last migration on main **0574**; #2137 holds **0575**, #2140 holds
**0576**. Numbers below are *provisional*; every migration PR re-reads the next free number by NAME at merge time
([[migration-number-race-with-parallel-chat]]).

---

## 1. Rulings (2026-11-09)

| Q | Ruling | Why this one |
|---|---|---|
| **Q-AD62** phone line-type lookup | **(a) every lead with a phone, all channels — once per number, cached.** | A lookup is a fraction of a cent against a recruiter's dial, and only the Meta-side figure tells us whether SMS verification is doing anything. "Once per number" because the same person re-submitting is matched by phone already (`recruiting_lead_matches`); a second lookup buys nothing. Flag, never filter: a landline is a real driver at home. |
| **Q-AD63** a lead whose own answer fails a hard requirement | **(a) no `lead_new` bell, no SLA alarm, own lane in the queue; still callable and convertible.** | The person told us, on a form whose intro (LQ1) stated the requirement. D-LS3 ("unknown is not a fail") is untouched: `unknown` still rings. Nothing is hidden or deleted — a recruiter who wants to call anyway can; the lane and the daily count make the volume visible. |
| **Q-AD64** close-out reasons; recruiter sets `qualified` | **(a) `qualified` is a recruiter's act after the call; close reasons are a fixed list, no free text in the reason.** | It is Joanna's own stage in Tenstreet today and the positive signal the outcome feed lacks between `contacted` and `converted`. A fixed list is what makes the per-campaign quality figure comparable across recruiters and weeks; a free-text reason cannot be counted. An optional note stays in the drawer. |
| **Q-AD65** send negative stages to Meta | **(a) send `not_qualified` and `lost_before_conversion` through the outcome feed; L4 records Meta's acceptance under EMPLOYMENT (Q-AD17 reading).** | Meta's Conversion Leads optimisation learns from the whole funnel. A feed with no negatives tells Meta every unconverted lead is still pending — the opposite of precision. If the L4 reading shows EMPLOYMENT refuses a stage, the feed skips it with a `skipped` row and the brief says so; nothing is built on the assumption that it works. |
| **Q-AD66** re-judge open leads when the profile changes | **(a) a sweep writes new verdict rows for open leads of every opening pinning the new version.** | Verdicts are append-only already (RL014) and the reader takes the newest per requirement; the sweep adds no new rule. Without it the queue shows "meets" against a profile the opening no longer uses. |

Related rulings that are the owner's and stay open — the plan **does not route around them**:
- **D-TS4 / D-TS5** (Tenstreet SSN and EEO in the export) and **D-TS8** (Tenstreet status shown, never obeyed) —
  `TENSTREET-INTAKE-PLAN.md` §3, in the owner's working tree. Recommendation unchanged: exclude SSN and EEO; D-TS8 as
  proposed (refresh contact details only when no recruiter edited them; status is a read-only line). LQ7 is built so
  that either answer fits (the Tenstreet reader never writes DOB or SSN into `answers`).
- **Q-AD52** texting consent on the form — counsel.
- **Q-AD17** Conversion Leads under EMPLOYMENT — an L4 reading, not a decision.

---

## 2. Design, the parts that cut across steps

### 2.1 One status machine for a lead

`recruiting_leads.status` today: `new → contacted` (first contact row, `leadContacts.ts:57`), `→ converted`
(`convert_lead`), `→ lost` (`purge_lead`). LQ5 completes it:

```
new ──contact──▶ contacted ──qualify──▶ qualified ──convert──▶ converted
 │                  │                      │
 │                  ├──close(not_qualified:*)──▶ not_qualified
 │                  └──close(other)────────────▶ lost
 └──close(*)──▶ not_qualified | lost          (a lead closed without a call: spam, duplicate, out_of_area)
reopen: not_qualified | lost ──▶ contacted     (a new closure row says "reopened"; never deletes the old one)
```

Rules, all in one RPC (`close_lead`, `qualify_lead`, `reopen_lead` — three functions, one migration):
- A `converted` lead cannot be closed or qualified (the applicant's dispositions own it: `applicant_dispositions`).
- A `purged_at` lead cannot be touched (RL, today's `lead_purged` refusal).
- Every move writes one **`recruiting_lead_closures`** row (append-only; `kind: closed | qualified | reopened`,
  `reason`, `note`, `actor`, `actor_name`, `at`) AND the status, in one transaction. The row is the fact; the status
  is the projection. Reopen = a `reopened` row + status `contacted`.
- `unreachable` is accepted only when the lead has ≥ `UNREACHABLE_MIN_ATTEMPTS` (3) outbound `recruiting_contacts`
  rows with outcome `no_answer|voicemail` — counted by the RPC, never typed by the person. Below that the RPC refuses
  in words ("2 of 3 attempts recorded — log the call first").
- `wrong_number` as a close reason also writes a `recruiting_contacts` row? **No** — a `wrong_number` contact row
  already exists in that case (the recruiter logged the call). The RPC requires one; refuses otherwise.

Reason list (shared `LEAD_CLOSE_REASONS`, mirrored in the CHECK, parity pinned by the matrix as 0554 does for phone):

| reason | status | needs |
|---|---|---|
| `not_qualified:age` · `:class_a` · `:class_a_experience` · `:hazmat` · `:dui` · `:preventable_accident` · `:clearinghouse` · `:drug_alcohol` · `:home_time` | `not_qualified` | — (the suffix is a `LEAD_REQUIREMENTS` key, LQ7 adds `home_time`) |
| `not_interested` | `lost` | a `reached` contact row |
| `unreachable` | `lost` | ≥ 3 `no_answer`/`voicemail` outbound rows |
| `wrong_number` | `lost` | a `wrong_number` contact row |
| `duplicate` | `lost` | the lead has a `recruiting_lead_matches` lead (the RPC checks) |
| `out_of_area` | `lost` | — |
| `spam` | `lost` | — |

A `not_qualified:<req>` close ALSO writes a `lead_match_verdicts` row for that requirement: `does_not_meet`,
evidence `verified` (a person established it on the call), detail `{ closure_id }`. That is how the recruiter's
verdict and the rules' verdict become one ledger, and why LQ3's "hard does-not-meet share" starts counting real cases.

### 2.2 `LeadFacts` is the one seam between a channel and the rules (LQ7)

```
answers (Meta)      ─▶ metaFacts()      ─┐
screeners (Indeed)  ─▶ indeedFacts()    ─┼─▶ LeadFacts ─▶ leadMatch(requirements, facts, asOf) ─▶ verdict rows
parsed post (TS)    ─▶ tenstreetFacts() ─┘
```

`packages/shared/src/recruiting/leads/facts/{meta,indeed,tenstreet}.ts`, each pure, each returning `LeadFacts`
with evidence per fact. `recordLeadVerdicts(admin, org, lead, opening, facts, asOf)` takes facts; the sink picks the
reader by `channel` (`factsFor(channel, projection)` in shared; unknown channel → `{}`). The Indeed and Tenstreet
readers are written against their specs NOW with fixtures from `docs/tenstreet/samples/` and the Indeed Apply
payload spec, so the listeners (TS2, Indeed) plug into a judged path on day one.

`LeadFacts` additions: `willing_days_out?: Fact<number>` (Indeed's "3 weeks out" = 21; Tenstreet custom question
when mapped), `dui?: Fact<{ cmv: boolean; years_ago: number | null }>`, `preventable_accident?: Fact<{ years_ago }>`,
`clearinghouse_prohibited?: Fact<boolean>`, `drug_alcohol_unresolved?: Fact<boolean>` (Tenstreet's MVR/criminal
yes/no questions give the first three at `self_reported`; DQF-sourced items at `document`). `leadMatch` judges each
disqualifier when its fact is present — today's `unknown(...)` branch stays for absent facts, so Meta behaviour is
unchanged (its reader never produces them).

`HiringRequirements` gains `home_time: { mode: off|preferred|required, min_days_out: int, reason }`, default
`off` (so `HIRING_PROFILE_V1` and every stored version still parse — the schema uses `.default(...)`; the stored
jsonb is not rewritten). The owner sets 21 on the carrier's profile from the Settings screen when they want the
Indeed screener judged; until then `home_time` is `off` and produces no verdict row.

### 2.3 Bells read the summary (LQ6)

`ringNewLead` and `sweepUncontactedLeads` call `readLeadVerdicts` for the lead(s) — one query — and skip
`hardUnmet > 0`. The uncontacted sweep already pages 100 at a time; the verdict read is batched per page. The skipped
count rides on the sweep result (`disqualified_by_answer`) and on `lead_new`'s job stats; the daily brief shows it.

### 2.4 Phone line type (LQ8)

Telnyx Number Lookup, `GET https://api.telnyx.com/v2/number_lookup/{phone}?type=carrier` with the existing
`TELNYX_API_KEY` (`lib/sms.ts` already holds the bearer pattern). Result → `phone_lookups` table keyed by
`(org_id, phone_e164)`: `line_type`, `carrier_name`, `looked_up_at`, `raw`. One row per number; `recruiting_leads`
gets no new column — the queue joins by phone. The lookup runs in the `lead_new` ring job AFTER the lead is stored,
never before, and a lookup failure never fails the ingest (logged, retried next sweep by a `phone_lookups` miss).
Quota: `TELNYX_LOOKUP_DAILY_MAX` (default 500/day/org) — above it, no lookup, a `lead_intake_failing` bell once.

---

## 3. Steps

Each step = one PR to merged. Track letters follow the workflow (S = screens/recruiting, W = workers/ads).

### LQ5 · Close-out (recruiting; closes F-LA1) — **first; before the first real Meta spend**

**LQ5a — migration (provisional 0577)** `recruiting_lead_closures` (+RLS, append-only in `RETENTION_FORBIDDEN`? — no:
closures go with the lead and are purged with it, like `lead_match_verdicts`; lifecycle block = "with lead"),
`close_lead(p_org, p_lead, p_reason, p_note, p_actor, p_actor_name)`, `qualify_lead(...)`, `reopen_lead(...)`; CHECK
on `reason` mirrors `LEAD_CLOSE_REASONS`; `0570`'s `ads_outcome_events.stage` CHECK widened to include
`not_qualified`, `lost_before_conversion`, `qualified` (Q-AD65, Q-AD64). SQLSTATEs RL040–RL046 (lead converted,
purged, reason needs a contact row, unreachable below N, duplicate without match, already closed, not closed on
reopen). PGlite matrix `recruiting-lead-closures.test.mjs`: every reason × every status, the refusals, the parity of
`LEAD_CLOSE_REASONS` with the CHECK, the verdict row on `not_qualified:*`.

**LQ5b — API + shared + feed.** Shared `leadClosureContract.ts` (`LEAD_CLOSE_REASONS`, schemas, `LeadClosureRecord`);
`recruiting/leads/leadClosures.ts` (RPC callers, refusals in words, audit `recruitment.lead_closed|qualified|reopened`
by id and reason, never the note); routes `POST /leads/:id/close`, `/qualify`, `/reopen`, `GET /leads/:id/closures`
(manage/manage/manage/view); `LEAD_OUTCOME_STAGES` gains `qualified`, `not_qualified`, `lost_before_conversion` and
`UNRECORDED_LEAD_STAGES` becomes `[]` (type stays for the brief's `not_recorded` marker, now unused — delete the
marker only after the Analyst eval re-passes twice); `recruiting/leads/leadOutcomes.ts` reads closures for the
three stages; outcome feed sends them (B6's event_id `<lead>:<stage>`); `LeadQuality` (LQ3b) counts closures by reason
per campaign. Security ledger lines for the new routes (Q-AD38 (a)). Tests: route tests with `expectOrgScoped`, feed
sweep gains the three stages, mutation on each refusal.

**LQ5c — web.** Lead drawer: "Qualify" and "Close" (reason picker from `LEAD_CLOSE_REASONS` with office words from
one label map, note optional; `unreachable` disabled with "2 of 3 attempts recorded" until the RPC would accept it —
derived from the contacts list already in the drawer, same rule as the RPC, pinned by a test that the two agree),
"Reopen" on a closed lead, closures shown in the activity list. Queue: status filter gains `Closed` (not_qualified +
lost) and `Qualified`; default unchanged (open). Badge tones from `badges.recruiting.ts`. Browser pass on staging
with the three fixtures.

**Done when:** a recruiter closes a lead with `not_qualified:class_a` on staging → status `not_qualified`, closure
row, verdict row `verified`, outcome event `not_qualified` queued, lead gone from the default queue, visible under
Closed, reopenable; `pnpm ads:readiness` Lead intake and Outcome feed pins updated.

### LQ6 · Bells and SLA read the verdicts (recruiting; closes F-LA2, F-LA6) — can ride with LQ3b

No migration. `leadNotify.ts` `ringNewLead(…, summary)` skips `hardUnmet > 0`; `leadUncontacted.ts` excludes them
(count `disqualified_by_answer`); queue RPC unchanged — the lane is the web's: a third default group "Does not qualify
by their answer" below the list, collapsed, from `summary.hardUnmet > 0` (data already on the row). Backfill and
webhook fetch count `no_contact_detail` (lead stored with neither phone nor e-mail) and ring `lead_intake_failing`
once a day when > 0. Daily brief fact sheet gains both counts. Tests: ring skipped for a `does_not_meet` lead and NOT
skipped for `unknown` (D-LS3 pinned), sweep excludes, brief rows present; mutations on each.

### LQ7 · Facts per channel + `home_time` (shared + recruiting; closes F-LA4) — **before Indeed/Tenstreet listeners**

No migration (profile contract change is additive with a default; stored versions still parse — pinned by a test
that parses `HIRING_PROFILE_V1` and a fixture of the staging profile as stored today). `facts/meta.ts` (today's
function), `facts/indeed.ts` (screener ids → facts; "3 weeks" → `willing_days_out: 21`; OTR years → `class_a_years`
range ONLY when the Indeed screener is "years of Class A" — "OTR years" is NOT Class A years and is kept as
`unmapped`, see Q-AD67 below), `facts/tenstreet.ts` (from the parsed post the TS2 listener will produce; DOB → age
verdict only; DQF licence → `class_a_held` at `document`; MVR yes/no → disqualifier facts at `self_reported`).
`leadMatch` judges `home_time` and present disqualifier facts. `recordLeadVerdicts` takes facts; `ingestLead` calls
`factsFor(channel, projection)`. Settings › Hiring profile screen gets the `home_time` row. Fixtures: the three
Tenstreet sample XMLs in `docs/tenstreet/samples/` (projected by a parser stub until TS2 — the reader's input type is
the TS2 plan's projection shape, defined here in shared so TS2 implements it). Tests: every reader × every fact ×
absent/unknown/present; `leadMatch` table test for `home_time` and disqualifiers; Meta behaviour byte-identical
(golden over today's `leadMatch.test.ts` cases).

**Q-AD67 (opened here, us):** Indeed's screener "years of OTR experience" is not "years of Class A". (a) Change the
Indeed screener to "years of Class A CDL experience" when the Job Sync posting is built from our catalogue (one
catalogue, two renderers — the onboarding reply's own recommendation). (b) Map OTR years onto `class_a_years`. **Rec
(a)**; (b) would make the rules judge a fact the person was not asked.

### LQ8 · Phone line type (recruiting; closes F-LA3; Q-AD62 (a))

**LQ8a — migration (provisional 0578)** `phone_lookups` (+RLS; lifecycle: prunable, 400 days; one row per
`(org_id, phone_e164)`). **LQ8b — reader.** `recruiting/leads/phoneLookup.ts` (Telnyx call, `TELNYX_API_KEY` from
`envMail`, redacted logs via `redactNumber`, result → row; a miss is retried by the uncontacted sweep; daily quota);
called from the `lead_new` ring job after the store, and from the manual-lead door. Queue row gains `phone_line_type`
(joined), badge "Landline"/"VoIP" with neutral tone; `LeadQuality` reports wrong-number share BY line type. Env:
`TELNYX_LOOKUP_DAILY_MAX`. Tests on a FakeTelnyx `node:http` server (the harness pattern): success, 404 (unknown
number → `unknown`), 429, timeout → lead still stored and rung; quota refusal → one bell.

### LQ9 · Re-judge on profile/opening save (recruiting; closes F-LA5; Q-AD66 (a))

No migration. Job `lead_rejudge` (dedup `lead_rejudge:<org>:<opening>`), enqueued by `save_opening_version` and
`save_hiring_profile_version` callers (API side, after the RPC), over the opening's leads in `OPEN_LEAD_STATUSES`,
paged; facts via `factsFor`; `recordLeadVerdicts` for the new version (its "write once per (lead, version)" already
makes a retry a no-op). `jobKindCatalogue.ts` entry. Tests: a version save re-judges; a second run writes nothing;
closed leads untouched.

### Monitor: `lead_burst` (ads, W; closes F-LA7) — small, any time after LQ3a

`monitorChecks.ts` rule: leads in the last account-local hour > max(5, 6 × 7-day hourly median) → `ads_lead_quality`
alert, never a pause. Pure fn + table test + one mutation.

### Publisher L4 reading (closes F-LA8) — at the sandbox run

Read the created ad set's `targeting` back; record `no targeting_automation / targeting_optimization /
flexible_spec`; then `verify` refuses an ad set whose read-back shows any. Code only after the reading.

---

## 4. Order and calendar

| Step | Days | Blocks |
|---|---|---|
| LQ5a → LQ5b → LQ5c | 1.5 | first real Meta spend; Indeed Disposition Sync |
| LQ6 | 0.5 | — (with LQ3b) |
| LQ7 | 2 | Indeed Apply listener; Tenstreet TS2 |
| LQ8a → LQ8b | 1 | Indeed/Tenstreet go-live |
| LQ9 | 0.5 | — |
| `lead_burst`, L4 reading | 0.25 + at sandbox | — |

Two chats in parallel (S: LQ5 → LQ6 → LQ8 → LQ9; W: LQ7 → `lead_burst`) finish in ~3 working days. Indeed and
Tenstreet listeners start after LQ7 merges.

---

## 5. Open questions

- **Q-AD67** · Indeed "OTR years" vs "Class A years" (us) — §3 LQ7, rec (a).
- **D-TS4 / D-TS5 / D-TS8** · owner, unchanged (§1).
- **Q-AD17** · L4 reading, with Q-AD65's acceptance of negative stages under EMPLOYMENT.
