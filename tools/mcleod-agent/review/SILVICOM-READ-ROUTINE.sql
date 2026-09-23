/* =====================================================================================
   Silvicom 360 - everything our connector runs against LME (database: lme)
   =====================================================================================

   Hi Alex,

   As promised, here is the routine for you to look over before we schedule anything
   against the live database. These are the statements our connector runs, exactly as it
   runs them - the file is plain T-SQL, so you can open it in SSMS and execute it
   yourself. You will get back the same rows we see.

   It has three parts:
     PART 1  the loads feed - statements 1-4, the one we would like to schedule.
     PART 2  the roster sync - statements 5-7. Drivers, trucks and trailers, so our people
             and equipment lists match yours.
     PART 3  three "who has left" statements - 8-10, run by hand, never on a timer.
   That is everything we read with this login.

   THE SHORT VERSION
     login      silvicom_dispatch_ro - it can only read. It has no permission to insert,
                update or delete anything.
     database   lme
     how to     our connection names itself "Silvicom 360 connector", so you can find it in
     spot us    sys.dm_exec_sessions (program_name) or Activity Monitor at any time.
     where      our connector runs inside YOUR network (on the Board VM, once it is set
                up) and sends what it reads OUT to us over HTTPS. Nothing of ours ever
                connects in to your server, so you do not need to open a firewall port or
                keep an IP allow-list for us.
     how often  loads: we would like to start at once every 10 minutes, and only move
                towards once a minute if it turns out to be worth it.
                roster: every 2 minutes today (from my laptop in your office); we can slow
                it down to whatever you prefer.

   HOW MUCH LOAD THIS PUTS ON YOUR SERVER
     We measured it on your server (SET STATISTICS TIME, median of 5 runs):
     loads, statements 1-4 (2026-09-17)   16 ms CPU   /  26 ms elapsed  /  514 rows
     roster, statements 5-7 (2026-09-23)  too small to register  /  7 ms elapsed  /  581 rows
     loads per day, even at once a minute     23 CPU-seconds
     as a share of this 42-core box           0.0006 %
     added request rate                       3 requests/minute = 0.036 % of your ~138/sec
                                              baseline

   WHAT WE WILL NEVER DO
     - Write anything. The login cannot, and we would not want it to.
     - Use NOLOCK / READ UNCOMMITTED. At these speeds the queries do not need it, and we
       would rather wait a moment than read a half-written row.
     - Hold a transaction open, take locks we do not need, or run anything unbounded.
     - Read driver.social_security_no. It is not in our grant and we do not want it.

   HOW WE STAY OUT OF YOUR DISPATCHERS' WAY
     READ_COMMITTED_SNAPSHOT is off on this database, so a long-running read could make
     your users wait. That is why everything below is short and targeted. LOCK_TIMEOUT
     means that if a row is busy, our query gives up after 5 seconds instead of making
     anyone wait on us. DEADLOCK_PRIORITY LOW means that if SQL Server ever has to choose
     between us and one of your users, it always picks us to cancel.

     To be straight with you: the roster sync running from my laptop today does not set
     these three session settings yet, and does not add MAXDOP 1. Its three statements take
     7 ms, so it has not mattered in practice, but we are adding them before anything moves
     to the Board VM, and the scheduled connector will not run without them.

   A FEW QUESTIONS WE COULD NOT ANSWER FROM THE DATA
     1. Stop types. Almost every stop is PU or SO. The rest, from our reading of the data:
          SD / SP   853 of each, always the same order on two different movements - we
                    read these as a split: the trailer is dropped (SD) at a yard such as
                    Melrose Park or Floyd's Truck Center, and a second movement picks it up
                    (SP). Is that right?
          VA / VP   1,441 and 17. Mostly on the Viking Packing dealer runs, and 512 of the
                    last year's 638 VA stops are at a SAIA terminal, sitting between two
                    dealer deliveries - for example movement 291475: Columbia MO, then SAIA
                    Toledo (VA), Monroe MI, SAIA Romulus (VA), Center Line, SAIA Warren (VA),
                    Washington MI. The arrival on 586 of those 633 VA stops is exactly the
                    departure time of the stop before, so it looks like nobody records a
                    real arrival there.
          VN        2 ever, the last in 2021.
        Does the truck physically stop at the SAIA terminal - to hand over or collect LTL
        freight, for instance - or is VA/VP a routing point for mileage? And what is the
        difference between VA and VP? Right now we leave all of these out rather than guess,
        so movement 291475 shows only 5 of its 8 stops on our side. We do not want to guess
        wrong: treating a routing stop as a delivery would ask the driver for a bill of
        lading that does not exist.
     2. Movement status. We are reading A as "available / not covered yet" and P as
        "dispatched / in progress" (with D delivered and V void). The A loads have no
        dispatcher or trailer yet, so that seems to fit. Can you confirm we have it right?
     3. Encryption. When we tried an encrypted connection, the SQL Server offered its own
        self-signed certificate, so today we connect without encryption. Which of these
        works best for you?
          a) you install a trusted certificate on the SQL Server and give us the hostname
             it is issued for,
          b) we encrypt the connection but accept the current self-signed certificate, or
          c) we stay unencrypted, since once we are on the Board VM the traffic never
             leaves your network.
        We would lean towards (a) or (b), but it is your call.
     4. Dispatcher fleets. We believe tractor.fleet_id is each dispatcher's fleet: on the
        114 dispatched loads we checked on 2026-09-23, the truck's fleet matched the
        dispatcher on the load on 95 of the 97 that a person dispatched (the other two are
        Marija's, on trucks in Miro's fleet). tractor.dispatcher matched on only 70, and is
        often blank. Three things to confirm:
          a) Is fleet_id the right field, and is it kept up to date when a truck moves to
             another dispatcher?
          b) The fleet codes are not always the login - ROMAN is romann, IVO is ivok. Is
             that mapping stored anywhere in LME that we could be given read access to, or
             should we keep it on our side?
          c) 17 of the loads are dispatched by "loadmaster" (McLeod Administrator). Are
             those created automatically - EDI, for example - and is the truck's fleet the
             right way to find the real dispatcher for them?
        If fleet_id is right, we do not need driver.fleet_manager or driver.tractor_id,
        which were in our original request, so please leave the driver grant as it is.

   And thank you for correcting the grant script and setting all of this up. If you would
   like any statement below changed, capped differently or removed, just tell me and we
   will change it before anything is scheduled.

   Thanks,
   Miki
   ===================================================================================== */

-- =======================================================================================
-- PART 1 - THE LOADS FEED
-- =======================================================================================

-- ---------------------------------------------------------------------------------------
-- SESSION SETTINGS - set once, on the single connection we keep open.
-- ---------------------------------------------------------------------------------------
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;                          -- give up after 5 s instead of making anyone wait.
SET DEADLOCK_PRIORITY LOW;                      -- if SQL Server has to pick, it cancels us.
SET TRANSACTION ISOLATION LEVEL READ COMMITTED; -- never READ UNCOMMITTED / NOLOCK.

-- Parameters. Our connector passes these as typed parameters (VarChar/DateTime), never
-- pasted into the SQL text. They are declared here only so the file runs on its own.
DECLARE @companyId  varchar(32) = 'TMS';
DECLARE @staleBefore datetime   = DATEADD(day, -30, GETDATE());

-- ---------------------------------------------------------------------------------------
-- STATEMENT 1 of 10: WHAT CHANGED SINCE LAST TIME
--
-- Asks Change Tracking which movements changed since our last read. It reads the change
-- tracking side tables, not movement itself, so it does not get in anyone's way.
-- @sinceVersion is the version we saved at the end of the previous run. On the first run,
-- or if we have been away longer than your 10-day retention, we do a full re-read
-- instead of guessing.
-- ---------------------------------------------------------------------------------------
DECLARE @sinceVersion bigint = CHANGE_TRACKING_CURRENT_VERSION() - 1000;  -- illustrative

SELECT ct.company_id, ct.id, ct.SYS_CHANGE_OPERATION
  FROM CHANGETABLE(CHANGES dbo.movement, @sinceVersion) AS ct
 WHERE ct.company_id = @companyId
OPTION (MAXDOP 1);

-- ---------------------------------------------------------------------------------------
-- STATEMENT 2 of 10: THE OPEN LOADS
--
-- The loads your dispatchers are working right now: movement status P or A, with at least
-- one stop scheduled in the last 30 days. The 30-day limit keeps out one very old
-- movement (from 2015) that is still marked P. Team drivers are combined into one field, so a
-- two-driver load comes back as one row, not two.
-- ---------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------
-- STATEMENT 3 of 10: THE STOPS OF THOSE LOADS
--
-- The same loads, one row per stop. Your longitudes are stored as positive numbers, so we
-- read them as they are and flip the sign on our side.
-- ---------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------
-- STATEMENT 4 of 10: THE DISPATCHERS ON THOSE LOADS
--
-- Only the users who actually have an open load, not the whole users table. We use this
-- short list to match each of your dispatchers to their login on our side.
-- ---------------------------------------------------------------------------------------
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

-- =======================================================================================
-- PART 2 - THE ROSTER SYNC
--
-- Same login, same session settings as above. It keeps our driver, truck and trailer lists
-- matching yours. Today it runs from my laptop in your office every 2 minutes; it moves to the
-- Board VM together with the loads connector.
--
-- Measured on your server on 2026-09-23 (SET STATISTICS TIME, median of 5 runs): statements 5-7
-- together take 7 ms elapsed for 581 rows, and their CPU time is below what SQL Server's timer
-- can show. The comments inside the statements are our own developer notes, left exactly as
-- they are in our code, so you are reading the text we actually send.
-- =======================================================================================

-- ---------------------------------------------------------------------------------------
-- STATEMENT 5 of 10: ACTIVE DRIVERS
--
-- Drivers with is_active = 'Y'. This is where our driver list gets names, licence and medical
-- card expiry dates, hire date and address. We read the driver's email from name_of_spouse,
-- because that is where your team keeps it (driver.email is empty on every row).
-- ---------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------
-- STATEMENT 6 of 10: ACTIVE TRUCKS
--
-- Tractors with service_status = 'A' that carry a VIN and a purchase date or model year, so
-- unit numbers reserved for trucks not yet delivered stay out.
-- ---------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------
-- STATEMENT 7 of 10: ACTIVE TRAILERS
--
-- Trailers with is_active = 'A' that carry a VIN, minus the test trailers.
-- ---------------------------------------------------------------------------------------
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

-- =======================================================================================
-- PART 3 - WHO HAS LEFT (run by hand, not on a schedule)
--
-- When somebody leaves or a unit is sold, we mark it on our side from these three statements.
-- They return only the ID, the status and the date - no names, no addresses. We run them by hand
-- when we need to, never on a timer. Measured the same way: 7 ms elapsed for all three.
-- =======================================================================================

-- ---------------------------------------------------------------------------------------
-- STATEMENT 8 of 10: DRIVERS NO LONGER ACTIVE
--
-- ---------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(d.id))                           AS external_id,
      LTRIM(RTRIM(d.company_id))                   AS company_id,
      d.is_active                                  AS is_active,
      CONVERT(varchar(10), d.termination_date, 23) AS termination_date
      FROM dbo.driver AS d
     WHERE d.company_id = @companyId
       AND (d.is_active <> 'Y' OR d.is_active IS NULL)
OPTION (MAXDOP 1);

-- ---------------------------------------------------------------------------------------
-- STATEMENT 9 of 10: TRUCKS OUT OF SERVICE
--
-- ---------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(t.id))                           AS external_id,
      LTRIM(RTRIM(t.company_id))                   AS company_id,
      CONVERT(varchar(10), t.outservice_date, 23)  AS out_of_service_at
      FROM dbo.tractor AS t
     WHERE t.company_id = @companyId
       AND t.service_status <> 'A'
OPTION (MAXDOP 1);

-- ---------------------------------------------------------------------------------------
-- STATEMENT 10 of 10: TRAILERS OUT OF SERVICE
--
-- ---------------------------------------------------------------------------------------
SELECT
      LTRIM(RTRIM(r.id))                           AS external_id,
      LTRIM(RTRIM(r.company_id))                   AS company_id,
      CONVERT(varchar(10), r.outservice_date, 23)  AS out_of_service_at
      FROM dbo.trailer AS r
     WHERE r.company_id = @companyId
       AND r.is_active <> 'A'
OPTION (MAXDOP 1);

-- ---------------------------------------------------------------------------------------
-- That is everything we run against lme. Any questions or changes, just let me know.
-- ---------------------------------------------------------------------------------------
