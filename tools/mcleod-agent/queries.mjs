/**
 * Every McLeod column this integration reads, in one file.
 *
 * This is the ENTIRE surface of FuelGuard's coupling to a vendor's private schema, and it is meant to
 * be reviewable in one sitting. `dbo.driver` alone has 159 columns and McLeod may reshape any of them
 * in any release with no compatibility promise, so nothing outside this file knows a McLeod column name.
 *
 * Rules, all of them load-bearing:
 *
 *  · **Explicit column lists, never `SELECT *`.** The schema carries `social_security_no` (populated on
 *    1,461 of 1,463 driver rows), `birth_date`, `race`, `sex`, and banking and payroll columns. An
 *    allowlist is the difference between reading a roster and exfiltrating a personnel file.
 *  · **`companyId` is always bound as a parameter.** `dbo.company` holds four rows that all share
 *    `company_id = 'TMS'` — that field is the LoadMaster instance code. The real discriminator is
 *    `company.id`, which is what the master tables reference. Getting this wrong silently mixes
 *    Silvicom Inc with Silvicom Logistics.
 *  · **`char(n)` is space-padded**, so every text column is trimmed and blanks become NULL.
 *  · **Dates cross the wire as `YYYY-MM-DD`,** never as a driver-local `Date`, so a timezone cannot
 *    move a licence expiry by a day.
 *  · **Active rows only.** Retired tractors repeat VINs — 72+ duplicated across historical rows, one
 *    five times — and FuelGuard's `uq_vehicles_org_vin` is org-wide and would refuse to build over them.
 *
 * Predicates verified against the carrier's sandbox on 2026-08-24:
 *   driver   `is_active = 'Y'`                              → 164 rows; 163 of them have HOS in the
 *                                                             last 180 days. `status_code` is NULL on
 *                                                             every row in the table and is not used.
 *   tractor  `service_status = 'A' AND outservice_date IS NULL` → 190
 *   trailer  `is_active = 'A' AND outservice_date IS NULL`      → 235
 */

/** Columns needed to MATCH a row to an existing FuelGuard record. Sent in every mode. */
const DRIVER_MATCH = `
      LTRIM(RTRIM(d.id))                         AS external_id,
      LTRIM(RTRIM(d.company_id))                 AS company_id,
      NULLIF(LTRIM(RTRIM(d.license_no)), '')     AS cdl_number,
      NULLIF(LTRIM(RTRIM(d.license_state)), '')  AS cdl_state,
      NULLIF(LTRIM(RTRIM(d.first_name)), '')     AS first_name,
      NULLIF(LTRIM(RTRIM(d.name_mid_initial)), '') AS middle_name,
      NULLIF(LTRIM(RTRIM(d.name)), '')           AS last_name`;

/**
 * Columns written from M4 onward. Deliberately a SEPARATE list so that link-only mode does not read a
 * date of birth or a home address at all — not "reads and discards", does not read.
 *
 * `physical_date` is absent on purpose: it is byte-identical to `medical_cert_expire` in all 164 active
 * rows, so sending it would be two names for one fact. `mvr_date` is absent too — it is the NEXT MVR
 * DUE date rather than the last pull, which belongs to qualification evidence, not to the roster.
 */
const DRIVER_IDENTITY = `
      d.is_active                                AS is_active,
      CONVERT(varchar(10), d.hire_date, 23)      AS hire_date,
      CONVERT(varchar(10), d.termination_date, 23) AS termination_date,
      CONVERT(varchar(10), d.license_date, 23)   AS cdl_expires_at,
      CONVERT(varchar(10), d.medical_cert_expire, 23) AS medical_card_expires_at,
      CONVERT(varchar(10), d.birth_date, 23)     AS date_of_birth,
      NULLIF(LTRIM(RTRIM(d.address)), '')        AS address_line1,
      NULLIF(LTRIM(RTRIM(d.city)), '')           AS city,
      NULLIF(LTRIM(RTRIM(d.state)), '')          AS state,
      NULLIF(LTRIM(RTRIM(d.zip)), '')            AS postal_code,
      -- ⚠ NOT a spouse's name. This carrier stores the driver's EMAIL ADDRESS in name_of_spouse,
      -- deliberately and consistently: all 164 active drivers have an '@' in it, while driver.email --
      -- the column actually named for the purpose -- is empty on all 1,463 rows.
      --
      -- A local convention like this is exactly what the agent exists to absorb. FuelGuard is told
      -- 'email'; only this file knows where it really lives, and nothing downstream carries the
      -- surprise. Sanity-checked and truncation-filtered by usableEmail() before it is sent.
      NULLIF(LTRIM(RTRIM(d.name_of_spouse)), '') AS email_raw`;

const VEHICLE_MATCH = `
      LTRIM(RTRIM(t.id))                         AS external_id,
      LTRIM(RTRIM(t.company_id))                 AS company_id,
      NULLIF(LTRIM(RTRIM(t.serial_number)), '')  AS vin,
      LTRIM(RTRIM(t.id))                         AS unit_number`;

const VEHICLE_IDENTITY = `
      NULLIF(LTRIM(RTRIM(t.make)), '')           AS make,
      NULLIF(LTRIM(RTRIM(t.model)), '')          AS model,
      NULLIF(LTRIM(RTRIM(t.model_year)), '')     AS model_year,
      NULLIF(LTRIM(RTRIM(t.tag)), '')            AS plate,
      NULLIF(LTRIM(RTRIM(t.tag_state)), '')      AS plate_state,
      CONVERT(varchar(10), t.tag_expire_date, 23)  AS registration_expires_at,
      CONVERT(varchar(10), t.inspection_date, 23)  AS annual_inspection_performed_at,
      CONVERT(varchar(10), t.purchase_date, 23)    AS purchased_at`;

const TRAILER_MATCH = `
      LTRIM(RTRIM(r.id))                         AS external_id,
      LTRIM(RTRIM(r.company_id))                 AS company_id,
      NULLIF(LTRIM(RTRIM(r.serial_number)), '')  AS vin,
      LTRIM(RTRIM(r.id))                         AS unit_number`;

const TRAILER_IDENTITY = `
      NULLIF(LTRIM(RTRIM(r.trailer_type)), '')   AS trailer_type,
      NULLIF(LTRIM(RTRIM(r.make)), '')           AS make,
      NULLIF(LTRIM(RTRIM(r.model_year)), '')     AS model_year,
      NULLIF(LTRIM(RTRIM(r.license_no)), '')     AS plate,
      NULLIF(LTRIM(RTRIM(r.license_state)), '')  AS plate_state,
      -- Measured 2026-08-24: 228 of 235 populated and 228 of 228 in the PAST, so this is the date the
      -- annual inspection was PERFORMED -- the same shape as the tractor's, and the opposite of every
      -- driver date. tag_expire_date is deliberately absent: 0 of 235 populated.
      -- (No backticks in here: this comment lives inside a JS template literal.)
      CONVERT(varchar(10), r.inspection_date, 23)  AS annual_inspection_performed_at,
      CONVERT(varchar(10), r.purchase_date, 23)    AS purchased_at,
      r.axles                                      AS axle_count`;

/**
 * Build the three roster queries. `mode` is 'link' (match keys only) or 'identity' (match keys plus the
 * fields M4 writes) — the column list itself changes, which is what keeps PII out of the link-only phase.
 */
export function rosterQueries(mode = "link") {
  // `create` needs the identity columns as much as `identity` does — arguably more, since the row it
  // builds has no prior values to fall back on. Until 2026-08-24 this read `mode === "identity"`
  // alone, so a create sweep would have selected match keys only and inserted drivers carrying a name
  // and a status and nothing else: no licence, no medical expiry, no hire date, no address. It was
  // never caught because no create sweep has ever run — the whole point of M-R.
  const full = mode === "identity" || mode === "create";
  return {
    drivers: `
    SELECT${DRIVER_MATCH}${full ? "," + DRIVER_IDENTITY : ""}
      FROM dbo.driver AS d
     WHERE d.company_id = @companyId
       AND d.is_active = 'Y'`,
    vehicles: `
    SELECT${VEHICLE_MATCH}${full ? "," + VEHICLE_IDENTITY : ""}
      FROM dbo.tractor AS t
     WHERE t.company_id = @companyId
       AND t.service_status = 'A'
       AND t.outservice_date IS NULL`,
    trailers: `
    SELECT${TRAILER_MATCH}${full ? "," + TRAILER_IDENTITY : ""}
      FROM dbo.trailer AS r
     WHERE r.company_id = @companyId
       AND r.is_active = 'A'
       AND r.outservice_date IS NULL`,
  };
}

/**
 * The RETIREMENT sweep: rows that FAIL the active predicate, sent with an explicit status.
 *
 * Deliberately a positive assertion rather than an inference from absence. FuelGuard could compare the
 * active sweep against what it has linked and retire the difference — but a query that returns short
 * for any reason (a restore in progress, a network truncation, a mis-scoped company id) then looks
 * exactly like a fleet-wide layoff. Sending "this specific driver is terminated, and here is the date"
 * cannot be produced by a failure.
 *
 * Only the columns needed to retire: the link, the status, and the date. No names, no addresses, no
 * licences — a sweep about people LEAVING has no business carrying their personal data.
 *
 * ⚠ These are NOT the exact complement of the active predicates, and that is deliberate. Verified
 * 2026-08-24: one tractor and one trailer have a NULL status and no out-of-service date, so they
 * satisfy neither "clearly in service" nor "clearly retired". They fall through both sweeps and are
 * left alone. Retiring a row on the strength of a NULL is exactly the inference this design exists to
 * avoid. (Drivers have no such gap — `is_active IS NULL` is caught explicitly below; there is one such
 * row and it retires.)
 *
 * Counts at the time of writing: 1,299 of 1,463 drivers, 455 of 646 tractors, 168 of 404 trailers.
 */
export function retirementQueries() {
  return {
    drivers: `
    SELECT
      LTRIM(RTRIM(d.id))                           AS external_id,
      LTRIM(RTRIM(d.company_id))                   AS company_id,
      d.is_active                                  AS is_active,
      CONVERT(varchar(10), d.termination_date, 23) AS termination_date
      FROM dbo.driver AS d
     WHERE d.company_id = @companyId
       AND (d.is_active <> 'Y' OR d.is_active IS NULL)`,
    vehicles: `
    SELECT
      LTRIM(RTRIM(t.id))                           AS external_id,
      LTRIM(RTRIM(t.company_id))                   AS company_id,
      CONVERT(varchar(10), t.outservice_date, 23)  AS out_of_service_at
      FROM dbo.tractor AS t
     WHERE t.company_id = @companyId
       AND (t.service_status <> 'A' OR t.outservice_date IS NOT NULL)`,
    trailers: `
    SELECT
      LTRIM(RTRIM(r.id))                           AS external_id,
      LTRIM(RTRIM(r.company_id))                   AS company_id,
      CONVERT(varchar(10), r.outservice_date, 23)  AS out_of_service_at
      FROM dbo.trailer AS r
     WHERE r.company_id = @companyId
       AND (r.is_active <> 'A' OR r.outservice_date IS NOT NULL)`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Settled movements — the cost-per-mile fact (C1, docs/plans/mcleod/MCLEOD-CPM-DATA-SOURCE-SPEC.md)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A settled movement, with the equipment attribution CPM divides cost by.
 *
 * Five things here are not obvious from the schema, and every one of them was measured against the
 * carrier's sandbox on 2026-08-26. Each would produce a wrong number rather than an error:
 *
 *  · **`movement` has no tractor column.** `carrier_tractor` looks like one and is not — it names a
 *    purchased-transportation carrier's unit. The company truck is reached through
 *    `equipment_group_id` → `equipment_item` where `equipment_type_id = 'T'`. Reading the wrong one
 *    attributes a brokered load's cost to a truck the carrier does not own.
 *  · **Drivers are not 1:1 with a movement.** 'T' (tractor, 196 units) and 'L' (trailer, 217) appear
 *    exactly once per movement, but 'D' (driver, 260) appears TWICE on 176 movements because the
 *    carrier runs teams. Joining drivers the same way as tractors emits those movements twice and
 *    double-counts their miles, so drivers are aggregated to a delimited list instead of joined.
 *  · **`status = 'V'` is a VOID movement** — 41 of 21,547 in 2026. They are excluded here for the
 *    same reason settlement carries `is_void` (D-MC18): a voided trip's miles were never run. Since
 *    D-FIN5 the status is SWEPT rather than filtered, and the API reader excludes V.
 *  · **`move_distance` is LOADED miles only** (D-MC15). McLeod stores no empty miles anywhere; both
 *    manifest distance columns and `pay_distance` sum to exactly zero across the whole year. The name
 *    the agent sends is `loaded_miles`, never `total_miles`, so nothing downstream can assume the
 *    ~4-5% of deadhead is already in there.
 *  · **The window is bounded on `xfer2settle_date` and never derived from a MAX()** (D-MC14).
 *    `stop.actual_departure` reaches 2215-03-12 — McLeod writes far-future sentinels for unset dates,
 *    so a high-watermark taken from the data walks past every real row and the sync goes quiet forever.
 */
export const MOVEMENT_FACTS = `
    SELECT
      LTRIM(RTRIM(m.id))                            AS external_id,
      LTRIM(RTRIM(m.company_id))                    AS company_id,
      NULLIF(LTRIM(RTRIM(tr.equipment_id)), '')     AS tractor_unit,
      NULLIF(LTRIM(RTRIM(tl.equipment_id)), '')     AS trailer_unit,
      -- Comma-joined rather than a second row: see the team-driver note above.
      STUFF((
        SELECT ',' + LTRIM(RTRIM(d.equipment_id))
          FROM dbo.equipment_item AS d
         WHERE d.equipment_group_id = m.equipment_group_id
           AND d.equipment_type_id = 'D'
         ORDER BY d.type_sequence
         FOR XML PATH('')), 1, 1, '')               AS driver_external_ids,
      STUFF((
        SELECT ',' + LTRIM(RTRIM(mo.order_id))
          FROM dbo.movement_order AS mo
         WHERE mo.movement_id = m.id
         ORDER BY mo.sequence
         FOR XML PATH('')), 1, 1, '')               AS order_ids,
      m.move_distance                               AS loaded_miles,
      m.fuel_distance                               AS fuel_miles,
      NULLIF(LTRIM(RTRIM(m.move_distance_um)), '')  AS distance_unit,
      NULLIF(LTRIM(RTRIM(m.status)), '')            AS external_status,
      NULLIF(LTRIM(RTRIM(m.movement_type)), '')     AS movement_type,
      CONVERT(varchar(19), m.xfer2settle_date, 126) AS settled_at
      FROM dbo.movement AS m
      LEFT JOIN dbo.equipment_item AS tr
        ON tr.equipment_group_id = m.equipment_group_id AND tr.equipment_type_id = 'T'
      LEFT JOIN dbo.equipment_item AS tl
        ON tl.equipment_group_id = m.equipment_group_id AND tl.equipment_type_id = 'L'
     WHERE m.company_id = @companyId
       -- status travels as external_status (V = voided) rather than filtering here (D-FIN5): a trip
       -- voided after its first sweep must reach the store as voided, not linger as run.
       AND m.xfer2settle_date >= @windowStart
       AND m.xfer2settle_date <  @windowEnd
     ORDER BY m.xfer2settle_date, m.id`;

/**
 * The stops of the movements in the same window.
 *
 * Fetched as a second flat query rather than a join, so a ten-stop movement does not repeat its
 * mileage ten times on the wire and invite exactly the double-count the driver aggregation above
 * avoids. The agent stitches them back together by `movement_id`.
 *
 * Coordinates are selected without a NULL guard on purpose: all 46,384 stops in 2026 carry them, the
 * neutral contract requires them, and deadhead inference is impossible without them (D-MC16). A stop
 * that arrives without one should fail validation loudly rather than silently shorten a chain.
 *
 * `stop_type` is McLeod's: 'PU' pickup, 'SO' delivery, and a small tail of 'VA'/'SD'/'SP'/'VP' the
 * agent maps to 'other'. Distance books almost entirely on the delivery — 10,713,860 miles across
 * 23,373 'SO' stops against 14,112 across 22,404 'PU' — which is what makes summing these reproduce
 * movement.move_distance to within a mile on 95.4% of movements.
 */
export const MOVEMENT_STOPS = `
    SELECT
      LTRIM(RTRIM(s.movement_id))                   AS movement_id,
      s.movement_sequence                           AS seq,
      LTRIM(RTRIM(s.stop_type))                     AS stop_type,
      NULLIF(LTRIM(RTRIM(s.city_name)), '')         AS city,
      NULLIF(LTRIM(RTRIM(s.state)), '')             AS state,
      s.latitude                                    AS lat,
      s.longitude                                   AS lon,
      CONVERT(varchar(19), s.actual_arrival, 126)   AS arrived_at,
      CONVERT(varchar(19), s.actual_departure, 126) AS departed_at,
      s.move_dist_from_previous                     AS distance_from_previous
      FROM dbo.stop AS s
      JOIN dbo.movement AS m ON m.id = s.movement_id
     WHERE s.company_id = @companyId
       AND m.company_id = @companyId
       AND m.xfer2settle_date >= @windowStart
       AND m.xfer2settle_date <  @windowEnd
     ORDER BY s.movement_id, s.movement_sequence`;

/**
 * The dry-run summary: what a window contains, before any of it is sent anywhere.
 *
 * `loaded_miles` here is the number a human should recognise. If it does not match what the carrier's
 * own operations report says for the same window, the extraction is wrong and nothing downstream of it
 * is worth debugging.
 */
export const MOVEMENT_FACT_COUNTS = `
    SELECT
      COUNT(*)                                        AS movements,
      COUNT(DISTINCT tr.equipment_id)                 AS tractors,
      SUM(CASE WHEN tr.equipment_id IS NULL THEN 1 ELSE 0 END) AS without_tractor,
      CAST(SUM(ISNULL(m.move_distance, 0)) AS decimal(18,1)) AS loaded_miles,
      CAST(SUM(ISNULL(m.fuel_distance, 0)) AS decimal(18,1)) AS fuel_miles
      FROM dbo.movement AS m
      LEFT JOIN dbo.equipment_item AS tr
        ON tr.equipment_group_id = m.equipment_group_id AND tr.equipment_type_id = 'T'
     WHERE m.company_id = @companyId
       AND m.status <> 'V'
       AND m.xfer2settle_date >= @windowStart
       AND m.xfer2settle_date <  @windowEnd`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Fuel and payables — C2 (docs/plans/mcleod/MCLEOD-CPM-DATA-SOURCE-SPEC.md §5.2, §5.4)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The live/history union, and why every query below is written twice.
 *
 * McLeod moves a completed record out of its working table into a `_hist` twin. The working tables are
 * therefore nearly empty at rest — `fuel_detail` holds 3 rows against `fuel_detail_hist`'s 65,847, and
 * `voucher` holds 11 against `voucher_hist`'s 88,736. A 2026-08-24 audit read only the live tables and
 * concluded this carrier does not use McLeod for fuel at all; the conclusion was wrong and is struck
 * through in `docs/plans/MCLEOD-SQL-SOURCE-OF-TRUTH.md` (D-MC11).
 *
 * ⚠ The two halves are NOT the same shape. Verified 2026-08-26: `fuel_detail_hist` has 212 columns to
 * `fuel_detail`'s 209, `voucher_hist` 43 to `voucher`'s 36. The extra columns are exactly the posting
 * fields — `post_key`, `post_module`, `posted_payee_id` — because a row acquires them at the moment it
 * posts, which is the moment it moves to history. So `SELECT *` would fail outright, and selecting
 * `post_key` from the live half is impossible: the union below supplies NULL for it instead, and a
 * live row simply does not reconcile yet, which is the truth.
 */

/**
 * Fuel purchases, with the equipment attribution the general ledger does not carry.
 *
 * `settled_amount` is the only figure here that reconciles, and it is not `total_amount`. McLeod
 * records gross, then the negotiated card discount (14.6% of gross in June 2026 — not a rounding
 * error), then the net under one of two columns depending on how the purchase was funded:
 * `direct_amount` on 1,904 of June's 2,259 rows and `funded_amount` on the other 355. Exactly one is
 * non-zero per row. Summed, they reproduce the GL payable to the cent: $1,011,039.24 + $6,562.57 =
 * $1,017,601.81, against account 20550000's $1,017,601.81. `total_amount` would overstate by $173,528
 * in that month alone.
 *
 * Gallons and costs come across split — tractor, reefer, DEF, oil, misc — and are never pre-summed.
 * Reefer gallons burn in a trailer and DEF is an emissions consumable; only the tractor figure belongs
 * in a truck's miles per gallon.
 */
export const FUEL_PURCHASES = `
    SELECT
      LTRIM(RTRIM(f.id))                            AS external_id,
      LTRIM(RTRIM(f.company_id))                    AS company_id,
      NULLIF(LTRIM(RTRIM(f.tractor_id)), '')        AS tractor_unit,
      NULLIF(LTRIM(RTRIM(f.driver_id)), '')         AS driver_external_id,
      NULLIF(LTRIM(RTRIM(f.movement_id)), '')       AS movement_external_id,
      NULLIF(LTRIM(RTRIM(f.order_id)), '')          AS order_external_id,
      CONVERT(varchar(19), f.trans_date_time, 126)  AS purchased_at,
      NULLIF(LTRIM(RTRIM(f.truck_stop_state)), '')  AS state,
      NULLIF(LTRIM(RTRIM(f.truck_stop_name)), '')   AS truck_stop_name,
      NULLIF(LTRIM(RTRIM(f.truck_stop_city)), '')   AS truck_stop_city,
      NULLIF(LTRIM(RTRIM(f.fuel_card_id)), '')      AS card_id,
      f.tractor_gals                                AS gal_tractor,
      f.reefer_gals                                 AS gal_reefer,
      f.def_gals                                    AS gal_def,
      f.other_gals                                  AS gal_other,
      f.tractor_cost                                AS cost_tractor,
      f.reefer_cost                                 AS cost_reefer,
      f.def_cost                                    AS cost_def,
      f.oil_cost                                    AS cost_oil,
      f.misc_cost                                   AS cost_misc,
      f.sales_tax                                   AS cost_sales_tax,
      f.transaction_fee                             AS cost_transaction_fee,
      f.total_amount                                AS total_amount,
      f.fuel_discount                               AS fuel_discount,
      f.direct_amount                               AS direct_amount,
      f.funded_amount                               AS funded_amount,
      LTRIM(RTRIM(f.post_key))                      AS post_key,
      LTRIM(RTRIM(f.post_module))                   AS post_module
      FROM dbo.fuel_detail_hist AS f
     WHERE f.company_id = @companyId
       AND f.trans_date_time >= @windowStart
       AND f.trans_date_time <  @windowEnd
    UNION ALL
    SELECT
      LTRIM(RTRIM(f.id)), LTRIM(RTRIM(f.company_id)),
      NULLIF(LTRIM(RTRIM(f.tractor_id)), ''), NULLIF(LTRIM(RTRIM(f.driver_id)), ''),
      NULLIF(LTRIM(RTRIM(f.movement_id)), ''), NULLIF(LTRIM(RTRIM(f.order_id)), ''),
      CONVERT(varchar(19), f.trans_date_time, 126),
      NULLIF(LTRIM(RTRIM(f.truck_stop_state)), ''), NULLIF(LTRIM(RTRIM(f.truck_stop_name)), ''),
      NULLIF(LTRIM(RTRIM(f.truck_stop_city)), ''), NULLIF(LTRIM(RTRIM(f.fuel_card_id)), ''),
      f.tractor_gals, f.reefer_gals, f.def_gals, f.other_gals,
      f.tractor_cost, f.reefer_cost, f.def_cost, f.oil_cost, f.misc_cost,
      f.sales_tax, f.transaction_fee, f.total_amount, f.fuel_discount,
      f.direct_amount, f.funded_amount,
      -- Not yet posted, so it has no ledger key and cannot reconcile. NULL says that honestly;
      -- the live table does not have these columns at all.
      NULL, NULL
      FROM dbo.fuel_detail AS f
     WHERE f.company_id = @companyId
       AND f.trans_date_time >= @windowStart
       AND f.trans_date_time <  @windowEnd`;

/**
 * The ledger lines those purchases posted to, for `reconcileFuelToLedger`.
 *
 * Restricted to `post_module = 'FUEL'` and the window's own keys. Deliberately NOT filtered to the
 * payable account here — the shared reconciler applies that, so a caller can see the whole
 * double-entry picture and a second carrier can point at a different chart of accounts without a
 * change to this SQL.
 */
export const FUEL_LEDGER_LINES = `
    SELECT
      LTRIM(RTRIM(g.post_key))  AS post_key,
      LTRIM(RTRIM(g.glid))      AS glid,
      g.amount                  AS amount
      FROM dbo.gl_ledger AS g
     WHERE g.company_id = @companyId
       AND g.post_module = 'FUEL'
       AND g.post_key IN (
         SELECT LTRIM(RTRIM(f.post_key)) FROM dbo.fuel_detail_hist AS f
          WHERE f.company_id = @companyId
            AND f.trans_date_time >= @windowStart
            AND f.trans_date_time <  @windowEnd)`;

/**
 * Accounts-payable vouchers — the carrier's unattributed spend.
 *
 * No tractor and no movement exist on this table; `purchase_order_no` is its only operational link.
 * `voucher_dist` has `tractor` and `trailer` columns and populates them on 0 of 397 rows, so that is
 * not a way round it either. This is the honest state of the source and the reason the CPM harness
 * owns allocation (D-MC12).
 *
 * ⚠ **`voucher_type <> 'P'` is load-bearing, not tidying.** This table stores each voucher as an
 * offsetting PAIR — a 'D' or 'R' row carrying the expense and a 'P' row carrying the payment that
 * cancels it. Summing the table naively returns exactly $0.00, which looks like an empty result rather
 * than a bug, and an earlier draft of this query reported precisely that for 366 June rows. Excluding
 * the payment leg leaves the expense, and keeps credit memos (the negative 'R' rows) so a refund still
 * reduces cost.
 *
 * ⚠ **These rows INCLUDE fuel, and fuel is extracted separately.** The fuel-card vendor invoices the
 * carrier for the same purchases `FUEL_PURCHASES` already returns: 59 of June 2026's 183 expense rows,
 * totalling $1,017,601.81 — the identical figure `fuel_detail`'s direct+funded amounts and GL account
 * 20550000 both produce, to the cent. Adding payables to fuel would count 70% of the month's payables
 * twice. `expenses.mjs` splits them on vendor and the CPM figure excludes the fuel vendor; the vendor
 * id is configuration, because a carrier that changes fuel-card provider must not silently start
 * double-counting.
 *
 * `void_date IS NULL` for the same reason settlement used to exclude `is_void` and movements status
 * 'V': a voided voucher is money that was never paid, and counting it inflates cost. It stays a
 * filter here until `mcleod_ap_vouchers` carries a void column (F5b, FINANCE-GO-LIVE-PLAN).
 *
 * ONE ECONOMIC DATE (D-FIN7). The window is on `COALESCE(distribution_date, invoice_date)` — the GL
 * posting date, falling back to the invoice date for a voucher not yet distributed — and the API
 * reads and projects on exactly the same expression. Until 2026-09-03 the sweep windowed on
 * invoice_date and the projection on distribution_date, so a voucher whose distribution fell
 * outside the projection window but inside the sweep was staged and never projected until a manual
 * full run. COALESCE defeats the invoice_date index; voucher_hist is 88k rows and voucher a few
 * hundred, so the scan is cheap, and correctness of the window is worth more than the seek.
 */
export const AP_VOUCHERS = `
    SELECT
      LTRIM(RTRIM(v.id))                            AS external_id,
      LTRIM(RTRIM(v.company_id))                    AS company_id,
      v.voucher_no                                  AS voucher_no,
      NULLIF(LTRIM(RTRIM(v.voucher_type)), '')      AS voucher_type,
      NULLIF(LTRIM(RTRIM(v.vendor_id)), '')         AS vendor_id,
      NULLIF(LTRIM(RTRIM(v.invoice_number)), '')    AS invoice_number,
      NULLIF(LTRIM(RTRIM(v.purchase_order_no)), '') AS purchase_order_no,
      NULLIF(LTRIM(RTRIM(v.descr1)), '')            AS description,
      CONVERT(varchar(19), v.invoice_date, 126)     AS invoice_date,
      CONVERT(varchar(19), v.due_date, 126)         AS due_date,
      CONVERT(varchar(19), v.distribution_date, 126) AS distribution_date,
      v.amount                                      AS amount,
      v.discount_amount                             AS discount_amount,
      NULLIF(LTRIM(RTRIM(v.ap_glid)), '')           AS ap_glid,
      v.is_paid                                     AS is_paid,
      NULLIF(LTRIM(RTRIM(v.check_number)), '')      AS check_number,
      LTRIM(RTRIM(v.post_key))                      AS post_key,
      LTRIM(RTRIM(v.post_module))                   AS post_module
      FROM dbo.voucher_hist AS v
     WHERE v.company_id = @companyId
       AND v.void_date IS NULL
       AND v.voucher_type <> 'P'
       AND COALESCE(v.distribution_date, v.invoice_date) >= @windowStart
       AND COALESCE(v.distribution_date, v.invoice_date) <  @windowEnd
    UNION ALL
    -- The live half is thinner than the history half by EIGHT columns, not the three that
    -- fuel_detail differs by: is_paid, payment_method, post_key, post_module, posted_payment_no,
    -- recur_voucher_id, void_date and voucher_no all arrive only when the voucher posts. An earlier
    -- draft of this query filtered the live half on void_date IS NULL and selected is_paid and
    -- voucher_no, and SQL Server rejected all three outright — which is the good outcome. The bad
    -- outcome was available too: had these been merely NULL rather than absent, the live rows would
    -- have been silently dropped by the void filter and nobody would have seen it.
    --
    -- There is no void filter here because an unposted voucher cannot have been voided yet, and
    -- is_paid is asserted 'N' rather than guessed: a voucher still in the working table has not paid.
    SELECT
      LTRIM(RTRIM(v.id)), LTRIM(RTRIM(v.company_id)), NULL,
      NULLIF(LTRIM(RTRIM(v.voucher_type)), ''), NULLIF(LTRIM(RTRIM(v.vendor_id)), ''),
      NULLIF(LTRIM(RTRIM(v.invoice_number)), ''), NULLIF(LTRIM(RTRIM(v.purchase_order_no)), ''),
      NULLIF(LTRIM(RTRIM(v.descr1)), ''),
      CONVERT(varchar(19), v.invoice_date, 126), CONVERT(varchar(19), v.due_date, 126),
      CONVERT(varchar(19), v.distribution_date, 126),
      v.amount, v.discount_amount, NULLIF(LTRIM(RTRIM(v.ap_glid)), ''),
      'N', NULLIF(LTRIM(RTRIM(v.check_number)), ''),
      NULL, NULL
      FROM dbo.voucher AS v
     WHERE v.company_id = @companyId
       AND v.voucher_type <> 'P'
       AND COALESCE(v.distribution_date, v.invoice_date) >= @windowStart
       AND COALESCE(v.distribution_date, v.invoice_date) <  @windowEnd`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Settlement — C3 (docs/plans/mcleod/MCLEOD-CPM-DATA-SOURCE-SPEC.md §5.3)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Driver and owner-operator settlement, windowed on the ACCRUAL date.
 *
 * Five decisions here, every one of which changes the number rather than raising an error:
 *
 *  · **`is_void`, carried as a column since D-FIN5 (it was a filter).** 909 of June 2026's 3,363 rows are voided and carry $335,846.70 of pay that
 *    never happened. The 21 date columns on this table do NOT discriminate — it is a history table, so
 *    every row has completed its whole lifecycle and every stage is populated. `is_void` is the only
 *    thing that separates money paid from money reversed (D-MC18).
 *  · **Windowed on `accrual_date`, not `pay_date`.** The accrual is when the work happened and the
 *    cost was incurred; the payment is cash timing (D-MC19). Windowing on pay date and reconciling
 *    against the accrual ledger compares two different months and misses by roughly $135,000.
 *  · **Both `total_pay` and `orig_posted_pay` are sent.** They are not the same figure. `total_pay` is
 *    what the payee received and what cost per mile should use; `orig_posted_pay` is what the ledger
 *    recorded at accrual and the only thing that reconciles. June 2026: $1,268,565.31 against
 *    $1,262,893.74, the gap being post-accrual adjustments on owner-operator rows.
 *  · **`accrual_key` AND `post_key`.** `accrual_module` is 'SET' and `post_module` is 'DRS' on every
 *    row — one payment, two GL modules. The reconciliation joins the accrual side, which posts
 *    exactly one payable line per settlement; the payment side fans out across cash and clearing
 *    accounts and cannot be matched one to one.
 *  · **No live/`_hist` union.** `drs_settle` does not exist — unlike fuel and vouchers, this domain has
 *    a history table only. D-MC11 does not apply here and its absence is not a bug to be fixed.
 */
export const SETTLEMENTS = `
    SELECT
      LTRIM(RTRIM(s.id))                            AS external_id,
      LTRIM(RTRIM(s.company_id))                    AS company_id,
      NULLIF(LTRIM(RTRIM(s.tractor_id)), '')        AS tractor_unit,
      NULLIF(LTRIM(RTRIM(s.trailer_id)), '')        AS trailer_unit,
      NULLIF(LTRIM(RTRIM(s.driver_id)), '')         AS driver_external_id,
      NULLIF(LTRIM(RTRIM(s.movement_id)), '')       AS movement_external_id,
      NULLIF(LTRIM(RTRIM(s.order_id)), '')          AS order_external_id,
      NULLIF(LTRIM(RTRIM(s.payee_id)), '')          AS payee_id,
      LTRIM(RTRIM(s.payee_type))                    AS payee_type,
      NULLIF(LTRIM(RTRIM(s.pay_method)), '')        AS pay_method,
      CONVERT(varchar(19), s.accrual_date, 126)     AS accrued_at,
      CONVERT(varchar(19), s.pay_date, 126)         AS paid_at,
      CONVERT(varchar(19), s.transfer_date, 126)    AS transferred_at,
      s.total_pay                                   AS total_pay,
      s.orig_posted_pay                             AS posted_pay,
      s.pay_distance                                AS pay_distance,
      LTRIM(RTRIM(s.accrual_key))                   AS accrual_key,
      LTRIM(RTRIM(s.post_key))                      AS post_key,
      -- Voids are SWEPT with their flag, not filtered (D-FIN5): a row voided after its first sweep
      -- used to keep its live copy in the store forever. The store marks it; readers exclude it.
      CASE WHEN s.is_void = 'Y' THEN 1 ELSE 0 END      AS is_void
      FROM dbo.drs_settle_hist AS s
     WHERE s.company_id = @companyId
       AND s.accrual_date >= @windowStart
       AND s.accrual_date <  @windowEnd`;

/**
 * The accrual-side ledger lines for `reconcileSettlementToLedger`.
 *
 * The GL side carries its OWN date bound, deliberately wider than the settlement window. Two reasons:
 * a settlement accrued on the last day of the window can post a day or two later, so a bound equal to
 * the window would drop real lines and fail an exact reconciliation; and without any date bound at
 * all the optimiser abandons the `transaction_date` index and scans 733k rows — the first version of
 * this query timed out at four minutes. The padding is a fortnight either side, which comfortably
 * covers observed posting lag while keeping the scan bounded.
 */
export const SETTLEMENT_LEDGER_LINES = `
    SELECT
      LTRIM(RTRIM(g.post_key))  AS post_key,
      LTRIM(RTRIM(g.glid))      AS glid,
      g.amount                  AS amount
      FROM dbo.gl_ledger AS g
     WHERE g.company_id = @companyId
       AND g.post_module = 'SET'
       AND g.transaction_date >= DATEADD(day, -14, CONVERT(datetime, @windowStart))
       AND g.transaction_date <  DATEADD(day,  14, CONVERT(datetime, @windowEnd))
       AND g.post_key IN (
         SELECT LTRIM(RTRIM(s.accrual_key)) FROM dbo.drs_settle_hist AS s
          WHERE s.company_id = @companyId
            AND s.is_void = 'N'
            AND s.accrual_date >= @windowStart
            AND s.accrual_date <  @windowEnd)`;

/**
 * Deductions taken out of settlements — escrow, insurance, advances, equipment rent.
 *
 * A separate sweep rather than a column on the settlement, because a deduction is money moving the
 * other way and carries its OWN void state: a settlement can stand while one of its deductions is
 * reversed. June 2026 has 344 voided deduction rows against 1,342 live ones, and folding the two
 * together would net a reversal against an unrelated charge.
 *
 * Attribution is partial and stays that way. 317 of June's 699 live type-'D' rows carry a tractor;
 * the rest are payee-level and belong to the harness's allocation, not to a guess made here.
 */
export const SETTLEMENT_DEDUCTIONS = `
    SELECT
      LTRIM(RTRIM(d.id))                            AS external_id,
      LTRIM(RTRIM(d.company_id))                    AS company_id,
      NULLIF(LTRIM(RTRIM(d.payee_id)), '')          AS payee_id,
      LTRIM(RTRIM(d.payee_type))                    AS payee_type,
      NULLIF(LTRIM(RTRIM(d.tractor_id)), '')        AS tractor_unit,
      NULLIF(LTRIM(RTRIM(d.deduct_code_id)), '')    AS deduct_code,
      NULLIF(LTRIM(RTRIM(d.deduction_type)), '')    AS deduction_type,
      CONVERT(varchar(19), d.transaction_date, 126) AS transacted_at,
      d.amount                                      AS amount,
      -- The account is what tells an EARNING from a REPAYMENT from a cost RECOVERY; the deduct code
      -- cannot, and guessing from the code would be an attribution we invented (0274's header).
      NULLIF(LTRIM(RTRIM(d.glid)), '')              AS glid,
      LTRIM(RTRIM(d.accrual_key))                   AS accrual_key,
      CASE WHEN d.is_void = 'Y' THEN 1 ELSE 0 END      AS is_void   -- swept, not filtered (D-FIN5)
      FROM dbo.drs_deduct_hist AS d
     WHERE d.company_id = @companyId
       AND d.transaction_date >= @windowStart
       AND d.transaction_date <  @windowEnd`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// General-ledger control totals — C4 (docs/plans/mcleod/MCLEOD-CPM-DATA-SOURCE-SPEC.md §3, D-MC12)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Every ledger line in a window, summarised by DATE, posting module and account.
 *
 * **The date is in the GROUP BY since W1 (D-FLEET9).** It was not, and that was the collector making
 * a reporting decision: `transaction_date` is on every line McLeod holds, so the monthly grain the
 * report used was ours, not the source's, and every later question about a different period became a
 * schema change instead of a different SUM. The sweep still fetches a calendar month whole — that is
 * the unit the carrier's close uses — but what lands is the day rows, and the month is their sum.
 *
 * `CAST(... AS date)` before the grouping, not after: `transaction_date` is a datetime in McLeod and
 * grouping on it raw would mint a row per timestamp rather than per day. The projection is ISO
 * (`style 23`) so the wire carries `YYYY-MM-DD` and nothing downstream has to parse a locale.
 *
 * This is the ONLY thing FuelGuard reads the general ledger for. Under D-MC12 the GL is a control
 * total, never an input to attribution — the carrier populates `gl_ledger.tractor` on 0 of 188,179
 * lines, so there is no cost-per-truck to be had here. What it can do is prove the subledger
 * extractions are complete: if `FUEL` says the carrier spent more than `FUEL_PURCHASES` returned,
 * rows are missing, and that is a question only the books can answer.
 *
 * Two things about the live/`_hist` split here differ from fuel and vouchers:
 *
 *  · **The date ranges are disjoint, not overlapping.** `gl_ledger` runs 2024-01-01 to 2026-08-14 and
 *    `gl_ledger_hist` runs 2016-01-01 to 2023-12-31 — this is a year-end archive, not the
 *    working/completed split that moves a fuel row the moment it posts. A 2026 window touches only
 *    the live table, and the union exists so that a historical window still works.
 *  · **The two tables differ by a RENAME**, not by added columns: the free-text note is `gl_comments`
 *    live and `comments` in history. Neither is selected — a ledger summary has no business carrying
 *    an operator's free text — but a future reader adding it must alias both sides.
 *
 * `SUM(ABS(amount))/2` is the one-sided value of a module. Double-entry means every posting appears
 * twice, once as a debit and once as a credit, so the signed sum of any complete module is zero and
 * the absolute sum is exactly twice the money that moved. Reporting the signed sum would show $0.00
 * for a month in which the carrier spent millions.
 */
export const GL_CONTROL_TOTALS = `
    SELECT
      CONVERT(char(10), combined.transaction_date, 23)   AS txn_date,
      LTRIM(RTRIM(post_module))                          AS post_module,
      LTRIM(RTRIM(glid))                                 AS glid,
      COUNT(*)                                           AS lines,
      SUM(amount)                                        AS net_amount,
      SUM(ABS(amount))                                   AS abs_amount
      FROM (
        SELECT g.post_module, g.glid, g.amount, CAST(g.transaction_date AS date) AS transaction_date
          FROM dbo.gl_ledger AS g
         WHERE g.company_id = @companyId
           AND g.transaction_date >= @windowStart
           AND g.transaction_date <  @windowEnd
        UNION ALL
        SELECT g.post_module, g.glid, g.amount, CAST(g.transaction_date AS date) AS transaction_date
          FROM dbo.gl_ledger_hist AS g
         WHERE g.company_id = @companyId
           AND g.transaction_date >= @windowStart
           AND g.transaction_date <  @windowEnd
      ) AS combined
     GROUP BY combined.transaction_date, LTRIM(RTRIM(post_module)), LTRIM(RTRIM(glid))`;

/**
 * The office-settlement module, which has no subledger at all.
 *
 * `OFF` is $3.2M a year and was named in the original scope as "office settlements". It turns out to
 * be office payroll, bonuses and staff reimbursements posted STRAIGHT TO THE LEDGER — there is no
 * `drs_`-style detail table behind it, and the only description of any line is `descr`, a 40-character
 * free-text field reading like "ARKADZIO, Office Payroll" or "BIGRIG, Towing (truck # 506) reimbur".
 *
 * So this query returns the description. It is the exception to the rule above, and it is deliberate:
 * for every other module the subledger carries the meaning and the GL carries only the total, but here
 * the GL line IS the record. Note the truck numbers embedded in that free text — the same pattern that
 * puts repair vouchers in accounts payable. Parsing them is not attempted here; a unit number scraped
 * out of an abbreviated, 40-character-truncated note is a guess, and D-MC12 forbids the extraction
 * layer from inventing an attribution McLeod does not assert itself.
 */
export const OFFICE_SETTLEMENT_LINES = `
    SELECT
      LTRIM(RTRIM(g.id))                            AS external_id,
      LTRIM(RTRIM(g.glid))                          AS glid,
      LTRIM(RTRIM(g.descr))                         AS descr,
      NULLIF(LTRIM(RTRIM(g.payee_id)), '')          AS payee_id,
      CONVERT(varchar(19), g.transaction_date, 126) AS transacted_at,
      g.amount                                      AS amount
      FROM dbo.gl_ledger AS g
     WHERE g.company_id = @companyId
       AND g.post_module = 'OFF'
       AND g.transaction_date >= @windowStart
       AND g.transaction_date <  @windowEnd
    UNION ALL
    -- The history half. D-MC11 / the live-vs-_hist trap: gl_ledger holds 732,530 rows against
    -- gl_ledger_hist's 1,767,734, and a reading that takes only the live table has already produced
    -- one wrong conclusion at this carrier. This query read the live half alone until 2026-08-28,
    -- which was survivable while its only consumer was a coverage REPORT and is not now that the
    -- rows are staged and a page divides by them.
    SELECT
      LTRIM(RTRIM(g.id)),
      LTRIM(RTRIM(g.glid)),
      LTRIM(RTRIM(g.descr)),
      NULLIF(LTRIM(RTRIM(g.payee_id)), ''),
      CONVERT(varchar(19), g.transaction_date, 126),
      g.amount
      FROM dbo.gl_ledger_hist AS g
     WHERE g.company_id = @companyId
       AND g.post_module = 'OFF'
       AND g.transaction_date >= @windowStart
       AND g.transaction_date <  @windowEnd`;

/** A cheap liveness + scoping check: the row counts the three predicates select. */
export const ROSTER_COUNTS = `
    SELECT 'drivers'  AS entity, COUNT(*) AS n FROM dbo.driver  WHERE company_id = @companyId AND is_active = 'Y'
    UNION ALL
    SELECT 'vehicles', COUNT(*) FROM dbo.tractor WHERE company_id = @companyId AND service_status = 'A' AND outservice_date IS NULL
    UNION ALL
    SELECT 'trailers', COUNT(*) FROM dbo.trailer WHERE company_id = @companyId AND is_active = 'A' AND outservice_date IS NULL`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Billing — P3.3, the earnings side (unblocked by recon F1/F2, answered 2026-08-27)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Invoiced revenue as billed — the only money table in McLeod that names its truck AND its driver
 * (F1 confirmed tractor_id, trailer_id, driver_id; trailer2_id exists for doubles and is not taken
 * until a consumer exists for it). One table, no live/_hist split: billing_history IS the history.
 *
 * Every column here was ANSWERED by recon F1 on 2026-08-27, never guessed — the trailer-type
 * near-miss is what guessing costs. `excisetax_total` is McLeod's name; the neutral contract calls
 * it excise_tax. The `_c/_d/_n/_r` companion columns F1 also surfaced are multi-currency /
 * rate-audit satellites of their base column and are deliberately not extracted.
 *
 * ⚠ NO void filter yet, on purpose: F1 surfaced `canceled` and `rebilled` flags whose vocabulary
 * recon F3 measures but has not yet answered (the VPN window closed first). Both flags are
 * therefore EXTRACTED so the dry-run summary can show the cross-tab with dollars, and the posting
 * step stays OFF until the predicate is chosen from that evidence — a canceled invoice imported as
 * revenue overstates every report it touches. The sweep windows on bill_date: the economic date,
 * same posture as vouchers on invoice_date (D-FS6); the backfill covers what a rolling window
 * misses of late entry.
 */
export const BILLING_HISTORY = `
    SELECT
      LTRIM(RTRIM(b.id))                             AS external_id,
      LTRIM(RTRIM(b.company_id))                     AS company_id,
      b.invoice_no                                   AS invoice_no,
      NULLIF(LTRIM(RTRIM(b.customer_id)), '')        AS customer_id,
      NULLIF(LTRIM(RTRIM(b.order_id)), '')           AS order_external_id,
      NULLIF(LTRIM(RTRIM(b.master_order_id)), '')    AS master_order_id,
      NULLIF(LTRIM(RTRIM(b.tractor_id)), '')         AS tractor_unit,
      NULLIF(LTRIM(RTRIM(b.trailer_id)), '')         AS trailer_unit,
      NULLIF(LTRIM(RTRIM(b.driver_id)), '')          AS driver_external_id,
      CONVERT(varchar(19), b.bill_date, 126)         AS bill_date,
      CONVERT(varchar(19), b.ship_date, 126)         AS ship_date,
      CONVERT(varchar(19), b.delivery_date, 126)     AS delivery_date,
      CONVERT(varchar(19), b.transfer_date, 126)     AS transfer_date,
      b.total_charges                                AS total_charges,
      b.other_charge                                 AS other_charge,
      b.excisetax_total                              AS excise_tax,
      -- Both of these are EMPTY at this carrier (0 of 1,640 June bills) and are staged anyway,
      -- because what McLeod asserts here is "nothing" and that is worth recording. The plain
      -- distance column is the one that is filled (1,614 of 1,640, 1,513,720 June miles) and is
      -- the denominator for dispatcher revenue per mile and for weekly proration (0275).
      b.billing_loaded_distance                      AS billing_loaded_distance,
      b.billing_empty_distance                       AS billing_empty_distance,
      b.distance                                     AS distance,
      NULLIF(LTRIM(RTRIM(b.canceled)), '')           AS canceled,
      NULLIF(LTRIM(RTRIM(b.rebilled)), '')           AS rebilled,
      LTRIM(RTRIM(b.post_key))                       AS post_key,
      LTRIM(RTRIM(b.post_module))                    AS post_module,
      -- The dispatcher who booked the load. LEFT JOINs on purpose: a bill whose order carries no
      -- operations user is a fact about the carrier's data entry, and the reports show it as its
      -- own "(unassigned)" bucket rather than dropping the money.
      --
      -- Both joins are 1:1 and were measured before being written (0273's header): all 1,640 June
      -- bills resolve to a name and the revenue total is unchanged by the join. The alternative
      -- route to a dispatcher, movement.dispatcher_user_id via movement_order, FANS OUT — the same
      -- 1,640 bills become 3,408 rows and $5,490,961.97 becomes $11,486,355.54. That is why this
      -- reads the ORDER's operations user and never the movement's dispatcher.
      NULLIF(LTRIM(RTRIM(ord.operations_user)), '')  AS dispatcher_user_id,
      NULLIF(LTRIM(RTRIM(usr.name)), '')             AS dispatcher_name
      FROM dbo.billing_history AS b
      LEFT JOIN dbo.orders AS ord
             ON ord.company_id = b.company_id
            AND ord.id         = b.order_id
      LEFT JOIN dbo.users AS usr
             ON usr.company_id = b.company_id
            AND usr.id         = ord.operations_user
     WHERE b.company_id = @companyId
       AND b.bill_date >= @windowStart
       AND b.bill_date <  @windowEnd`;

/**
 * The chart of accounts — glid, name, and McLeod's OWN classification (`type_id`: "Revenue",
 * "Operating Expenses", …). Swept whole with every --financial pass (123 rows measured
 * 2026-08-28, recon F9/F10): the GL month totals are unreadable as an income statement without
 * it, and the fleet-truth check on the CPM page is exactly that reading.
 */
export const GL_ACCOUNTS = `
    SELECT
      LTRIM(RTRIM(a.id))                       AS glid,
      NULLIF(LTRIM(RTRIM(a.descr)), '')        AS descr,
      NULLIF(LTRIM(RTRIM(a.type_id)), '')      AS type_id
      FROM dbo.gl_account AS a
     WHERE a.company_id = @companyId`;
