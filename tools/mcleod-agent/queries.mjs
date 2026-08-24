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
      NULLIF(LTRIM(RTRIM(d.zip)), '')            AS postal_code`;

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
      CONVERT(varchar(10), t.inspection_date, 23)  AS annual_inspection_performed_at`;

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
      NULLIF(LTRIM(RTRIM(r.license_state)), '')  AS plate_state`;

/**
 * Build the three roster queries. `mode` is 'link' (match keys only) or 'identity' (match keys plus the
 * fields M4 writes) — the column list itself changes, which is what keeps PII out of the link-only phase.
 */
export function rosterQueries(mode = "link") {
  const full = mode === "identity";
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

/** A cheap liveness + scoping check: the row counts the three predicates select. */
export const ROSTER_COUNTS = `
    SELECT 'drivers'  AS entity, COUNT(*) AS n FROM dbo.driver  WHERE company_id = @companyId AND is_active = 'Y'
    UNION ALL
    SELECT 'vehicles', COUNT(*) FROM dbo.tractor WHERE company_id = @companyId AND service_status = 'A' AND outservice_date IS NULL
    UNION ALL
    SELECT 'trailers', COUNT(*) FROM dbo.trailer WHERE company_id = @companyId AND is_active = 'A' AND outservice_date IS NULL`;
