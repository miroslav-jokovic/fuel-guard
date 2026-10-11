/**
 * One carrier's FMCSA feed run: all six datasets, each fetched whole and recorded as a snapshot
 * (INSPECTION-CHALLENGE-PLAN IC1, D-IC2; tables 0457).
 *
 * ── ORDER ─────────────────────────────────────────────────────────────────────────────────────
 * The inspection file first, because three of the other five are asked for by its inspection ids
 * (`FMCSA_DATASET_SPECS[…].scope`). When it fails, those three are recorded as failed runs that say
 * so, not skipped silently: a dataset whose last run is missing looks fresh to nobody, but a run that
 * failed for a stated reason is what the freshness check (IC1b) reads. The two SMS files are scoped
 * by USDOT number and run regardless.
 *
 * ── A DATASET IS ALL OR NOTHING ───────────────────────────────────────────────────────────────
 * A child dataset takes ~7 `in (…)` requests. If any one fails, the dataset's run fails and nothing
 * is recorded for it: half a snapshot marked complete would vanish every row in the missing half.
 * One dataset's failure never stops the others.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { FMCSA_DATASET_SPECS, FMCSA_DATASETS, fmcsaNaturalKeys, type FmcsaDataset } from "@silvicom/shared";
import { ID_CHUNK, scopeWhere, type SocrataClient } from "./socrata.js";
import { recordFailedRun, recordSnapshot, type SnapshotCounts } from "./store.js";

export type DatasetOutcome =
  | ({ dataset: FmcsaDataset; outcome: "succeeded" } & SnapshotCounts)
  | { dataset: FmcsaDataset; outcome: "failed"; error: string };

const INSPECTIONS: FmcsaDataset = "fx4q-ay7w";

export async function syncFmcsaFeed(
  admin: SupabaseClient,
  orgId: string,
  dotNumber: string,
  client: SocrataClient,
  clock: () => Date = () => new Date(),
): Promise<DatasetOutcome[]> {
  const results: DatasetOutcome[] = [];
  let inspectionIds: string[] | null = null;

  for (const dataset of FMCSA_DATASETS) {
    const spec = FMCSA_DATASET_SPECS[dataset];
    const startedAt = clock();
    const requestsBefore = client.requestCount;
    let sourceRowsUpdatedAt: Date | null = null;
    const run = () => ({
      startedAt,
      sourceRowsUpdatedAt,
      requestCount: client.requestCount - requestsBefore,
      durationMs: Math.max(0, clock().getTime() - startedAt.getTime()),
    });
    try {
      if (spec.scope.by === "inspection_id" && inspectionIds === null) {
        throw new Error(`not fetched: it is asked for by inspection id, and the ${INSPECTIONS} run failed`);
      }
      sourceRowsUpdatedAt = await client.rowsUpdatedAt(dataset);
      const rows = await fetchScoped(client, dataset, dotNumber, inspectionIds ?? []);
      if (dataset === INSPECTIONS) inspectionIds = rows.map((r) => String(r.inspection_id ?? ""));
      const keys = fmcsaNaturalKeys(dataset, rows);
      const counts = await recordSnapshot(
        admin,
        orgId,
        dataset,
        dotNumber,
        rows.map((p, i) => ({ k: keys[i]!, p })),
        { ...run(), complete: true },
      );
      results.push({ dataset, outcome: "succeeded", ...counts });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ dataset, outcome: "failed", error });
      try {
        await recordFailedRun(admin, orgId, dataset, dotNumber, run(), error);
      } catch (inner) {
        console.error(`[fmcsa-feed] org ${orgId} ${dataset}: could not record the failure —`, inner);
      }
    }
  }
  return results;
}

async function fetchScoped(
  client: SocrataClient,
  dataset: FmcsaDataset,
  dotNumber: string,
  inspectionIds: readonly string[],
): Promise<Record<string, unknown>[]> {
  const { scope } = FMCSA_DATASET_SPECS[dataset];
  if (scope.by === "dot_number") return client.rows(dataset, scopeWhere(scope, dotNumber));
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < inspectionIds.length; i += ID_CHUNK) {
    out.push(...(await client.rows(dataset, scopeWhere(scope, inspectionIds.slice(i, i + ID_CHUNK)))));
  }
  return out;
}
