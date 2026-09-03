/**
 * The FUEL tie-out, decomposed (D-FIN12, FINANCE-GO-LIVE-PLAN §1.12).
 *
 * The coverage report used to compare ONE number (EFS canonical fuel) against ONE account
 * (40050000, Fuel for Hired Vehicles) and print the difference as drift. Every complete month
 * drifted +5–8%, and nobody could say why, because the difference is three things wearing one
 * number. Measured for June 2026 on 2026-09-03:
 *
 *   · EFS `total_cost` on a fill is the whole card transaction — diesel, DEF, reefer diesel, a
 *     scale ticket, oil — while McLeod posts each PRODUCT to its own account (30220000 DEF,
 *     30340000 Reefer Fuel, 40760000 Scales, 30300000 Oil Change). June by line item: ULSD
 *     $957,387, DEFD $48,538, ULSR $5,903, SCLE $4,939, and ~$390 of additives, washer fluid and
 *     state tax across four codes.
 *   · Fuel bought on the carrier's card for an OWNER-OPERATOR's truck is not a carrier expense:
 *     McLeod books it to `Fuel Advance` (17000000, a Current Asset) and the contractor repays it
 *     through the FEE deduction — June's FUEL module debited $62,131.62 there. EFS books it as a
 *     fill like any other.
 *   · What is left after products and owner-operators is TIMING: McLeod posts a fill about a day
 *     late, so month-edge fills sit in the neighbouring month's ledger. That residual is named
 *     here and sized per account; it closes when McLeod's own `fuel_detail` is staged with its
 *     posting dates (F12b), and until then it is the one term of this tie-out that is not proven.
 *
 * Pure. The product → account map is a RULE this file prints, not a fact it derives: McLeod's
 * `fuel_detail` is the only place the posting account of a product is recorded, and it is not
 * staged yet. Every row of the map is stated on the report so a reader can strike it.
 */

export interface FuelLineItem {
  /** EFS item code on the card line — ULSD, DEFD, ULSR, SCLE, OIL, … */
  item: string | null;
  amount: number;
  /** The truck the pump line names, as EFS printed it. Null when the line carries none. */
  unit: string | null;
}

export interface FuelGlTotal {
  glid: string;
  descr: string | null;
  /** The FUEL module's net posting to this account for the month (debit-positive). */
  net_amount: number;
}

export interface FuelProductRule {
  glid: string;
  /** EFS item codes this account receives. */
  items: string[];
  label: string;
}

/**
 * McLeod's posting accounts per EFS product, as measured from June 2026's FUEL-module totals
 * beside June's EFS line items. `Fuel for Hired Vehicles` takes tractor diesel; reefer diesel is
 * ULSR; DEF, scales and oil each have a line of their own. Owner-operator fuel is routed to the
 * asset account BEFORE this map applies (see `buildFuelTieOut`).
 */
export const DEFAULT_FUEL_PRODUCT_RULES: FuelProductRule[] = [
  { glid: "40050000", items: ["ULSD"], label: "Fuel for Hired Vehicles — tractor diesel" },
  { glid: "30220000", items: ["DEFD"], label: "DEF" },
  { glid: "30340000", items: ["ULSR"], label: "Reefer Fuel — reefer diesel" },
  { glid: "40760000", items: ["SCLE"], label: "Scales" },
  { glid: "30300000", items: ["OIL"], label: "Oil Change" },
];

/** Where EFS fuel bought for an owner-operator's truck posts: a receivable, never an expense. */
export const OWNER_OPERATOR_FUEL_GLID = "17000000";

export interface FuelTieOutRow {
  glid: string;
  label: string;
  items: string[];
  /** McLeod's FUEL-module posting to this account, this month. Null when the month has no row. */
  gl: number | null;
  /** EFS card lines mapped to this account, this month. */
  efs: number;
  /** gl − efs. The posting-lag residual until McLeod's fuel_detail is staged (F12b). */
  residual: number | null;
}

export interface FuelTieOut {
  rows: FuelTieOutRow[];
  /** EFS lines whose item code no rule names — listed, never folded into an account. */
  unmapped: Array<{ item: string; amount: number; lines: number }>;
  /** The map this report applied, printed so it can be struck. */
  rules: FuelProductRule[];
  totals: {
    efsMapped: number;
    efsUnmapped: number;
    efsOwnerOperator: number;
    gl: number;
    /** Σ residual over accounts with both sides present. */
    residual: number;
  };
  ownerOperatorUnits: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function buildFuelTieOut(input: {
  lines: FuelLineItem[];
  /** Tractor units that ran for an owner-operator this month (settlement payee_type). */
  ownerOperatorUnits: Set<string>;
  glTotals: FuelGlTotal[];
  rules?: FuelProductRule[];
}): FuelTieOut {
  const rules = input.rules ?? DEFAULT_FUEL_PRODUCT_RULES;
  const byGlid = new Map<string, number>();
  const unmapped = new Map<string, { amount: number; lines: number }>();
  let ownerOp = 0;
  let mapped = 0;
  let unmappedTotal = 0;

  for (const l of input.lines) {
    const item = (l.item ?? "").trim().toUpperCase();
    const amount = round(l.amount);
    if (l.unit && input.ownerOperatorUnits.has(l.unit.trim())) {
      ownerOp = round(ownerOp + amount);
      continue;
    }
    const rule = rules.find((r) => r.items.includes(item));
    if (!rule) {
      const u = unmapped.get(item || "(blank)") ?? { amount: 0, lines: 0 };
      u.amount = round(u.amount + amount);
      u.lines++;
      unmapped.set(item || "(blank)", u);
      unmappedTotal = round(unmappedTotal + amount);
      continue;
    }
    byGlid.set(rule.glid, round((byGlid.get(rule.glid) ?? 0) + amount));
    mapped = round(mapped + amount);
  }

  const glByGlid = new Map(input.glTotals.map((g) => [g.glid, g]));
  const rows: FuelTieOutRow[] = rules.map((r) => {
    const gl = glByGlid.get(r.glid);
    const efs = byGlid.get(r.glid) ?? 0;
    return {
      glid: r.glid,
      label: gl?.descr ? `${gl.descr}` : r.label,
      items: r.items,
      gl: gl ? round(gl.net_amount) : null,
      efs,
      residual: gl ? round(round(gl.net_amount) - efs) : null,
    };
  });
  // Owner-operator fuel against the asset account's FUEL-module debits.
  const asset = glByGlid.get(OWNER_OPERATOR_FUEL_GLID);
  rows.push({
    glid: OWNER_OPERATOR_FUEL_GLID,
    label: asset?.descr ?? "Fuel Advance — owner-operator fuel (a receivable, not an expense)",
    items: ["(owner-operator units)"],
    gl: asset ? round(asset.net_amount) : null,
    efs: ownerOp,
    residual: asset ? round(round(asset.net_amount) - ownerOp) : null,
  });
  // FUEL-module accounts no rule names — shown, so a new posting account cannot hide.
  for (const g of input.glTotals) {
    if (rows.some((r) => r.glid === g.glid)) continue;
    rows.push({ glid: g.glid, label: g.descr ?? g.glid, items: [], gl: round(g.net_amount), efs: 0, residual: round(g.net_amount) });
  }

  const glTotal = round(input.glTotals.reduce((s, g) => s + g.net_amount, 0));
  const residual = round(rows.reduce((s, r) => s + (r.residual ?? 0), 0));
  return {
    rows,
    unmapped: [...unmapped.entries()].map(([item, u]) => ({ item, ...u })).sort((a, b) => b.amount - a.amount),
    rules,
    totals: { efsMapped: mapped, efsUnmapped: unmappedTotal, efsOwnerOperator: ownerOp, gl: glTotal, residual },
    ownerOperatorUnits: input.ownerOperatorUnits.size,
  };
}
