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
 *    same reason `is_void` is excluded from settlement (D-MC18): a voided trip's miles were never run.
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
       AND m.status <> 'V'
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
       AND m.status <> 'V'
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

/** A cheap liveness + scoping check: the row counts the three predicates select. */
export const ROSTER_COUNTS = `
    SELECT 'drivers'  AS entity, COUNT(*) AS n FROM dbo.driver  WHERE company_id = @companyId AND is_active = 'Y'
    UNION ALL
    SELECT 'vehicles', COUNT(*) FROM dbo.tractor WHERE company_id = @companyId AND service_status = 'A' AND outservice_date IS NULL
    UNION ALL
    SELECT 'trailers', COUNT(*) FROM dbo.trailer WHERE company_id = @companyId AND is_active = 'A' AND outservice_date IS NULL`;
