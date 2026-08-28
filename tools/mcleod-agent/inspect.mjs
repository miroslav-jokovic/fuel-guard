/**
 * The recon pack — every question the field mapping cannot answer without measuring, as a COMMAND
 * rather than a script somebody pastes into a SQL editor (MCLEOD-FIELD-GAP-PLAN §7).
 *
 * ── WHY THIS IS A COMMITTED COMMAND AND NOT AN AD-HOC QUERY ──────────────────────────────────────
 * It has to be runnable by somebody who is not the person who wrote it. Three reasons, and the third
 * is the one that matters:
 *
 *  1. The sandbox `lme_analytics` is a ONE-OFF RESTORE taken 2026-08-21 09:46, not a feed. Every
 *     number it yields is a measurement of that morning, and it will need re-taking.
 *  2. Production is `lme` on the same instance and this login cannot read it — `HAS_DBACCESS('lme')`
 *     is 0. **The answers that matter for cutover can only ever be measured by somebody else**, on a
 *     login we do not have and against data we will never see directly.
 *  3. So a recon that depends on one person's shell access is the wrong shape. This one runs from the
 *     agent that is already deployed on the carrier's network, prints machine-readable output, and is
 *     reviewable in a pull request before anyone points it at a production database.
 *
 * ── SAFETY, ENFORCED BY `pnpm lint:mcleod-recon` ─────────────────────────────────────────────────
 * The gate reads this file and fails the build unless every query below is:
 *   · a single `select` — no DML, no DDL, no `exec`;
 *   · free of the columns in FORBIDDEN, which may not appear even inside an aggregate;
 *   · counting rather than returning anything in COUNT_ONLY (names, contacts, licences, addresses);
 *   · bound to `@companyId` when it reads driver, tractor or trailer.
 *
 * That last rule is not hygiene. `dbo.company` holds four legal entities whose rows sit in the same
 * tables, and an unbound recon query silently blends Silvicom Inc with Silvicom Logistics — which is
 * exactly the mistake §4.4 was written after.
 */

/** Columns that must never appear in a recon query, in any form. */
export const FORBIDDEN = [
  "social_security_no",
  "race",
  "sex",
  "passport",
  "enginedata_pwd",
  "mc_unit_password",
  "mc_login",
  "proximity_card",
];

/** Columns a recon query may COUNT but never return. */
export const COUNT_ONLY = [
  "name_of_spouse",
  "first_name",
  "license_no",
  "birth_date",
  "address",
  "cell_phone",
  "email",
];

const ACTIVE_DRIVER = `d.company_id = @companyId and d.is_active = 'Y'`;
const ACTIVE_TRACTOR = `t.company_id = @companyId and t.service_status = 'A' and t.outservice_date is null`;
const ACTIVE_TRAILER = `r.company_id = @companyId and r.is_active = 'A' and r.outservice_date is null`;

/** A code-column distribution: the value, trimmed, and how many active rows carry it. */
const dist = (alias, table, col, where) => `
  select isnull(nullif(ltrim(rtrim(cast(${alias}.${col} as varchar(64)))), ''), '(null)') as value,
         count(*) as n
    from dbo.${table} as ${alias}
   where ${where}
   group by ${alias}.${col}`;

/**
 * A date column's DIRECTION. Overwhelmingly past means "when it was last done"; overwhelmingly future
 * means "when it next falls due". Getting this backwards is the `license_date` class of error, which
 * is why every date below is asked rather than assumed.
 */
const direction = (alias, table, col, where) => `
  select '${col}' as column_name,
         sum(case when ${alias}.${col} <  getdate() then 1 else 0 end) as past,
         sum(case when ${alias}.${col} >= getdate() then 1 else 0 end) as future,
         count(${alias}.${col}) as populated,
         count(*) as active_rows
    from dbo.${table} as ${alias}
   where ${where}`;

export const INSPECTION = [
  // ── drivers ────────────────────────────────────────────────────────────────────────────────────
  { id: "A1", blocks: "drivers.driver_type", question: "Is driver.type_of the company / owner-operator split?", sql: dist("d", "driver", "type_of", ACTIVE_DRIVER) },
  { id: "A2", blocks: "drivers.cdl_class", question: "driver.drvr_class distribution", sql: dist("d", "driver", "drvr_class", ACTIVE_DRIVER) },
  { id: "A3", blocks: "drivers.home_terminal_id (sizing only)", question: "Which home locations exist, and how many drivers each?", sql: dist("d", "driver", "home_location_id", ACTIVE_DRIVER) },

  // ── tractors ───────────────────────────────────────────────────────────────────────────────────
  { id: "B1", blocks: "vehicles.purchased_at", question: "tractor.purchase_date coverage and direction", sql: direction("t", "tractor", "purchase_date", ACTIVE_TRACTOR) },
  { id: "B2", blocks: "vehicles.irp_account", question: "tractor.irp_code and dot_number coverage", sql: `
  select count(nullif(ltrim(rtrim(t.irp_code)), ''))   as irp_code,
         count(nullif(ltrim(rtrim(t.dot_number)), '')) as dot_number,
         count(*)                                      as active_rows
    from dbo.tractor as t
   where ${ACTIVE_TRACTOR}` },
  { id: "B3", blocks: "vehicles.gvwr_lb, tare_weight_lb", question: "Which UNITS do the tractor weight columns use?", sql: `
  select isnull(nullif(ltrim(rtrim(t.gross_veh_weight_um)), ''), '(null)') as gvw_um,
         isnull(nullif(ltrim(rtrim(t.weight_um)), ''), '(null)')           as weight_um,
         count(*)                as n,
         min(t.gross_veh_weight) as min_gvw, max(t.gross_veh_weight) as max_gvw,
         min(t.weight)           as min_weight, max(t.weight)        as max_weight
    from dbo.tractor as t
   where ${ACTIVE_TRACTOR}
   group by t.gross_veh_weight_um, t.weight_um` },
  { id: "B4", blocks: "vehicles.ownership_type", question: "tractor.owner distribution", sql: dist("t", "tractor", "owner", ACTIVE_TRACTOR) },
  { id: "B5", blocks: "vehicles.ownership_type", question: "tractor.pay_owner distribution", sql: dist("t", "tractor", "pay_owner", ACTIVE_TRACTOR) },
  { id: "B6", blocks: "vehicles (equipment type)", question: "tractor.type_of distribution", sql: dist("t", "tractor", "type_of", ACTIVE_TRACTOR) },
  { id: "B7", blocks: "vehicles.fuel_type (a Postgres enum)", question: "tractor.fuel_type_code distribution", sql: dist("t", "tractor", "fuel_type_code", ACTIVE_TRACTOR) },
  { id: "B8", blocks: "vehicles.axle_count", question: "tractor.axle_number_code distribution — it is a CODE, not a number", sql: dist("t", "tractor", "axle_number_code", ACTIVE_TRACTOR) },
  { id: "B9", blocks: "D-FG5 (tank capacity seed)", question: "Is tractor.fuel_capacity a credible seed for a new truck?", sql: `
  select count(*)                       as active_rows,
         count(nullif(t.fuel_capacity, 0)) as populated,
         min(nullif(t.fuel_capacity, 0))   as min_gal,
         max(t.fuel_capacity)              as max_gal
    from dbo.tractor as t
   where ${ACTIVE_TRACTOR}` },

  // ── trailers ───────────────────────────────────────────────────────────────────────────────────
  { id: "C1a", blocks: "trailers.registration_expires_at", question: "trailer.tag_expire_date direction", sql: direction("r", "trailer", "tag_expire_date", ACTIVE_TRAILER) },
  { id: "C1b", blocks: "trailers.dot_annual_inspection_expires_at", question: "trailer.inspection_date direction", sql: direction("r", "trailer", "inspection_date", ACTIVE_TRAILER) },
  { id: "C1c", blocks: "trailers.purchased_at", question: "trailer.purchase_date direction", sql: direction("r", "trailer", "purchase_date", ACTIVE_TRAILER) },
  { id: "C2", blocks: "all trailer dimensions", question: "Which UNITS do the trailer dimension columns use?", sql: `
  select isnull(nullif(ltrim(rtrim(r.length_of_um)), ''), '(null)')        as length_um,
         isnull(nullif(ltrim(rtrim(r.volume_um)), ''), '(null)')           as volume_um,
         isnull(nullif(ltrim(rtrim(r.weight_um)), ''), '(null)')           as weight_um,
         isnull(nullif(ltrim(rtrim(r.gross_veh_weight_um)), ''), '(null)') as gvw_um,
         count(*) as n,
         min(r.length_of) as min_len, max(r.length_of) as max_len,
         max(r.volume)    as max_volume, max(r.weight) as max_weight
    from dbo.trailer as r
   where ${ACTIVE_TRAILER}
   group by r.length_of_um, r.volume_um, r.weight_um, r.gross_veh_weight_um` },
  { id: "C3", blocks: "trailers.trailer_type (a CHECK: dry_van|reefer|flatbed|tanker|hopper|other)", question: "trailer.trailer_type distribution — R is verified as reefer, V is NOT verified", sql: dist("r", "trailer", "trailer_type", ACTIVE_TRAILER) },
  { id: "C4", blocks: "trailers.door_type", question: "trailer.door_type_code distribution", sql: dist("r", "trailer", "door_type_code", ACTIVE_TRAILER) },
  { id: "C5", blocks: "trailers.axle_count (a new column)", question: "trailer.axles distribution", sql: dist("r", "trailer", "axles", ACTIVE_TRAILER) },
  { id: "C6", blocks: "trailers.ownership_type", question: "trailer.ownership distribution", sql: dist("r", "trailer", "ownership", ACTIVE_TRAILER) },

  // ── the vocabulary behind every code above ─────────────────────────────────────────────────────
  // dbo.code is keyed (field_table_alias, field_name, field_code); field_code_desc is the meaning.
  { id: "D1", blocks: "D-FG3", question: "Which columns have a code vocabulary at all?", sql: `
  select ltrim(rtrim(c.field_table_alias)) as table_alias,
         ltrim(rtrim(c.field_name))        as field_name,
         count(*)                          as n_codes
    from dbo.code as c
   group by c.field_table_alias, c.field_name` },
  { id: "D2", blocks: "D-FG3", question: "The code values for every column this mapping needs", sql: `
  select ltrim(rtrim(c.company_id))        as company_id,
         ltrim(rtrim(c.field_table_alias)) as table_alias,
         ltrim(rtrim(c.field_name))        as field_name,
         ltrim(rtrim(c.field_code))        as code,
         ltrim(rtrim(c.field_code_desc))   as meaning
    from dbo.code as c
   where ltrim(rtrim(c.field_name)) in (
     'type_of', 'drvr_class', 'owner', 'pay_owner', 'ownership', 'fuel_type_code',
     'axle_number_code', 'trailer_type', 'door_type_code', 'equipment_type_id')` },
  // ⚠ `dbo.code.field_name` does NOT always equal the column name. D2's filter above missed the
  // trailer-type vocabulary entirely because the column is `trailer.trailer_type` and the codes are
  // filed under `TRL.trl_type_code` — found only by listing what HAS a vocabulary (D1) and noticing
  // the near-miss. So this question asks by SHAPE rather than by name: every code on the equipment
  // and driver aliases whose field name mentions a type, a class or a status.
  { id: "D3", blocks: "trailers.trailer_type, drivers.driver_type", question: "Type/class/status vocabularies on the equipment and driver aliases, by shape rather than by column name", sql: `
  select ltrim(rtrim(c.field_table_alias)) as table_alias,
         ltrim(rtrim(c.field_name))        as field_name,
         ltrim(rtrim(c.field_code))        as code,
         ltrim(rtrim(c.field_code_desc))   as meaning
    from dbo.code as c
   where (c.field_name like '%type%' or c.field_name like '%class%' or c.field_name like '%status%')
     and ltrim(rtrim(c.field_table_alias)) in ('TRL', 'tra', 'trl', 'TRA', 'DRV', 'drv', 'PWU')` },

  // ── billing (P3.3 — the earnings side; SEPARATION-PROGRAM-PLAN) ──────────────────────────────────
  // 0257's mcleod_billing was authored from an ad-hoc measurement session that recorded the FINDINGS
  // (1,595 GL BILL keys to 1,595 lines; invoiced_flag 'N' on all 1,640 June rows) but not the SELECT.
  // These two questions re-take that measurement reproducibly so the billing sweep can be written
  // against ANSWERED column names instead of guessed ones — the trailer-type near-miss (D3 above) is
  // what guessing costs.
  { id: "F1", blocks: "mcleod_billing sweep (all columns)", question: "What columns does billing_history actually carry, and with what types?", sql: `
  select column_name, data_type, is_nullable
    from information_schema.columns
   where table_name = 'billing_history'
   order by ordinal_position` },
  { id: "F2", blocks: "mcleod_billing sweep (window + volume)", question: "billing_history rows per company — the sizing and company-binding check", sql: `
  select ltrim(rtrim(b.company_id)) as company_id, count(*) as n
    from dbo.billing_history as b
   group by b.company_id` },
  // F1 (answered 2026-08-27) surfaced `canceled` and `rebilled` flags whose vocabulary nothing has
  // measured. The sweep's void predicate must come from THIS distribution, not from assuming
  // 'Y'/'N' — importing a canceled invoice as revenue overstates every report it touches.
  { id: "F3", blocks: "mcleod_billing sweep (void predicate)", question: "canceled/rebilled vocabulary with June 2026 dollars — which rows are not real revenue?", sql: `
  select ltrim(rtrim(b.canceled)) as canceled, ltrim(rtrim(b.rebilled)) as rebilled,
         count(*) as n, sum(b.total_charges) as total_charges
    from dbo.billing_history as b
   where b.company_id = @companyId
     and b.bill_date >= '2026-06-01' and b.bill_date < '2026-07-01'
   group by b.canceled, b.rebilled` },
  // The acceptance check for the whole sweep: monthly totals the carrier can recognise from their
  // own income statement (June 2026 revenue is a known figure). If these don't line up, the
  // extraction is wrong and nothing downstream of it is worth debugging — the movements sweep's
  // dry-run doctrine, applied to revenue.
  { id: "F4", blocks: "mcleod_billing sweep (acceptance)", question: "2026 monthly billing totals — do they match the income statement?", sql: `
  select convert(varchar(7), b.bill_date, 126) as month,
         count(*) as n,
         sum(b.total_charges) as total_charges,
         sum(b.other_charge) as other_charge,
         sum(b.excisetax_total) as excise_tax
    from dbo.billing_history as b
   where b.company_id = @companyId
     and b.bill_date >= '2026-01-01'
   group by convert(varchar(7), b.bill_date, 126)` },
  // F3 (answered 2026-08-28) showed June has ZERO canceled/rebilled rows, so the 45-row gap between
  // 1,640 billed and 1,595 GL-posted is timing, not voids. This splits the month's dollars by the
  // exact predicate the ledger-coverage BILL claim uses — the posted bucket is the figure that must
  // land next to the income statement's June revenue.
  { id: "F5", blocks: "ledger-coverage BILL claim (acceptance)", question: "June 2026 dollars split by the GL-booked predicate — what does the posted bucket total?", sql: `
  select case when b.post_key is not null and ltrim(rtrim(b.post_key)) <> '' and ltrim(rtrim(b.post_module)) = 'BILL'
              then 'posted' else 'unposted' end as bucket,
         count(*) as n,
         sum(b.total_charges) as total_charges,
         sum(b.other_charge) as other_charge,
         sum(b.excisetax_total) as excise_tax
    from dbo.billing_history as b
   where b.company_id = @companyId
     and b.bill_date >= '2026-06-01' and b.bill_date < '2026-07-01'
   group by case when b.post_key is not null and ltrim(rtrim(b.post_key)) <> '' and ltrim(rtrim(b.post_module)) = 'BILL'
                 then 'posted' else 'unposted' end` },
  // 0268 staged `deduct_code` verbatim and recorded its vocabulary as an unmeasured gap. This is
  // the measurement: every code that carried dollars in 2026, so the harness can decide which
  // deductions are driver cost vs pass-through without guessing from the code's spelling.
  { id: "F6", blocks: "mcleod_deductions semantics (deduct_code vocabulary)", question: "Which deduct codes exist and how many 2026 dollars does each carry?", sql: `
  select ltrim(rtrim(d.deduct_code_id)) as deduct_code,
         ltrim(rtrim(d.deduction_type)) as deduction_type,
         count(*) as n, sum(d.amount) as amount
    from dbo.drs_deduct_hist as d
   where d.company_id = @companyId
     and d.is_void = 'N'
     and d.transaction_date >= '2026-01-01'
   group by d.deduct_code_id, d.deduction_type` },
  // D-FS8 deferred staging the GL's OFF office lines because nothing had measured whether
  // `gl_ledger` rows have a stable per-row key. This lists the key candidates the catalog itself
  // claims: identity columns and unique-index membership. No identity and no unique index means
  // month-grained totals stay the only honest grain.
  // R4 (TRUCK-COST-ATTRIBUTION-PLAN) needs a checklist of GL accounts WITH NAMES — glid alone is
  // a number nobody can rule on. Nothing measured yet names the account-master table, so first
  // list the candidates the catalog offers; F9 reads names + totals once this answers.
  { id: "F8", blocks: "R4 jurisdictional-account checklist (account master discovery)", question: "Which tables could be the GL account master?", sql: `
  select t.name as table_name, count(c.column_id) as n_columns
    from sys.tables as t
         inner join sys.columns as c on c.object_id = t.object_id
   where t.name like '%gl%' or t.name like '%acct%' or t.name like '%account%'
   group by t.name` },
  // F8 (answered 2026-08-28) named `gl_account` (32 columns) the account master; its column list
  // decides which of them carries the human name the R4 checklist needs.
  { id: "F9", blocks: "R4 jurisdictional-account checklist (account-name column)", question: "What columns does gl_account carry?", sql: `
  select c.column_name, c.data_type
    from information_schema.columns as c
   where c.table_name = 'gl_account'` },
  // The R4/R1 worksheet itself: every account that moved money in 2026, named. `descr` and
  // `type_id` come from F9's answer; the live/_hist union is the same shape GL_CONTROL_TOTALS
  // uses (both tables hold 2026 lines — D-MC12's control-total doctrine).
  { id: "F10", blocks: "R4 jurisdictional-account checklist + R1 overhead ruling (named 2026 account totals)", question: "Which GL accounts moved money in 2026, and what is each called?", sql: `
  select ltrim(rtrim(g.glid)) as glid,
         max(ltrim(rtrim(a.descr))) as descr,
         max(ltrim(rtrim(a.type_id))) as type_id,
         count(*) as lines,
         sum(g.amount) as net_amount
    from (select company_id, glid, amount, transaction_date from dbo.gl_ledger
          union all
          select company_id, glid, amount, transaction_date from dbo.gl_ledger_hist) as g
         left join dbo.gl_account as a on a.company_id = g.company_id and a.id = g.glid
   where g.company_id = @companyId
     and g.transaction_date >= '2026-01-01' and g.transaction_date < '2027-01-01'
   group by ltrim(rtrim(g.glid))` },
  // The EFS completeness control: our raw fuel_transactions were BACKFILLED by the SOAP feed when
  // it went live 2026-08-03, and April/May sit visibly below their neighbours ($621k/$431k vs ~$1M).
  // McLeod's Fuel-for-Hired-Vehicles account (40050000, F10) is entered from the EFS statements by
  // the office — if ITS April/May match ours, the dip is real; if not, the backfill has a hole.
  { id: "F11", blocks: "EFS raw completeness (fuel_transactions backfill vs GL control)", question: "What did the GL fuel account book per month in 2026?", sql: `
  select convert(varchar(7), g.transaction_date, 126) as month,
         count(*) as lines,
         sum(g.amount) as net_amount
    from (select company_id, glid, amount, transaction_date from dbo.gl_ledger
          union all
          select company_id, glid, amount, transaction_date from dbo.gl_ledger_hist) as g
   where g.company_id = @companyId
     and ltrim(rtrim(g.glid)) = '40050000'
     and g.transaction_date >= '2026-01-01' and g.transaction_date < '2027-01-01'
   group by convert(varchar(7), g.transaction_date, 126)` },
  { id: "F7", blocks: "gl_ledger office-line staging (stable row key)", question: "Does gl_ledger have an identity column or unique index to key rows by?", sql: `
  select c.name as column_name, c.is_identity,
         isnull(i.name, '') as unique_index, isnull(i.is_primary_key, 0) as is_primary_key
    from sys.columns as c
         inner join sys.tables as t on t.object_id = c.object_id
         left join sys.index_columns as ic on ic.object_id = c.object_id and ic.column_id = c.column_id
         left join sys.indexes as i on i.object_id = ic.object_id and i.index_id = ic.index_id and i.is_unique = 1
   where t.name = 'gl_ledger'
     and (c.is_identity = 1 or i.index_id is not null)` },
];
