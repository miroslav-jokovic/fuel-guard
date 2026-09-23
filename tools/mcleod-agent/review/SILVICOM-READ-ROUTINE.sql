/* =====================================================================================
   Silvicom 360 - what our loads connector runs against LME (database: lme)
   =====================================================================================

   Hi Alex,

   As promised, here is the routine for you to look over before we schedule anything
   against the live database. These are the statements our loads connector will run,
   exactly as it runs them - the file is plain T-SQL, so you can open it in SSMS and
   execute it yourself. You will get back the same rows we see.

   One thing I want to be upfront about: this file covers the LOADS feed. We also run a
   smaller roster sync with the same login (drivers, trucks and trailers, so our
   people and equipment lists match yours). I will send you those queries as well, so you
   have the full picture of everything we read.

   THE SHORT VERSION
     login      silvicom_dispatch_ro - it can only read. It has no permission to insert,
                update or delete anything.
     database   lme
     where      our connector runs inside YOUR network (on the Board VM, once it is set
                up) and sends what it reads OUT to us over HTTPS. Nothing of ours ever
                connects in to your server, so you do not need to open a firewall port or
                keep an IP allow-list for us.
     how often  we would like to start at once every 10 minutes, and only move towards
                once a minute if it turns out to be worth it.

   HOW MUCH LOAD THIS PUTS ON YOUR SERVER
     We measured it on your server on 2026-09-17 (SET STATISTICS TIME, median of 5 runs):
     all four statements together      16 ms CPU   /  26 ms elapsed  /  514 rows
     per day, even at once a minute     23 CPU-seconds
     as a share of this 42-core box    0.0006 %
     added request rate                3 requests/minute = 0.036 % of your ~138/sec baseline

   WHAT WE WILL NEVER DO
     - Write anything. The login cannot, and we would not want it to.
     - Use NOLOCK / READ UNCOMMITTED. At 16 ms these queries do not need it, and we would
       rather wait a moment than read a half-written row.
     - Hold a transaction open, take locks we do not need, or run anything unbounded.
     - Read driver.social_security_no. It is not in our grant and we do not want it.

   HOW WE STAY OUT OF YOUR DISPATCHERS' WAY
     READ_COMMITTED_SNAPSHOT is off on this database, so a long-running read could make
     your users wait. That is why everything below is short and targeted. LOCK_TIMEOUT
     means that if a row is busy, our query gives up after 5 seconds instead of making
     anyone wait on us. DEADLOCK_PRIORITY LOW means that if SQL Server ever has to choose
     between us and one of your users, it always picks us to cancel.

   A FEW QUESTIONS WE COULD NOT ANSWER FROM THE DATA
     1. Stop types. Almost every stop is PU or SO, but a few are VA, and we have also seen
        VP, SP and SD. What do these mean? Right now we leave them out rather than guess,
        so a load like movement 290837 shows only 6 of its 10 stops on our side. We would
        like to show them properly, and we do not want to guess wrong - for example,
        treating a routing stop as a delivery would ask the driver for a bill of lading
        that does not exist.
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
     4. Dispatcher fleets. Each dispatcher has their own fleet of trucks, and we want to
        show that correctly. Where does that assignment live in LME - tractor.fleet_id,
        tractor.dispatcher, driver.fleet_manager, or somewhere else? We noticed that on
        about 4 in 10 active loads, the dispatcher on the load is not the one on the
        truck, so we want to make sure we are reading the right field. If it is
        driver.fleet_manager, could you add that column (and driver.tractor_id) to our
        driver grant? They were in our original request but did not make it in.

   And thank you for correcting the grant script and setting all of this up. If you would
   like any statement below changed, capped differently or removed, just tell me and we
   will change it before anything is scheduled.

   Thanks,
   Miki
   ===================================================================================== */

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
-- STATEMENT 1 of 4: WHAT CHANGED SINCE LAST TIME
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
-- STATEMENT 2 of 4: THE OPEN LOADS
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
-- STATEMENT 3 of 4: THE STOPS OF THOSE LOADS
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
-- STATEMENT 4 of 4: THE DISPATCHERS ON THOSE LOADS
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

-- ---------------------------------------------------------------------------------------
-- That is the whole loads routine. The roster sync queries will follow separately, as
-- mentioned at the top. Any questions or changes, just let me know.
-- ---------------------------------------------------------------------------------------
