import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Env } from "../env.js";
import { writeAudit } from "../lib/audit.js";
import { getCardV2 } from "../lib/efsCardOps.js";
import { editsLanded } from "../lib/efsCardWrite.js";
import type { CardEdit } from "../lib/efsCardEcho.js";
import { reconcilePlanFor } from "../efs/registry.js";
import { loadCardNumber } from "./efsCardMirror.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";

/**
 * The background half of "what actually happened": settle the ledger rows nobody could settle live
 * (audit P1-3 / plan 2.3).
 *
 * Two shapes of unresolved row, two resolutions:
 *
 *   `sent`    — the write went out and the verifying re-read failed; the outcome is UNKNOWN and the
 *               row says so ("Unverified" in the drawer). But the answer usually arrives within a
 *               day: the card's real state is one read away. This pass makes that read (backfill
 *               lane — nobody is waiting) and settles the row: `succeeded` when the stored edits
 *               demonstrably landed, `failed/no_change` when a full sync cycle has passed and they
 *               demonstrably did not. Rows younger than a cycle that haven't landed are left alone —
 *               "not yet" is not "no".
 *
 *   `pending` — the process died between opening the row and recording an outcome. Since 0179 the
 *               unique index makes such a row BLOCK every new mutation on its card, so abandoning
 *               it is not bookkeeping, it is what un-sticks the card. Anything pending beyond the
 *               live path's own window is settled `failed/abandoned` — the write may or may not
 *               have been dispatched, which the message says honestly; the next sweep or mutation
 *               re-reads the card either way.
 *
 * Runs inside the card-sync job (queue/handlers/efsCardSync.ts), after the mirror sweep, bounded by
 * `maxVendorReads` so a backlog cannot turn the sweep into a vendor hammer. Every settlement is
 * audited — a row changing state with no human in the loop is exactly what audit logs are for.
 */

/** The live path's in-flight window, mirrored here rather than imported to keep this module free of
 *  efsCardControl's route-facing dependencies. Same inputs, same arithmetic, one comment each side. */
function liveWindowMs(env: Env): number {
  const perCall = env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS ?? 10_000;
  const secondLook = env.EFS_CARD_VERIFY_RETRY_MS ?? 3_000;
  return 4 * perCall + secondLook + 15_000;
}

/** Parse the ledger's `edits` jsonb. Rows are written by planCardMutation from typed CardEdit[],
 *  but the reconciler must not TRUST a column it did not write moments ago — parse, don't cast. */
const cardEditSchema: z.ZodType<CardEdit> = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setField"), name: z.string(), value: z.string() }),
  z.object({ op: z.literal("setFieldNil"), name: z.string() }),
  z.object({ op: z.literal("removeAll"), name: z.enum(["infos", "limits", "locationGroups", "locations", "timeRestrictions"]) }),
  z.object({
    op: z.literal("replaceAll"),
    name: z.enum(["infos", "limits", "locationGroups", "locations", "timeRestrictions"]),
    records: z.array(z.record(z.string(), z.string().nullable())),
  }),
  z.object({
    op: z.literal("appendRecord"),
    name: z.enum(["infos", "limits", "locationGroups", "locations", "timeRestrictions"]),
    record: z.record(z.string(), z.string().nullable()),
  }),
]) as z.ZodType<CardEdit>;

const unresolvedRowSchema = z.object({
  id: z.string(),
  efs_card_id: z.string(),
  status: z.enum(["pending", "sent"]),
  created_at: z.string(),
  edits: z.array(cardEditSchema).nullable(),
  /** Null on every row written before the registry drove the route. Those keep the old behaviour. */
  capability_key: z.string().nullable(),
  /** Redacted, as submitted. Handed to the capability's own predicate, which must parse it. */
  request_body: z.unknown().nullable(),
});

export interface UnresolvedResult {
  checked: number;
  reconciledSucceeded: number;
  reconciledFailed: number;
  abandonedPending: number;
  errors: string[];
}

export async function resolveUnresolvedMutations(
  admin: SupabaseClient,
  env: Env,
  creds: EfsSoapCredentials,
  opts: { maxVendorReads?: number; fetchImpl?: typeof fetch } = {},
): Promise<UnresolvedResult> {
  const result: UnresolvedResult = {
    checked: 0, reconciledSucceeded: 0, reconciledFailed: 0, abandonedPending: 0, errors: [],
  };
  const maxReads = opts.maxVendorReads ?? 10;
  const now = Date.now();

  // Seven days of lookback: older `sent` rows have been on the operator's "Unverified" list through
  // multiple sweeps and are a support conversation, not a silent flip a week after the fact.
  const { data, error } = await admin
    .from("efs_card_mutations")
    .select("id, efs_card_id, status, created_at, edits, capability_key, request_body")
    .eq("org_id", creds.orgId)
    .in("status", ["pending", "sent"])
    .gte("created_at", new Date(now - 7 * 24 * 3600 * 1000).toISOString())
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    result.errors.push(`could not read unresolved mutations: ${error.message}`);
    return result;
  }

  const rows = z.array(unresolvedRowSchema).safeParse(data ?? []);
  if (!rows.success) {
    result.errors.push(`unresolved rows had an unexpected shape: ${rows.error.issues[0]?.message ?? "?"}`);
    return result;
  }

  /** One vendor read per card, shared by every row on it. */
  const docByCard = new Map<string, Awaited<ReturnType<typeof getCardV2>> | null>();
  let vendorReads = 0;

  for (const row of rows.data) {
    result.checked += 1;
    const ageMs = now - Date.parse(row.created_at);

    if (row.status === "pending") {
      if (ageMs <= liveWindowMs(env)) continue; // its request may still be running — not ours yet
      const { error: settleError } = await admin
        .from("efs_card_mutations")
        .update({
          status: "failed",
          efs_fault_code: "abandoned",
          efs_fault_message:
            "The process recording this mutation died before an outcome was written. Whether the " +
            "write reached EFS is unknown; the card's current state is in the mirror and the history.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("org_id", creds.orgId)
        .eq("status", "pending"); // never race a live request that settled it meanwhile
      if (settleError) {
        result.errors.push(`abandon ${row.id}: ${settleError.message}`);
        continue;
      }
      result.abandonedPending += 1;
      await writeAudit(admin, {
        orgId: creds.orgId, action: "card.mutation_abandoned",
        entity: "efs_cards", entityId: row.efs_card_id,
        meta: { mutationId: row.id, ageMs },
      });
      continue;
    }

    // status === "sent"
    const edits = row.edits ?? [];
    /**
     * The capability's OWN after-only predicate when the row names one; `editsLanded` otherwise.
     *
     * Before Step 3.9 this line was `if (edits.length === 0) continue`, and a `direct` op records no
     * edits — so every unverified `deleteOverride` sat on the operator's "Unverified" list forever,
     * with the answer one read away. A row still gets skipped when nothing can judge it: no
     * capability key AND no edits means there is no question this code knows how to ask.
     */
    const plan = row.capability_key === null ? null : reconcilePlanFor(row.capability_key);
    if (plan === null && edits.length === 0) continue;

    if (!docByCard.has(row.efs_card_id)) {
      if (vendorReads >= maxReads) continue; // budget spent; next sweep continues from here
      vendorReads += 1;
      try {
        const cardNumber = await loadCardNumber(admin, env, creds.orgId, row.efs_card_id);
        // The capability names its own reads (docs/27 §3.3), which is what will let a capability
        // whose state lives outside the card document be reconciled without a second code path
        // here. On the backfill lane either way — nobody is waiting on this sweep.
        const opts_ = { priority: "backfill" as const, fetchImpl: opts.fetchImpl };
        docByCard.set(
          row.efs_card_id,
          cardNumber === null
            ? null
            : plan
              ? (await plan.snapshot({ env, creds, cardNumber, opts: opts_ })).doc
              : await getCardV2(env, creds, cardNumber, opts_),
        );
      } catch (e) {
        docByCard.set(row.efs_card_id, null);
        result.errors.push(`read for ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const doc = docByCard.get(row.efs_card_id) ?? null;
    if (doc === null) continue;

    // Three-valued, and "indeterminate" is not "no": a capability that genuinely cannot tell must
    // leave the row where a human can see it rather than have it settled by default.
    const landing = plan ? plan.judge({ doc }, edits, row.request_body) : (editsLanded(doc, edits) ? "landed" : "not_landed");
    if (landing === "indeterminate") continue;
    const landed = landing === "landed";
    const cycleMs = (env.EFS_CARD_SYNC_HOURS ?? 24) * 3600 * 1000;
    if (!landed && ageMs <= cycleMs) continue; // too fresh to condemn — the apply may still be coming

    const { error: settleError } = await admin
      .from("efs_card_mutations")
      .update(
        landed
          ? {
              status: "succeeded",
              after_version: doc.version,
              reconciled_version: doc.version,
              after_document: doc.card,
              completed_at: new Date().toISOString(),
            }
          : {
              status: "failed",
              efs_fault_code: "no_change",
              efs_fault_message:
                "Reconciled by the background sweep: a full sync cycle after the write, the card " +
                "still does not carry the requested change.",
              after_version: doc.version,
              reconciled_version: doc.version,
              after_document: doc.card,
              completed_at: new Date().toISOString(),
            },
      )
      .eq("id", row.id)
      .eq("org_id", creds.orgId)
      .eq("status", "sent");
    if (settleError) {
      result.errors.push(`settle ${row.id}: ${settleError.message}`);
      continue;
    }
    if (landed) result.reconciledSucceeded += 1;
    else result.reconciledFailed += 1;
    await writeAudit(admin, {
      orgId: creds.orgId, action: "card.mutation_reconciled",
      entity: "efs_cards", entityId: row.efs_card_id,
      meta: {
        mutationId: row.id,
        outcome: landed ? "succeeded" : "failed",
        ageMs,
        // Which predicate answered. A settlement nobody can attribute is one nobody can re-check.
        judgedBy: row.capability_key ?? "edits_landed",
      },
    });
  }

  return result;
}
