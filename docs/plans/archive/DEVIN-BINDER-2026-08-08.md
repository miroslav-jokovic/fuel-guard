# Devin — ship the audit binder

Everything before this is on `main` (`2e68480`, `applied 0148`). The working tree holds one feature,
built but never installed, committed or applied: a DOT auditor names a sample of drivers and one
action produces their §391.51 qualification files as a single PDF, ready to print or attach.

Four commits, then the migration, then the deploy check. Plan:
`docs/plans/safety-dqf/DQ-BINDER-PLAN.md` (untracked — it goes in commit 1).

```bash
cd ~/Projects/FuelGuard
git switch main && git pull --ff-only
git status --short
```

If a stale `.git/index.lock` blocks you, delete it. One keeps reappearing from a concurrent git
process and Cowork can only move files, not unlink them — look in `_to_delete/`.

---

## Step 0 — clean the tree, install, verify

`_to_delete/` is scratch Cowork could not remove (a `.tmp-tsc` build dir and the one-shot patch
scripts that produced these edits). Nothing in it is wanted:

```bash
rm -rf _to_delete
```

**`pdf-lib` has now been installed** (Miki ran it mid-session) and `pnpm-lock.yaml` carries a clean
nine-line addition — pdf-lib plus `@pdf-lib/standard-fonts` and `@pdf-lib/upng`, nothing else. The
lockfile change belongs to commit 2. Re-run the install anyway so your tree matches:

```bash
pnpm install
git diff --stat pnpm-lock.yaml        # expect 9 insertions, 0 deletions
```

Why the dependency exists, since it is the one thing here that is not obvious: **pdfkit cannot merge
an existing PDF.** It draws pages; it cannot copy them in. `defensePacket.ts` gets away without it
because hazmat evidence is photographs, which `sharp` rasterises and pdfkit draws. A qualification
file does not have that shape — a medical examiner's certificate, an MVR printout and a Clearinghouse
query all arrive as PDFs, and `sharp` cannot read a PDF either. pdfkit still draws every page we
author; pdf-lib only copies the scans in and stamps the footers.

Then the full gate. Run it all before you commit anything:

```bash
pnpm typecheck
pnpm test                    # includes test:rls — all four behavioural matrices
pnpm lint
pnpm lint:filesize
pnpm lint:funcsize
pnpm lint:migrations
pnpm lint:boundaries
pnpm lint:tokens-parity
pnpm --filter @fuelguard/web lint:tokens
pnpm format:check
```

Expected, all verified already except the two that need `node_modules`:

- `rls.test.mjs` → **204 passed, 0 failed** (18 of them new, added by this work)
- `hazmat_rls` 16, `load-lifecycle` 61, `duty-sessions` 25 — unchanged
- every `lint:*` clean; `vue-tsc` on `apps/web` clean
- `apps/api` typecheck is now **verified clean** with pdf-lib installed
- `apps/api/src/services/dqBinder/footer.test.ts` is new and has still never run under vitest —
  vitest cannot execute in Cowork's Linux VM (rolldown ships a macOS-native binary). The arithmetic
  it covers was verified independently with plain node, so this is a formality, but it is the one
  check nobody has run

**If `format:check` complains, only reformat the paths this feature touches** — `pnpm exec prettier
--write` on the specific files, never `pnpm format` across the repo. A repo-wide reformat inside a
feature commit is unreviewable.

**If anything else fails, stop and report rather than editing to get past it.** In particular do not
"fix" a matrix assertion: the new block asserts things that must not be true (no client can read the
exports bucket, nobody can rewrite the ledger), so a failure there is a real policy defect.

---

## Commit 1 — the schema and the vocabulary

```bash
git add supabase/migrations/0152_dq_exports.sql \
        supabase/tests/rls.test.mjs \
        packages/shared/src/dqExportContract.ts \
        packages/shared/src/dqCatalogue.ts \
        packages/shared/src/org.ts \
        packages/shared/src/index.ts \
        apps/api/src/services/dataRetention.ts \
        docs/plans/safety-dqf/DQ-BINDER-PLAN.md \
        docs/plans/DEVIN-BINDER-2026-08-08.md

git commit -m "Add the export ledger and pin compliance records un-prunable

0152 creates dq_exports — who exported which drivers' qualification files,
as at what date, and what came out — plus the compliance-exports bucket the
finished binders land in.

The bucket has NO client policy of any kind, not even insert. compliance-docs
grants insert to the safety roles because a manager uploads a scan from the
browser; nothing about an export is client-authored. The worker writes it and
the API hands out a short signed URL, so RLS denying by default is the rule
rather than an oversight. A finished binder is a PII aggregate: fifteen
drivers' licences, medical certificates and addresses in one file that exists
only to be sent. It is swept after seven days.

The ledger row is not swept. The sweep clears storage_path and stamps
purged_at, because a record of who pulled a medical card out of the system
costs one row and is exactly what you want six months later. dq_exports has
no update and no delete policy for the same reason.

driver_ids is an unreferential uuid[] on purpose. This records a historical
fact — on this date, this person exported these drivers' files — and a
foreign key would make that fact mutable by somebody else's delete: cascade
erases the evidence, set null corrupts it. job_id is a plain uuid for a
sharper version of the same problem: jobs is pruned at 90 days by
RETENTION_RULES, so a real reference would either block that delete or
quietly blank the column.

certifications, qualification_records, documents and dq_exports join
RETENTION_FORBIDDEN. §391.51 measures retention in years and §390.32(d)
requires an electronic record to still be reproducible when asked for;
until now nothing stopped someone adding these to a retention rule in six
months and quietly pruning a driver's history.

organizations gains dot_number. The binder's cover has to identify the
carrier the way the auditor's own paperwork does, and the product has never
stored a USDOT number.

The RLS matrix grows 18 assertions, because every security property here is
an ABSENCE — a missing storage policy, a missing update policy — and an
absence is precisely what reading a migration cannot confirm. 204 passed."
```

---

## Commit 2 — assembly, job and API

```bash
git add apps/api/package.json pnpm-lock.yaml \
        apps/api/src/services/dqBinder \
        apps/api/src/services/dqExports.ts \
        apps/api/src/services/dqExportSweeper.ts \
        apps/api/src/services/queue/handlers/dqBinder.ts \
        apps/api/src/services/queue/handlers/index.ts \
        apps/api/src/services/jobs.ts \
        apps/api/src/worker.ts \
        apps/api/src/schedulers.ts \
        apps/api/src/routes/compliance.ts

git commit -m "Assemble driver qualification files into one auditor's binder

Adds pdf-lib. pdfkit cannot merge an existing PDF — it draws pages, it
cannot copy them in — and a qualification file is largely PDFs: the medical
certificate, the MVR, the Clearinghouse query. sharp cannot read a PDF
either, so with what was installed the binder was not assemblable at all.
pdfkit keeps every page we author, because its text layout is far better;
pdf-lib copies the scans in.

One combined PDF for the whole sample, not one file per driver. It prints in
one action and attaches to one email; fifteen files would be fifteen print
jobs, and a zip cannot be printed at all. Drivers appear in the order the
auditor named them so the binder can be checked against their own list.

Gaps are printed, never omitted. The cover states the completeness of each
file and the checklist names every expired or never-recorded requirement. A
scan that cannot be read — a deleted object, an encrypted PDF, an image
format sharp cannot decode — becomes a page saying so, with the document id
and its SHA-256. A binder that quietly drops what it lacks is worse than
useless: the auditor finds the gap anyway and then distrusts the rest.

Drug and alcohol tests are named, not detailed. §40.333 keeps the DOT testing
file separate and confidential from the qualification file, so the binder
records that a test occurred and when, and carries no result.

Footers are stamped after the merge, when 'page 7 of 214' is finally knowable
and the copied scans can be stamped identically — Bates numbering, which is
what §390.32(c)-(d) needs for a page that comes loose. The placement is
rotation-aware: a scanned page frequently carries /Rotate 90, and stamping at
its own bottom-left would run the export id up the side of the printed sheet.
That arithmetic is the one piece here that fails silently rather than loudly,
so it lives in its own module with a test that re-derives the viewer
transform independently rather than restating the four cases.

Text is folded to WinAnsi. Both pdfkit's built-in Helvetica and pdf-lib's
StandardFonts throw on a name like Nikolic-with-an-acute rather than degrade,
which would fail an entire binder over one driver's surname. Diacritics are
dropped — the form every DOT document a US carrier files already uses — in a
helper every drawing path goes through.

It runs as a job: fifteen drivers is roughly 270 documents pulled from
storage, which a synchronous request would spend timing out on Railway.
Deduped per export, so two auditors' samples run concurrently but a
double-submit does not, and capped at two in flight on the worker because
each holds its sample's scans in memory.

The single-document release is synchronous and stores nothing. It is the
outward case — a broker asking for a CDL before releasing a load. Internal
sharing is access, not attachment: dispatch can already open the file. What
makes it safe to send is the stamp: driver, requirement, validity, who
released it and when.

Every export is audited, and so is every download."
```

---

## Commit 3 — the screens

```bash
git add apps/web/src/composables/useDqExports.ts \
        apps/web/src/composables/useCompliance.ts \
        apps/web/src/composables/useOrgSettings.ts \
        apps/web/src/features/compliance/ExportHistory.vue \
        apps/web/src/features/compliance/CertificationHistory.vue \
        apps/web/src/pages/CompliancePage.vue \
        apps/web/src/pages/DriverQualificationPage.vue \
        apps/web/src/pages/OrgSettingsPage.vue

git commit -m "Build a binder from the qualification page, and show history

Tick drivers on the All drivers tab and one button builds their binder; it
lands under a new Exports tab, which is the ledger of what has left the
building. Selection uses DataTable's own selectable/selected props and the
bulk bar is the same brand-50 strip TrailersPage and DispatchLoadsPage use —
no new pattern, no new page.

A per-requirement 'Release stamped copy…' in the kebab covers the one-document
case, and the driver file gains an 'Export this file' action.

The supersede chain finally has a screen. includeHistory has been supported by
the API since 0127 and nothing has ever requested it, so 'what did his medical
card say on 3 March' was answerable by the database and by nobody using the
product. Collapsed by default and absent entirely when there is no history, so
a clean file stays a short page. Nothing new is stored; something already
stored becomes visible.

Org settings gains the USDOT number, since the binder cover prints it. Blank
is stored as null so the cover reads 'not recorded' rather than printing an
empty line.

vue-tsc clean, design tokens clean, boundaries clean."
```

---

## Commit 4 — reconcile the plan documents with the tree

```bash
git add docs/plans/safety-dqf/DQF-PLAN.md \
        docs/plans/safety-dqf/DQ-REDESIGN-PLAN.md \
        docs/plans/dispatch-loads/LOADS-PLAN.md \
        docs/HANDOFF-2026-08-08.md

git commit -m "Reconcile the safety and loads plans with what is actually built

Four documents had drifted. DQF-PLAN's DQ3 listed four capture gaps of which
three are closed — the qualification-record UI, the history view, and the
carrier's own certifications — leaving CertManager's missing §172.704(d)
fields and equipment certifications genuinely open. DQ4 is now split honestly:
the export and the forbidden list shipped, per-class retention and the
purgeable report did not, and those two are one piece of work because the
report is the only consumer the retention model would have.

DQ-REDESIGN-PLAN's only open item was the binder, which shipped.

LOADS-PLAN's L5 heading said the history tab was outstanding while its own
§5.4 described the tab as built, in detail. The heading was wrong."
```

---

## Step 4 — push

```bash
git log --oneline -5
git push origin main
```

Railway deploys `main`. Watch the API service build to green before step 5 — the migration adds a
table the new code reads, and applying it against an old deploy is harmless, but the reverse (new
code, no table) is a 500 on the Exports tab.

---

## Step 5 — apply migration 0152

Ground truth **first**, and paste both listings into your report:

```bash
supabase migration list --linked
curl -s https://<api-host>/api/version | jq '{sha, schema}'
```

Then apply the same way as last time:

**GitHub → Actions → "Apply Supabase migrations" → Run workflow → branch `main`.**

If the workflow is unavailable or errors on a missing secret, add the secret and re-run — do not
apply by hand instead. `supabase db push` is the fallback only if the workflow itself is broken, and
say so in your report if you use it.

0152 is additive and reversible in shape: one new table, one new bucket, one nullable column on
`organizations`. It creates no function and replaces none. It should not be able to fail, so if it
does, **stop and report — do not edit it to get past.**

```bash
supabase migration list --linked        # 0152 recorded
curl -s https://<api-host>/api/version | jq '{sha, schema}'   # applied: 0152
```

---

## Step 6 — confirm it actually works

```bash
pnpm verify:live
```

Then, signed in as an admin or safety manager on the deployed app:

1. **Settings → Organization** — enter the USDOT number and save. Reload; it persists.
2. **Driver Qualification → All drivers** — tick two drivers, press **Build audit binder**. It
   should switch to the **Exports** tab showing a row at `assembling`, which becomes `ready` within
   a minute or two without a manual refresh (the list polls while anything is in flight).
3. **Download** it. Check the master cover lists both drivers in the order you ticked them, each
   driver's checklist names every requirement including the missing ones, each scan sits behind a
   separator page, and **every page carries the driver name, the export id and "page X of Y"** —
   including the scanned pages, and the right way up on any page that was scanned sideways.
4. On a driver's file, open the kebab on a requirement that has a scan and choose **Release stamped
   copy…**. A single stamped PDF downloads. It appears in the Exports list as a row with no download
   button — nothing was stored, which is deliberate.
5. On a requirement with **no** scan, the kebab entry is absent. Confirm.

Report what you saw at each step, and attach the binder PDF from step 3.

---

## Two things to leave alone

**Do not commit the keystore, `UPLOAD_TOKEN`, `EOO_TOKEN` or `DB_KEYS_MASTER_KEY_B64`.** The only
credential that belongs in git is `apps/driver/certs/certificate.pem`, which is public by design.

**Do not add anything to `RETENTION_RULES`.** This work pins four tables in `RETENTION_FORBIDDEN`
and a guard test enforces the separation.
