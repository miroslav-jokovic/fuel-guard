import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAllPagedIn,
  nextDisplayNo,
  type AssetPurchaseRef,
  type EquipmentPurchaseDetail,
  type EquipmentPurchaseDto,
  type EquipmentPurchaseInput,
  type FleetpalOrderRef,
} from "@silvicom/shared";
import { orFilterValue } from "../../../lib/postgrestFilters.js";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import { purchaseOrderRefs } from "../../fleetpal/index.js";
import { traced } from "../inspections/serviceError.js";
import { PAGE_MAX } from "./parts.js";
import type { ServiceError } from "./types.js";

/**
 * Equipment bills (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §7a.4, M10b) over 0530's
 * `equipment_purchases`. The Invoices tab's list, one bill with its items, the write, and the line an
 * item's page shows.
 *
 * ── THE LIST IS LIVE BILLS ONLY ───────────────────────────────────────────────────────────────
 * A corrected bill stays on record (append-only, 0530) and is reached from its correction, never
 * listed beside it: two rows for one invoice would count the money twice on a page somebody adds up.
 * `getPurchase` still answers a superseded id, with `supersededBy` set, so an old link explains itself.
 *
 * ── COUNTS ARE THE DATABASE'S, A PAGE AT A TIME ───────────────────────────────────────────────
 * "How many items" and "is the paper filed" are read for the page's bills in one query each, paged
 * past PostgREST's 1,000-row cap (a page of 50 bills may name 10,000 items at 0530's 200 per bill).
 *
 * ── ONE WRITER ────────────────────────────────────────────────────────────────────────────────
 * `record_equipment_purchase` writes the bill, retires the one it corrects and moves the items in one
 * call; this file only says what its refusals mean to the person typing the bill.
 */

const COLUMNS =
  "id, vendor, invoice_number, invoice_date, total, notes, fleetpal_purchase_order_id, " +
  "superseded_by, created_by, created_at";

interface PurchaseRow {
  id: string;
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  total: unknown;
  notes: string | null;
  fleetpal_purchase_order_id: string | null;
  superseded_by: string | null;
  created_by: string;
  created_at: string;
}

interface Extras {
  items: Map<string, number>;
  papers: Map<string, number>;
  orders: Map<string, FleetpalOrderRef>;
  names: Map<string, string | null>;
}

function toDto(r: PurchaseRow, x: Extras): EquipmentPurchaseDto {
  return {
    id: r.id,
    vendor: r.vendor,
    invoiceNumber: r.invoice_number,
    invoiceDate: r.invoice_date,
    total: Number(r.total),
    notes: r.notes,
    fleetpalOrder: r.fleetpal_purchase_order_id ? (x.orders.get(r.fleetpal_purchase_order_id) ?? null) : null,
    itemCount: x.items.get(r.id) ?? 0,
    paperCount: x.papers.get(r.id) ?? 0,
    createdAt: r.created_at,
    createdByName: x.names.get(r.created_by) ?? null,
    supersededBy: r.superseded_by,
  };
}

const tally = (ids: string[]) => {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
};

/** Item counts, paper counts, FleetPal's references and who typed each — for a page of bills. */
async function extrasFor(admin: SupabaseClient, orgId: string, rows: PurchaseRow[]): Promise<Extras | ServiceError> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return { items: new Map(), papers: new Map(), orders: new Map(), names: new Map() };
  try {
    const [items, papers] = await Promise.all([
      fetchAllPagedIn<{ purchase_id: string }>(ids, (chunk) => (from, to) =>
        admin.from("inventory_assets").select("purchase_id").eq("org_id", orgId).in("purchase_id", chunk)
          .order("id").range(from, to)),
      fetchAllPagedIn<{ subject_id: string }>(ids, (chunk) => (from, to) =>
        admin.from("documents").select("subject_id").eq("org_id", orgId)
          .eq("subject_type", "equipment_purchase").in("subject_id", chunk).order("id").range(from, to)),
    ]);
    const orders = await purchaseOrderRefs(
      admin,
      orgId,
      rows.map((r) => r.fleetpal_purchase_order_id).filter((v): v is string => Boolean(v)),
    );
    if ("error" in orders) return traced("purchases.extras", "db_error", "Could not load the bills", orders);
    const labels = await memberLabels(admin, orgId, rows.map((r) => r.created_by));
    const names = new Map(rows.map((r) => [r.created_by, labelOf(labels.get(r.created_by))]));
    return {
      items: tally(items.map((i) => i.purchase_id)),
      papers: tally(papers.map((p) => p.subject_id)),
      orders: orders as Map<string, FleetpalOrderRef>,
      names,
    };
  } catch (e) {
    return traced("purchases.extras", "db_error", "Could not load the bills", e);
  }
}

export async function listPurchases(
  admin: SupabaseClient,
  orgId: string,
  opts: { search?: string; limit?: number; offset?: number } = {},
): Promise<{ purchases: EquipmentPurchaseDto[]; total: number } | ServiceError> {
  const limit = Math.min(opts.limit ?? PAGE_MAX, PAGE_MAX);
  const offset = Math.max(opts.offset ?? 0, 0);
  let q = admin.from("equipment_purchases").select(COLUMNS, { count: "exact" }).eq("org_id", orgId).is("superseded_by", null);
  if (opts.search?.trim()) {
    // Quoted through the `.or()` grammar's own escape — `assets.ts` carries the reason.
    const term = orFilterValue(`%${opts.search.trim()}%`);
    q = q.or(`vendor.ilike.${term},invoice_number.ilike.${term}`);
  }
  const { data, error, count } = await q
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return traced("listPurchases", "db_error", "Could not load the bills", error);
  const rows = (data ?? []) as unknown as PurchaseRow[];
  const extras = await extrasFor(admin, orgId, rows);
  if ("error" in extras) return extras;
  return { purchases: rows.map((r) => toDto(r, extras)), total: count ?? 0 };
}

/** One bill and every item it paid for. Null when it is not this org's. */
export async function getPurchase(
  admin: SupabaseClient,
  orgId: string,
  id: string,
): Promise<EquipmentPurchaseDetail | null | ServiceError> {
  const { data, error } = await admin.from("equipment_purchases").select(COLUMNS).eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) return traced("getPurchase", "db_error", "Could not load the bill", error);
  if (!data) return null;
  const row = data as unknown as PurchaseRow;
  const extras = await extrasFor(admin, orgId, [row]);
  if ("error" in extras) return extras;

  type ItemRow = { id: string; display_seq: number; name: string; purchase_cost: unknown; asset_types: { name: string } | { name: string }[] | null };
  const { data: items, error: itemsErr } = await admin
    .from("inventory_assets")
    .select("id, display_seq, name, purchase_cost, asset_types(name)")
    .eq("org_id", orgId)
    .eq("purchase_id", id)
    .order("display_seq", { ascending: true })
    .limit(1000);
  if (itemsErr) return traced("getPurchase", "db_error", "Could not load the bill's items", itemsErr);
  const typeName = (t: ItemRow["asset_types"]) => (Array.isArray(t) ? t[0]?.name : t?.name) ?? "";
  return {
    ...toDto(row, extras),
    items: ((items ?? []) as unknown as ItemRow[]).map((i) => ({
      id: i.id,
      displayNo: nextDisplayNo(i.display_seq),
      name: i.name,
      assetTypeName: typeName(i.asset_types),
      purchaseCost: i.purchase_cost == null ? null : Number(i.purchase_cost),
    })),
  };
}

/** The line an item's page shows: the live bill that paid for it, or null. */
export async function purchaseRefFor(
  admin: SupabaseClient,
  orgId: string,
  purchaseId: string | null,
): Promise<AssetPurchaseRef | null> {
  if (!purchaseId) return null;
  const { data } = await admin
    .from("equipment_purchases")
    .select("id, vendor, invoice_number, invoice_date")
    .eq("org_id", orgId)
    .eq("id", purchaseId)
    .maybeSingle();
  const r = data as { id: string; vendor: string; invoice_number: string; invoice_date: string } | null;
  return r ? { id: r.id, vendor: r.vendor, invoiceNumber: r.invoice_number, invoiceDate: r.invoice_date } : null;
}

/**
 * What the person typing the bill is told when the database refuses (0530's SQLSTATEs). Each one says
 * what to do next, because each is a fact about the books the form cannot see.
 */
const MESSAGES: Record<string, string> = {
  IV015: "That bill is incomplete.",
  IV024: "One of those items is not on the books.",
  IV026: "A bill cannot be edited — record a correction instead.",
  IV027: "That bill is not on file.",
  IV028: "Somebody corrected that bill first — open the newest one and correct that.",
};

function refusal(error: { code?: string; message?: string }): ServiceError | null {
  const known = error.code && MESSAGES[error.code];
  if (known) return { error: known, code: error.code as string };
  if (error.code === "IV029") {
    const on = /already on (.+)$/.exec(error.message ?? "")?.[1];
    return {
      error: on
        ? `One of those items is already on another bill (${on}). Correct that bill to take it off.`
        : "One of those items is already on another bill. Correct that bill to take it off.",
      code: "IV029",
    };
  }
  // 23505 on 0530's live-bill index, by NAME (0527's IMEI is mapped the same way).
  if (error.code === "23505" && /idx_equipment_purchases_live_invoice/.test(error.message ?? "")) {
    return { error: "That bill is already on file — open it from the list to correct it.", code: "duplicate_invoice" };
  }
  // 23503 on the bill's same-org key to a FleetPal order: an id that is not ours, or not staged.
  if (error.code === "23503") {
    return { error: "That FleetPal purchase order is not on file.", code: "unknown_purchase_order" };
  }
  return null;
}

export async function recordPurchase(
  admin: SupabaseClient,
  orgId: string,
  actorUserId: string,
  input: EquipmentPurchaseInput,
): Promise<EquipmentPurchaseDetail | ServiceError> {
  const { error } = await admin.rpc("record_equipment_purchase", {
    p_org: orgId,
    p_actor: actorUserId,
    p_row: input,
  });
  if (error) return refusal(error) ?? traced("recordPurchase", "db_error", "Could not record the bill", error);
  const saved = await getPurchase(admin, orgId, input.id);
  if (saved === null) return traced("recordPurchase", "db_error", "The bill was not recorded", null);
  return saved;
}
