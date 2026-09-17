/* =====================================================================================
   Silvicom 360 - the complete read routine against LME (database: lme)
   =====================================================================================

   FOR REVIEW. This file is everything we run against your production server. There is no
   other statement, no stored procedure, no agent job and no scheduled task beyond what is
   written below. You can open it, read it, and run it yourself - it is valid T-SQL as it
   stands and it returns the same rows our connector sees.

   WHO / WHAT / WHERE
     login      silvicom_dispatch_ro   (SELECT + VIEW CHANGE TRACKING only - no write anywhere)
     database   lme
     host       our connector runs on YOUR network. It opens an OUTBOUND HTTPS connection to
                us. Nothing of ours connects inbound to your server, and no firewall rule or
                IP allow-list is required from you.
     cadence    every 60 seconds (we will start at 10 minutes and tighten only if it earns it)

   WHAT IT COSTS YOU - measured on your own server, 2026-09-17, SET STATISTICS TIME, median of 5
     all four statements together      16 ms CPU   /  26 ms elapsed  /  514 rows
     per day at a 60-second cadence    23 CPU-seconds
     as a share of this 42-core box    0.0006 %
     added request rate                3 requests/minute = 0.036 % of your ~138/sec baseline

   WHAT WE WILL NEVER DO
     - never write. The login has no INSERT, UPDATE or DELETE permission on any object.
     - never NOLOCK / READ UNCOMMITTED. A dirty read reaching a financial figure is worse
       than a query that waits, and at 16 ms these are far too short to need it.
     - never hold a transaction open, never take a lock we could avoid, never run unbounded.
     - never read driver.social_security_no. It is not in our grant and we do not want it.

   HOW WE STAY OUT OF YOUR WRITERS' WAY
     READ_COMMITTED_SNAPSHOT is OFF on this database, so a long read blocks your writers.
     Everything below is therefore short, keyed and capped. LOCK_TIMEOUT means WE give up
     rather than make one of your dispatchers wait; DEADLOCK_PRIORITY LOW means if the server
     must break a tie, it always breaks it against us.

   QUESTIONS FOR YOU - the four things we could not answer by reading the data
     1. stop_type 'VA' (and 'SP'): what are they? We currently refuse to guess and skip them,
        which leaves one real movement (290837) showing 6 of its 10 stops on our screen. We
        would rather map them correctly than guess a stop type onto a driver's checklist.
     2. movement.status 'A' vs 'P': we read 'A' as available/not yet covered - 46 of them have
        no dispatcher and no trailer. Is that right?
     3. The certificate hostname for this SQL Server, so we can connect with TLS. An IP cannot
        be used as a TLS server name, so today we connect unencrypted inside the VPN and we
        would prefer not to.
     4. The grant on dbo.driver includes 11 columns we did not ask for (birth_date, address,
        city, state, zip, name_of_spouse, licence fields, medical_cert_expire, hire_date). We
        only need: id, company_id, first_name, name, is_active, termination_date. Please
        narrow it - we would rather not hold what we do not use.
   ===================================================================================== */

-- ---------------------------------------------------------------------------------------
-- SESSION SETTINGS - applied once, on one connection we hold open. Not per statement.
-- ---------------------------------------------------------------------------------------
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;                          -- 5 s, then WE abort. Your writers never wait on us.
SET DEADLOCK_PRIORITY LOW;                      -- any tie is broken against us, by design.
SET TRANSACTION ISOLATION LEVEL READ COMMITTED; -- never READ UNCOMMITTED / NOLOCK.

-- Parameters. In the connector these are bound as typed parameters (VarChar/DateTime),
-- never string-concatenated. Declared here so this file runs as-is.
DECLARE @companyId  varchar(32) = 'TMS';
DECLARE @staleBefore datetime   = DATEADD(day, -30, GETDATE());

-- ---------------------------------------------------------------------------------------
-- STATEMENT 1 of 4: CHANGE DETECTION
--
-- Asks which movements changed since our last read. Reads the Change Tracking side
-- tables, not the base table, so it contends with nothing. @sinceVersion is the version
-- we stored at the end of the previous cycle. On the very first run, and after any gap
-- longer than your 10-day retention, we re-baseline instead of guessing.
-- ---------------------------------------------------------------------------------------
DECLARE @sinceVersion bigint = CHANGE_TRACKING_CURRENT_VERSION() - 1000;  -- illustrative

SELECT ct.company_id, ct.id, ct.SYS_CHANGE_OPERATION
  FROM CHANGETABLE(CHANGES dbo.movement, @sinceVersion) AS ct
 WHERE ct.company_id = @companyId
OPTION (MAXDOP 1);

-- ---------------------------------------------------------------------------------------
-- STATEMENT 2 of 4: THE OPEN BOARD
--
-- The loads a dispatcher is working right now: movement.status P or A, with at least one
-- stop scheduled in the last 30 days. Team drivers are aggregated rather than joined, so
-- a two-driver movement is one row and not two.
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
-- STATEMENT 3 of 4: THE STOPS OF THOSE LOADS
--
-- Same filter, one row per stop. Note we select longitude raw and negate it in our own
-- code, where a test can pin it - your longitudes are stored west-positive.
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
-- STATEMENT 4 of 4: THE DISPATCHERS ON THAT BOARD
--
-- Scoped to accounts that actually own a load, not the whole users table, because the
-- list exists to be mapped to our own users by hand.
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

-- ---------------------------------------------------------------------------------------
-- END. There is nothing else. If you would like a statement changed, removed or capped
-- differently, tell us and we will change it before anything is scheduled.
-- ---------------------------------------------------------------------------------------
