/* ======================================================================================
   Silvicom 360 connector - every statement it runs against LME (database: lme)
   ======================================================================================

   Alex - this is the file my letter refers to. It holds every statement our connector runs,
   word for word, in the order and with the settings it uses. It is plain T-SQL: open it in
   SSMS and run it, and you will get back the rows we get. Run it as an administrator: under
   our own login it stops at Part 4 with a permission error until the finance grants exist.

   This file is produced from our connector's code, so it cannot drift from what actually runs;
   if anything in it ever changes, we will send you the new file before the change goes live.

   The short version:
     login        silvicom_dispatch_ro - read only, no insert/update/delete anywhere
     runs on      the Board VM, one program, one connection, sending data OUT to us over HTTPS
     shows up as  program_name "Silvicom 360 connector" in sys.dm_exec_sessions
     statements   24, in five parts, never two at the same time

   Thanks,
   Miki
   ====================================================================================== */

-- ========================================================================================
-- SESSION SETTINGS - our connector sends these ahead of EVERY statement, and adds
-- OPTION (MAXDOP 1) on its own line after every statement (you will see it below each one).
-- It also stops any statement that runs longer than 15 seconds, and pauses for 15 minutes
-- after three timeouts in a row.
-- ========================================================================================
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;                          -- if a row is busy we give up after 5 s; your users never wait on us
SET DEADLOCK_PRIORITY LOW;                      -- if SQL Server has to choose, it cancels us
SET TRANSACTION ISOLATION LEVEL READ COMMITTED; -- never READ UNCOMMITTED / NOLOCK

-- Parameters. The connector passes these as typed parameters, never pasted into the SQL text.
-- They are declared here only so the file runs on its own.
DECLARE @companyId   varchar(32) = 'TMS';
DECLARE @staleBefore datetime    = DATEADD(day, -30, GETDATE());
DECLARE @windowStart varchar(32) = CONVERT(varchar(10), DATEADD(day, -75, GETDATE()), 23);
DECLARE @windowEnd   varchar(32) = CONVERT(varchar(10), DATEADD(day, 1, GETDATE()), 23);
DECLARE @id0         varchar(32) = '291013';
DECLARE @id1         varchar(32) = '290837';
DECLARE @id2         varchar(32) = '291386';

-- ========================================================================================
-- PART 1 - OPEN LOADS (every minute)
--
-- The loads your dispatchers are working right now, with their stops and dispatchers. About
-- 160 loads and 335 stops at a time. Measured on APPNEW: about 32 ms of CPU for all three.
-- ========================================================================================

-- ----------------------------------------------------------------------------------------
-- STATEMENT 1 of 24: OPEN LOADS
--
-- Movements with status P or A that have a stop scheduled in the last 30 days.
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(m.company_id)) + ':' + LTRIM(RTRIM(m.id))  AS external_id,
      NULLIF(LTRIM(RTRIM(o.id)), '')                         AS ref,
      NULLIF(LTRIM(RTRIM(o.blnum)), '')                      AS bol_number,
      NULLIF(LTRIM(RTRIM(m.dispatcher_user_id)), '')         AS dispatcher_external_id,
      NULLIF(LTRIM(RTRIM(u.name)), '')                       AS dispatcher_name,
      -- Teams: aggregated, never joined. A LEFT JOIN here duplicates 176 movements.
      STUFF((
        SELECT ',' + LTRIM(RTRIM(cd.equipment_id))
          FROM dbo.continuity AS cd
         WHERE cd.movement_id = m.id
           AND cd.company_id = m.company_id
           AND cd.equipment_type_id = 'D'
         ORDER BY cd.equipment_id
         FOR XML PATH('')), 1, 1, '')                        AS driver_codes,
      NULLIF(LTRIM(RTRIM(ct.equipment_id)), '')              AS vehicle_unit,
      NULLIF(LTRIM(RTRIM(cl.equipment_id)), '')              AS trailer_unit,
      NULLIF(LTRIM(RTRIM(tr.trailer_type)), '')              AS trailer_type,
      NULLIF(LTRIM(RTRIM(o.commodity)), '')                  AS commodity,
      m.move_distance                                        AS total_miles,
      NULLIF(LTRIM(RTRIM(m.status)), '')                     AS external_status
      FROM dbo.movement AS m
      LEFT JOIN dbo.users AS u
        ON u.id = m.dispatcher_user_id AND u.company_id = m.company_id
      LEFT JOIN dbo.movement_order AS mo
        ON mo.movement_id = m.id AND mo.company_id = m.company_id
      LEFT JOIN dbo.orders AS o
        ON o.id = mo.order_id AND o.company_id = mo.company_id
      LEFT JOIN dbo.continuity AS ct
        ON ct.movement_id = m.id AND ct.company_id = m.company_id AND ct.equipment_type_id = 'T'
      LEFT JOIN dbo.continuity AS cl
        ON cl.movement_id = m.id AND cl.company_id = m.company_id AND cl.equipment_type_id = 'L'
      LEFT JOIN dbo.trailer AS tr
        ON tr.id = cl.equipment_id AND tr.company_id = m.company_id
     WHERE m.company_id = @companyId
       AND m.status IN ('P', 'A')
       AND EXISTS (
         SELECT 1 FROM dbo.stop AS sb
          WHERE sb.movement_id = m.id
            AND sb.company_id = m.company_id
            AND sb.sched_arrive_early >= @staleBefore)
     ORDER BY m.id
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 2 of 24: THE STOPS OF THOSE LOADS
--
-- Your longitudes are stored as positive numbers; we flip the sign on our side.
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(s.movement_id))                     AS movement_id,
      s.movement_sequence                             AS seq,
      LTRIM(RTRIM(s.stop_type))                       AS stop_type,
      NULLIF(LTRIM(RTRIM(s.location_id)), '')         AS location_id,
      NULLIF(LTRIM(RTRIM(s.city_name)), '')           AS city,
      NULLIF(LTRIM(RTRIM(s.state)), '')               AS state,
      NULLIF(LTRIM(RTRIM(s.address)), '')             AS address_line,
      NULLIF(LTRIM(RTRIM(s.zip_code)), '')            AS postal_code,
      s.latitude                                      AS lat,
      s.longitude                                     AS lon_west_positive,
      CONVERT(varchar(19), s.sched_arrive_early, 126) AS appointment_start,
      CONVERT(varchar(19), s.sched_arrive_late, 126)  AS appointment_end,
      NULLIF(LTRIM(RTRIM(s.status)), '')              AS stop_status
      FROM dbo.stop AS s
      JOIN dbo.movement AS m
        ON m.id = s.movement_id AND m.company_id = s.company_id
     WHERE s.company_id = @companyId
       AND m.status IN ('P', 'A')
       AND EXISTS (
         SELECT 1 FROM dbo.stop AS sb
          WHERE sb.movement_id = m.id
            AND sb.company_id = m.company_id
            AND sb.sched_arrive_early >= @staleBefore)
     ORDER BY s.movement_id, s.movement_sequence
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 3 of 24: THE DISPATCHERS ON THOSE LOADS
--
-- Only users who have an open load right now, not the whole users table.
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(u.id))                AS external_id,
      NULLIF(LTRIM(RTRIM(u.name)), '')  AS display_name,
      CASE WHEN LTRIM(RTRIM(ISNULL(u.is_active, ''))) = 'Y' THEN 1 ELSE 0 END AS is_active
      FROM dbo.users AS u
     WHERE u.company_id = @companyId
       AND EXISTS (
         SELECT 1 FROM dbo.movement AS m
          WHERE m.dispatcher_user_id = u.id
            AND m.company_id = u.company_id
            AND m.status IN ('P', 'A'))
     ORDER BY u.id
OPTION (MAXDOP 1);

-- ========================================================================================
-- PART 2 - CLOSING LOADS (every 10 minutes)
--
-- Loads we still have open on our side but that have left your open board. We ask for their
-- current state by movement id, so we see a delivery (D) or a void (V) because you recorded it,
-- never because a load went missing. At most 300 ids per statement, each one a typed parameter.
-- The ids below are examples so the file runs; measured with 300 ids: under 16 ms CPU, 3 ms.
-- ========================================================================================

-- ----------------------------------------------------------------------------------------
-- STATEMENT 4 of 24: CURRENT STATE OF LOADS THAT LEFT THE BOARD
--
-- Same columns as statement 1, looked up by id.
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(m.company_id)) + ':' + LTRIM(RTRIM(m.id))  AS external_id,
      NULLIF(LTRIM(RTRIM(o.id)), '')                         AS ref,
      NULLIF(LTRIM(RTRIM(o.blnum)), '')                      AS bol_number,
      NULLIF(LTRIM(RTRIM(m.dispatcher_user_id)), '')         AS dispatcher_external_id,
      NULLIF(LTRIM(RTRIM(u.name)), '')                       AS dispatcher_name,
      -- Teams: aggregated, never joined. A LEFT JOIN here duplicates 176 movements.
      STUFF((
        SELECT ',' + LTRIM(RTRIM(cd.equipment_id))
          FROM dbo.continuity AS cd
         WHERE cd.movement_id = m.id
           AND cd.company_id = m.company_id
           AND cd.equipment_type_id = 'D'
         ORDER BY cd.equipment_id
         FOR XML PATH('')), 1, 1, '')                        AS driver_codes,
      NULLIF(LTRIM(RTRIM(ct.equipment_id)), '')              AS vehicle_unit,
      NULLIF(LTRIM(RTRIM(cl.equipment_id)), '')              AS trailer_unit,
      NULLIF(LTRIM(RTRIM(tr.trailer_type)), '')              AS trailer_type,
      NULLIF(LTRIM(RTRIM(o.commodity)), '')                  AS commodity,
      m.move_distance                                        AS total_miles,
      NULLIF(LTRIM(RTRIM(m.status)), '')                     AS external_status
      FROM dbo.movement AS m
      LEFT JOIN dbo.users AS u
        ON u.id = m.dispatcher_user_id AND u.company_id = m.company_id
      LEFT JOIN dbo.movement_order AS mo
        ON mo.movement_id = m.id AND mo.company_id = m.company_id
      LEFT JOIN dbo.orders AS o
        ON o.id = mo.order_id AND o.company_id = mo.company_id
      LEFT JOIN dbo.continuity AS ct
        ON ct.movement_id = m.id AND ct.company_id = m.company_id AND ct.equipment_type_id = 'T'
      LEFT JOIN dbo.continuity AS cl
        ON cl.movement_id = m.id AND cl.company_id = m.company_id AND cl.equipment_type_id = 'L'
      LEFT JOIN dbo.trailer AS tr
        ON tr.id = cl.equipment_id AND tr.company_id = m.company_id
     WHERE m.company_id = @companyId
       AND m.id IN (@id0, @id1, @id2)
     ORDER BY m.id
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 5 of 24: THEIR STOPS
--
-- Same columns as statement 2.
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(s.movement_id))                     AS movement_id,
      s.movement_sequence                             AS seq,
      LTRIM(RTRIM(s.stop_type))                       AS stop_type,
      NULLIF(LTRIM(RTRIM(s.location_id)), '')         AS location_id,
      NULLIF(LTRIM(RTRIM(s.city_name)), '')           AS city,
      NULLIF(LTRIM(RTRIM(s.state)), '')               AS state,
      NULLIF(LTRIM(RTRIM(s.address)), '')             AS address_line,
      NULLIF(LTRIM(RTRIM(s.zip_code)), '')            AS postal_code,
      s.latitude                                      AS lat,
      s.longitude                                     AS lon_west_positive,
      CONVERT(varchar(19), s.sched_arrive_early, 126) AS appointment_start,
      CONVERT(varchar(19), s.sched_arrive_late, 126)  AS appointment_end,
      NULLIF(LTRIM(RTRIM(s.status)), '')              AS stop_status
      FROM dbo.stop AS s
      JOIN dbo.movement AS m
        ON m.id = s.movement_id AND m.company_id = s.company_id
     WHERE s.company_id = @companyId
       AND m.id IN (@id0, @id1, @id2)
     ORDER BY s.movement_id, s.movement_sequence
OPTION (MAXDOP 1);

-- ========================================================================================
-- PART 3 - DRIVERS, TRUCKS AND TRAILERS (every 15 minutes)
--
-- Keeps our driver, truck and trailer lists matching yours. Under 16 ms of CPU for all three.
-- Today this runs from my laptop every 2 minutes; on the VM it slows to every 15.
-- ========================================================================================

-- ----------------------------------------------------------------------------------------
-- STATEMENT 6 of 24: ACTIVE DRIVERS
--
-- Names, licence and medical card expiry, hire date and address. We read the driver's
-- email from name_of_spouse, because that is where your team keeps it.
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(d.id))                         AS external_id,
      LTRIM(RTRIM(d.company_id))                 AS company_id,
      NULLIF(LTRIM(RTRIM(d.license_no)), '')     AS cdl_number,
      NULLIF(LTRIM(RTRIM(d.license_state)), '')  AS cdl_state,
      NULLIF(LTRIM(RTRIM(d.first_name)), '')     AS first_name,
      NULLIF(LTRIM(RTRIM(d.name_mid_initial)), '') AS middle_name,
      NULLIF(LTRIM(RTRIM(d.name)), '')           AS last_name,
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
      NULLIF(LTRIM(RTRIM(d.name_of_spouse)), '') AS email_raw
      FROM dbo.driver AS d
     WHERE d.company_id = @companyId
       AND d.is_active = 'Y'
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 7 of 24: ACTIVE TRUCKS
--
-- Tractors that are in service, including the ones in the shop.
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(t.id))                         AS external_id,
      LTRIM(RTRIM(t.company_id))                 AS company_id,
      NULLIF(LTRIM(RTRIM(t.serial_number)), '')  AS vin,
      LTRIM(RTRIM(t.id))                         AS unit_number,
      NULLIF(LTRIM(RTRIM(t.make)), '')           AS make,
      NULLIF(LTRIM(RTRIM(t.model)), '')          AS model,
      NULLIF(LTRIM(RTRIM(t.model_year)), '')     AS model_year,
      NULLIF(LTRIM(RTRIM(t.tag)), '')            AS plate,
      NULLIF(LTRIM(RTRIM(t.tag_state)), '')      AS plate_state,
      CONVERT(varchar(10), t.tag_expire_date, 23)  AS registration_expires_at,
      CONVERT(varchar(10), t.inspection_date, 23)  AS annual_inspection_performed_at,
      CONVERT(varchar(10), t.purchase_date, 23)    AS purchased_at,
      -- An OPERATIONAL sub-status, and never membership (D-FC9). Read here only so roster.mjs can
      -- turn 'S' into the neutral in_shop flag the wire contract carries; the letter itself stops
      -- there, like every other McLeod spelling in this file. (No backticks in this comment: it
      -- lives inside a JS template literal, and one ended a sweep in silence on 2026-08-28.)
      -- Distribution within P4, 2026-09-22:
      -- A 148 · V 16 · I 15 · S 12 · null 2. The S reading is the owner's and is corroborated by
      -- behaviour rather than by a labelfile this login can reach (§1.3, assumption A1, Q-2).
      NULLIF(LTRIM(RTRIM(t.tractor_status)), '')   AS tractor_status
      FROM dbo.tractor AS t
     WHERE t.company_id = @companyId
       AND t.service_status = 'A'
       AND (t.purchase_date IS NOT NULL OR NULLIF(LTRIM(RTRIM(t.model_year)), '') IS NOT NULL)
       AND NULLIF(LTRIM(RTRIM(t.serial_number)), '') IS NOT NULL
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 8 of 24: ACTIVE TRAILERS
--
-- Trailers that are in service.
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(r.id))                         AS external_id,
      LTRIM(RTRIM(r.company_id))                 AS company_id,
      NULLIF(LTRIM(RTRIM(r.serial_number)), '')  AS vin,
      LTRIM(RTRIM(r.id))                         AS unit_number,
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
      r.axles                                      AS axle_count
      FROM dbo.trailer AS r
     WHERE r.company_id = @companyId
       AND r.is_active = 'A'
       AND NULLIF(LTRIM(RTRIM(r.serial_number)), '') IS NOT NULL
       -- Sandbox-only fixture trailers are not carrier equipment and must never enter the roster.
       AND LTRIM(RTRIM(r.id)) NOT LIKE 'TEST%'
       AND LTRIM(RTRIM(r.id)) <> 'TSTROMAN'
OPTION (MAXDOP 1);

-- ========================================================================================
-- PART 4 - FINANCE (every night at 2:00 AM Central, plus a wider pass on the first days of each month)
--
-- A rolling 75-day window of settlements, deductions, AP vouchers, fuel, movements, billing and
-- the general ledger. Statements 20 and 21 run once for the window and once more for each
-- calendar month it touches (three or four), so a night is 19 to 21 statements. Measured on the
-- analytics copy: about 10 seconds of CPU for the whole night, on one core. These need the
-- finance grants in section 6 of my letter; until then this part fails with a permission error
-- under our login.
-- ========================================================================================

-- ----------------------------------------------------------------------------------------
-- STATEMENT 9 of 24: DRIVER SETTLEMENTS
-- ----------------------------------------------------------------------------------------
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
       AND s.accrual_date <  @windowEnd
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 10 of 24: SETTLEMENT LEDGER LINES
-- ----------------------------------------------------------------------------------------
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
            AND s.accrual_date <  @windowEnd)
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 11 of 24: SETTLEMENT DEDUCTIONS
-- ----------------------------------------------------------------------------------------
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
       AND d.transaction_date <  @windowEnd
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 12 of 24: FUEL PURCHASES
-- ----------------------------------------------------------------------------------------
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
       AND f.trans_date_time <  @windowEnd
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 13 of 24: FUEL LEDGER LINES
-- ----------------------------------------------------------------------------------------
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
            AND f.trans_date_time <  @windowEnd)
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 14 of 24: AP VOUCHERS
-- ----------------------------------------------------------------------------------------
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
       AND COALESCE(v.distribution_date, v.invoice_date) <  @windowEnd
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 15 of 24: SETTLED MOVEMENTS
--
-- Every lookup is matched on company_id as well as the id (fixed 2026-09-24).
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(m.id))                            AS external_id,
      LTRIM(RTRIM(m.company_id))                    AS company_id,
      NULLIF(LTRIM(RTRIM(tr.equipment_id)), '')     AS tractor_unit,
      NULLIF(LTRIM(RTRIM(tl.equipment_id)), '')     AS trailer_unit,
      -- Comma-joined rather than a second row: see the team-driver note above.
      STUFF((
        SELECT ',' + LTRIM(RTRIM(d.equipment_id))
          FROM dbo.equipment_item AS d
         WHERE d.company_id = m.company_id
           AND d.equipment_group_id = m.equipment_group_id
           AND d.equipment_type_id = 'D'
         ORDER BY d.type_sequence
         FOR XML PATH('')), 1, 1, '')               AS driver_external_ids,
      STUFF((
        SELECT ',' + LTRIM(RTRIM(mo.order_id))
          FROM dbo.movement_order AS mo
         WHERE mo.company_id = m.company_id
           AND mo.movement_id = m.id
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
        ON tr.company_id = m.company_id AND tr.equipment_group_id = m.equipment_group_id AND tr.equipment_type_id = 'T'
      LEFT JOIN dbo.equipment_item AS tl
        ON tl.company_id = m.company_id AND tl.equipment_group_id = m.equipment_group_id AND tl.equipment_type_id = 'L'
     WHERE m.company_id = @companyId
       -- status travels as external_status (V = voided) rather than filtering here (D-FIN5): a trip
       -- voided after its first sweep must reach the store as voided, not linger as run.
       AND m.xfer2settle_date >= @windowStart
       AND m.xfer2settle_date <  @windowEnd
     ORDER BY m.xfer2settle_date, m.id
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 16 of 24: STOPS OF THOSE MOVEMENTS
-- ----------------------------------------------------------------------------------------
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
     ORDER BY s.movement_id, s.movement_sequence
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 17 of 24: MOVEMENT TOTALS, TO CHECK THE ROWS ABOVE
-- ----------------------------------------------------------------------------------------
SELECT
      COUNT(*)                                        AS movements,
      COUNT(DISTINCT tr.equipment_id)                 AS tractors,
      SUM(CASE WHEN tr.equipment_id IS NULL THEN 1 ELSE 0 END) AS without_tractor,
      CAST(SUM(ISNULL(m.move_distance, 0)) AS decimal(18,1)) AS loaded_miles,
      CAST(SUM(ISNULL(m.fuel_distance, 0)) AS decimal(18,1)) AS fuel_miles
      FROM dbo.movement AS m
      LEFT JOIN dbo.equipment_item AS tr
        ON tr.company_id = m.company_id AND tr.equipment_group_id = m.equipment_group_id AND tr.equipment_type_id = 'T'
     WHERE m.company_id = @companyId
       AND m.status <> 'V'
       AND m.xfer2settle_date >= @windowStart
       AND m.xfer2settle_date <  @windowEnd
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 18 of 24: BILLING HISTORY
-- ----------------------------------------------------------------------------------------
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
       AND b.bill_date <  @windowEnd
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 19 of 24: CHART OF ACCOUNTS
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(a.id))                       AS glid,
      NULLIF(LTRIM(RTRIM(a.descr)), '')        AS descr,
      NULLIF(LTRIM(RTRIM(a.type_id)), '')      AS type_id
      FROM dbo.gl_account AS a
     WHERE a.company_id = @companyId
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 20 of 24: GENERAL LEDGER TOTALS BY DAY AND ACCOUNT
-- ----------------------------------------------------------------------------------------
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
     GROUP BY combined.transaction_date, LTRIM(RTRIM(post_module)), LTRIM(RTRIM(glid))
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 21 of 24: OFFICE PAYROLL LINES
-- ----------------------------------------------------------------------------------------
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
       AND g.transaction_date <  @windowEnd
OPTION (MAXDOP 1);

-- ========================================================================================
-- PART 5 - WHO HAS LEFT (by hand only, never on a timer)
--
-- Drivers, trucks and trailers you have marked inactive. We run these when we clean up our lists.
-- ========================================================================================

-- ----------------------------------------------------------------------------------------
-- STATEMENT 22 of 24: INACTIVE DRIVERS
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(d.id))                           AS external_id,
      LTRIM(RTRIM(d.company_id))                   AS company_id,
      d.is_active                                  AS is_active,
      CONVERT(varchar(10), d.termination_date, 23) AS termination_date
      FROM dbo.driver AS d
     WHERE d.company_id = @companyId
       AND (d.is_active <> 'Y' OR d.is_active IS NULL)
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 23 of 24: RETIRED TRUCKS
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(t.id))                           AS external_id,
      LTRIM(RTRIM(t.company_id))                   AS company_id,
      CONVERT(varchar(10), t.outservice_date, 23)  AS out_of_service_at
      FROM dbo.tractor AS t
     WHERE t.company_id = @companyId
       AND t.service_status <> 'A'
OPTION (MAXDOP 1);

-- ----------------------------------------------------------------------------------------
-- STATEMENT 24 of 24: RETIRED TRAILERS
-- ----------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(r.id))                           AS external_id,
      LTRIM(RTRIM(r.company_id))                   AS company_id,
      CONVERT(varchar(10), r.outservice_date, 23)  AS out_of_service_at
      FROM dbo.trailer AS r
     WHERE r.company_id = @companyId
       AND r.is_active <> 'A'
OPTION (MAXDOP 1);

-- ========================================================================================
-- END - 24 statements. That is everything the connector reads.
-- ========================================================================================
