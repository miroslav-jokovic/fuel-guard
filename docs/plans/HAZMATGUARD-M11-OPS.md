# HazmatGuard — Operational Readiness (M11 / §13)

**Status:** code slices BUILT + typechecked; infra actions PENDING (owner). **Blocks the first paying
customer, not the first line of code.**

M11's DoD is `PITR enabled · storage backed up to a second provider on a schedule · one restore drill with a
written result · Sentry PII scrubbing tested · orphan reconcile scheduled · RPO/RTO published.` This file
records the published numbers, the runbook, and the split between what the code does and what a human must do.

## RPO / RTO (published, not aspirations)

- **RPO — 1 hour.** Database: Supabase **PITR** (continuous). Storage: the off-provider backup runs at least
  hourly (or the bucket is versioned), so at most ~1 h of new BOL images is at risk.
- **RTO — 4 hours.** Restore the database from PITR into a scratch project, restore the storage objects from
  the second provider, re-point env, verify a known load's verdict reproduces, cut over.

## Backups (§13.1, D13)

- **Database — PITR.** *(owner infra)* Enable the Supabase PITR add-on (7/14/28-day). PITR **replaces** daily
  backups. PITR maxes at 28 days — that is loss protection, **not** the §172.201(e) 2–3 y / §391.51(c)
  employment+3 y retention, which the live store serves.
- **Storage — second provider.** *(code + owner infra)* `services/storageBackup.ts` copies every
  evidence-bearing bucket (`hazmat`, `load-photos`) to a `BackupTarget` you implement with your second
  provider (S3 / R2 / B2 / GCS). The code is provider-agnostic and dependency-free; **you** supply the
  credentials, implement `BackupTarget.put`, and schedule `backupHazmatEvidence` (hourly for the 1 h RPO).
- **Regulatory dataset.** `@hazmat/data` is in git + versioned (strongest copy). Also archive each release
  PDF + checksum off-provider.

## Restore drill (§13.1) — runbook

**Cadence:** quarterly, into a scratch Supabase project, with a written result appended below. *An untested
backup is a belief.* **Owner:** _(name the runner)_.

1. Create a scratch Supabase project.
2. Restore the database from PITR to a chosen timestamp.
3. Restore the storage objects from the second provider into the scratch project's buckets.
4. Point a local API at the scratch project; run `GET /api/hazmat/loads/:id/runs/:runId/reproduce` on a known
   historical load — the verdict must reproduce byte-identically (M12.2).
5. Spot-check that `hazmat_documents` rows resolve to real objects (no "missing object" flags from the
   reconcile — §13.5).
6. Record: date, runner, timestamp restored to, RTO achieved, any gaps, sign-off. **A drill with no written
   result does not count.**

### Drill log

| Date | Runner | Restored to | RTO achieved | Result / gaps |
|---|---|---|---|---|
| _(pending first drill)_ | | | | |

## Sentry PII scrubbing (§13.4) — DONE (code)

`lib/sentryScrub.ts` + `instrument.ts` `beforeSend`: strips CDL / DOB / home address / medical-registry
numbers (key- and value-based), drops request bodies + cookies, keeps only `user.id`, and removes base64
image bytes — **no BOL pixels ever leave**. Release is tagged `engine+dataset+art` versions so an error is
traceable to the exact regulatory inputs. Unit-tested (`sentryScrub.test.ts`, incl. a CDL-number payload).

## Orphan reconcile (§13.5) — DONE (code) · schedule owner-set

`services/storageReconcile.ts` + `hazmatStorageReconcileScheduler.ts` (registered in `schedulers.ts`, daily):
deletes objects with no `hazmat_documents` row past a 24 h grace, and **flags** rows whose object is missing
(never deletes a row — that is evidence; it is also the D13 restore signal). Pure planner unit-tested.

## Owner action checklist (the human steps M11 needs)

- [ ] Enable Supabase **PITR** (Pro add-on).
- [ ] Stand up the **second storage provider** (bucket + credentials); implement `BackupTarget`; schedule
      `backupHazmatEvidence` hourly.
- [ ] Confirm `RUN_SCHEDULERS_IN_PROCESS` runs the reconcile in **exactly one** process.
- [ ] Run the **first restore drill**; record the result in the drill log above.
- [ ] Archive each `@hazmat/data` release PDF + checksum off-provider.
