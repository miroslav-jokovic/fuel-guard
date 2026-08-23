-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- McLeod inspection query pack — answers the six blocking questions in
-- docs/plans/mcleod/MCLEOD-ROSTER-SYNC-PLAN.md §6
--
-- Written 2026-08-23. Run against `lme_analytics` with the read-only login.
--
-- SAFETY
--   · Every statement is a SELECT. Nothing writes, creates, or alters.
--   · READ UNCOMMITTED throughout so nothing blocks a writer, in case this is ever pointed at a
--     live or replicated database rather than the sandbox snapshot.
--   · No statement returns a person's name, SSN, licence number, address, or date of birth.
--     Where a value's SHAPE matters (is `name` "LAST, FIRST"?), the query counts the shape
--     instead of returning the values. Where a business identifier is unavoidable (company name,
--     tractor unit number), it is returned deliberately and is not personal data.
--   · Q1.3 and Q7.2 scan large tables. They are marked SLOW and kept last within their section
--     so the cheap answers land first.
--
-- HOW TO REPORT BACK
--   Paste each result set under its query number. Row counts and distinct-value lists are the
--   whole point — no interpretation needed, and please do not summarise: the long tail of a
--   status-code list is exactly where the surprises live.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

set transaction isolation level read uncommitted;
set nocount on;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Q0 — What are we connected to, and as whom?
-- Establishes the permission surface we actually have, which decides whether the production ask
-- (a dedicated fuelguard_ro login with a column allowlist) is a change or a formality.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Q0.1 — database identity, state, and read-only status
select
    db_name()                as database_name,
    d.create_date            as db_create_date,     -- for a RESTORED db this is the restore time
    d.state_desc,
    d.recovery_model_desc,
    d.is_read_only,
    d.snapshot_isolation_state_desc,
    @@version                as server_version
from sys.databases d
where d.name = db_name();

-- Q0.2 — who am I, and which database roles do I hold?
select
    suser_sname()                    as login_name,
    user_name()                      as db_user,
    r.name                           as role_name
from sys.database_role_members rm
join sys.database_principals r on r.principal_id = rm.role_principal_id
where rm.member_principal_id = database_principal_id()
union all
select suser_sname(), user_name(), '(no roles)'
where not exists (
    select 1 from sys.database_role_members
    where member_principal_id = database_principal_id()
);

-- Q0.3 — explicit grants/denies at database level (empty result = permissions come from roles only)
select
    p.permission_name, p.state_desc, p.class_desc,
    object_name(p.major_id) as object_name
from sys.database_permissions p
where p.grantee_principal_id = database_principal_id()
order by p.class_desc, object_name, p.permission_name;

-- Q0.4 — is Change Tracking or CDC already enabled? (would change the plan's §1 conclusion)
select
    (select count(*) from sys.change_tracking_databases where database_id = db_id())   as ct_databases,
    (select count(*) from sys.change_tracking_tables)                                  as ct_tables,
    (select count(*) from sys.tables where is_tracked_by_cdc = 1)                      as cdc_tables;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Q1 — Is this a snapshot, and how stale is it right now?
-- Decides whether "continuously up to date" is achievable against this target at all.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Q1.1 — restore history. May be denied (needs msdb access); a permission error here is itself
--        an answer worth reporting, not a failure.
select top 10
    rh.destination_database_name,
    rh.restore_date,
    rh.restore_type,          -- D = database, I = differential, L = log
    bs.backup_start_date,
    bs.backup_finish_date,
    bs.server_name            as source_server
from msdb.dbo.restorehistory rh
left join msdb.dbo.backupset bs on bs.backup_set_id = rh.backup_set_id
where rh.destination_database_name = db_name()
order by rh.restore_date desc;

-- Q1.2 — freshness probes, cheapest first. Compare each against "now" at the moment you run this.
--        A cluster of maxima all landing at the same wall-clock instant is the signature of a
--        point-in-time snapshot; maxima creeping toward now is the signature of a live replica.
select 'now'              as probe, getdate()                       as max_value, null as rows_scanned
union all select 'audit_log_tx.change_date_time', (select max(change_date_time) from dbo.audit_log_tx), 567078
union all select 'driver_hours.log_date',         (select max(log_date)         from dbo.driver_hours), 1433721;

-- Q1.3 — SLOW (45.5M rows, may be a full scan if change_date_time is unindexed — see Q7.2 first).
--        The single best freshness probe: the last thing anybody did in McLeod.
select max(change_date_time) as audit_log_latest_change from dbo.audit_log;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Q2 — Which company is the carrier?
-- Nothing downstream can be written until this is settled: every query in the sync binds company_id.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Q2.1 — the four companies. Company name + DOT number are business identifiers, not personal data,
--        and they are how a human recognises which row is the carrier.
select
    company_id, id, name, dot_number, company_type,
    currency, distance_um, weight_um, temperature_um
from dbo.company
order by company_id;

-- Q2.2 — fleet size per company: the number that identifies the carrier even if the names are opaque
select
    c.company_id,
    rtrim(c.name)                                                                  as company_name,
    (select count(*) from dbo.driver  d where d.company_id = c.company_id)         as drivers_total,
    (select count(*) from dbo.tractor t where t.company_id = c.company_id)         as tractors_total,
    (select count(*) from dbo.trailer r where r.company_id = c.company_id)         as trailers_total
from dbo.company c
order by c.company_id;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Q4 — The status vocabularies (run before Q3: the "active" filter makes Q3's answer readable)
-- Decides who is on the roster. Guessing here either drops working drivers or imports ~1,200 ghosts.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Q4.1 — driver status shape. Every combination that exists, with its size.
select
    company_id,
    status_code,
    is_active,
    case when termination_date is null then 'no_term_date' else 'has_term_date' end as termination,
    count(*)              as rows,
    min(hire_date)        as earliest_hire,
    max(termination_date) as latest_termination
from dbo.driver
group by company_id, status_code, is_active,
         case when termination_date is null then 'no_term_date' else 'has_term_date' end
order by company_id, count(*) desc;

-- Q4.2 — tractor status shape. Four status-ish columns; we need to know which one is load-bearing.
select
    company_id, status, service_status, tractor_status,
    case when outservice_date is null then 'in_service' else 'out_of_service' end as service_window,
    count(*) as rows
from dbo.tractor
group by company_id, status, service_status, tractor_status,
         case when outservice_date is null then 'in_service' else 'out_of_service' end
order by company_id, count(*) desc;

-- Q4.3 — trailer status shape
select
    company_id, statuscode, is_active, disposition_code, trailer_status,
    case when outservice_date is null then 'in_service' else 'out_of_service' end as service_window,
    count(*) as rows
from dbo.trailer
group by company_id, statuscode, is_active, disposition_code, trailer_status,
         case when outservice_date is null then 'in_service' else 'out_of_service' end
order by company_id, count(*) desc;

-- Q4.4 — the code vocabulary. `dbo.code` is keyed by table alias + field name; this reveals both
--        the alias McLeod uses for each table and the meaning of every code above.
select field_table_alias, field_name, field_code, rtrim(field_code_desc) as description, company_id
from dbo.code
where field_name in (
        'status_code','status','service_status','tractor_status',
        'statuscode','disposition_code','trailer_status','type_of',
        'trailer_type','door_type_code','reason_for_leaving','drvr_class'
      )
order by field_table_alias, field_name, field_code;

-- Q4.5 — if Q4.4 comes back thin, the alias naming is not what we assumed. This lists every alias
--        and field the code table knows about, so we can find the right ones by eye.
select field_table_alias, field_name, count(*) as code_count
from dbo.code
group by field_table_alias, field_name
order by field_table_alias, field_name;

-- Q4.6 — separation/leaving reasons (drives whether a termination is voluntary, and rehire eligibility)
select id, code_type, rtrim(descr) as description, is_active, company_id
from dbo.reason_code
order by company_id, code_type, id;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Q3 — Date-column semantics: issue date or expiry date?
-- Getting these backwards puts every driver permanently expired or permanently valid on a
-- compliance surface. `medical_cert_expire` is the CONTROL: it is unambiguously an expiry, so
-- whatever pattern it shows is what an expiry column looks like in this data.
--
-- Replace @co with the carrier's company_id from Q2 before running.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

declare @co char(4) = '____';   -- ← set from Q2.2, then run the rest of this section

-- Q3.1 — driver date columns, active drivers only
select 'medical_cert_expire (CONTROL: known expiry)' as column_name,
       count(*) as populated,
       sum(case when medical_cert_expire > getdate() then 1 else 0 end) as in_future,
       sum(case when medical_cert_expire <= getdate() then 1 else 0 end) as in_past,
       min(medical_cert_expire) as earliest, max(medical_cert_expire) as latest
from dbo.driver where company_id = @co and termination_date is null and medical_cert_expire is not null
union all
select 'license_date (AMBIGUOUS)',
       count(*),
       sum(case when license_date > getdate() then 1 else 0 end),
       sum(case when license_date <= getdate() then 1 else 0 end),
       min(license_date), max(license_date)
from dbo.driver where company_id = @co and termination_date is null and license_date is not null
union all
select 'mvr_date (expect: past — last MVR pulled)',
       count(*),
       sum(case when mvr_date > getdate() then 1 else 0 end),
       sum(case when mvr_date <= getdate() then 1 else 0 end),
       min(mvr_date), max(mvr_date)
from dbo.driver where company_id = @co and termination_date is null and mvr_date is not null
union all
select 'physical_date',
       count(*),
       sum(case when physical_date > getdate() then 1 else 0 end),
       sum(case when physical_date <= getdate() then 1 else 0 end),
       min(physical_date), max(physical_date)
from dbo.driver where company_id = @co and termination_date is null and physical_date is not null;

-- Q3.2 — tractor date columns, in-service tractors only
select 'tag_expire_date (CONTROL: known expiry)' as column_name,
       count(*) as populated,
       sum(case when tag_expire_date > getdate() then 1 else 0 end) as in_future,
       sum(case when tag_expire_date <= getdate() then 1 else 0 end) as in_past,
       min(tag_expire_date) as earliest, max(tag_expire_date) as latest
from dbo.tractor where company_id = @co and outservice_date is null and tag_expire_date is not null
union all
select 'inspection_date (AMBIGUOUS)', count(*),
       sum(case when inspection_date > getdate() then 1 else 0 end),
       sum(case when inspection_date <= getdate() then 1 else 0 end),
       min(inspection_date), max(inspection_date)
from dbo.tractor where company_id = @co and outservice_date is null and inspection_date is not null
union all
select 'insurance_date (AMBIGUOUS)', count(*),
       sum(case when insurance_date > getdate() then 1 else 0 end),
       sum(case when insurance_date <= getdate() then 1 else 0 end),
       min(insurance_date), max(insurance_date)
from dbo.tractor where company_id = @co and outservice_date is null and insurance_date is not null
union all
select 'liability_end_dt (CONTROL: known end date)', count(*),
       sum(case when liability_end_dt > getdate() then 1 else 0 end),
       sum(case when liability_end_dt <= getdate() then 1 else 0 end),
       min(liability_end_dt), max(liability_end_dt)
from dbo.tractor where company_id = @co and outservice_date is null and liability_end_dt is not null;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Q8 — Match-key quality. Decides the matching precedence in the sync, and whether the unique
-- indexes we are about to create can even be built.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Q8.1 — driver `name` format, WITHOUT returning any names
select
    count(*)                                                                as total,
    sum(case when charindex(',', name) > 0 then 1 else 0 end)               as contains_comma,
    sum(case when first_name is not null and rtrim(first_name) <> '' then 1 else 0 end) as has_first_name,
    sum(case when name_mid_initial is not null and rtrim(name_mid_initial) <> '' then 1 else 0 end) as has_middle_initial,
    sum(case when len(rtrim(name)) = 28 then 1 else 0 end)                  as at_char_limit_28
from dbo.driver
where company_id = @co;

-- Q8.2 — is `tractor.serial_number` really a VIN? (17 chars ⇒ yes, and it becomes a match key)
select
    'tractor.serial_number' as column_name,
    count(*)                                                                     as total,
    sum(case when serial_number is null or rtrim(serial_number) = '' then 1 else 0 end) as blank,
    sum(case when len(rtrim(serial_number)) = 17 then 1 else 0 end)              as len_17,
    count(distinct rtrim(serial_number))                                         as distinct_values
from dbo.tractor where company_id = @co
union all
select 'trailer.serial_number',
    count(*),
    sum(case when serial_number is null or rtrim(serial_number) = '' then 1 else 0 end),
    sum(case when len(rtrim(serial_number)) = 17 then 1 else 0 end),
    count(distinct rtrim(serial_number))
from dbo.trailer where company_id = @co;

-- Q8.3 — VIN duplicates. `uq_vehicles_org_vin` already exists in FuelGuard and REFUSES to build
--        over duplicates, so any row here is work to do before the migration, not after.
select rtrim(serial_number) as vin, count(*) as rows
from dbo.tractor
where company_id = @co and serial_number is not null and rtrim(serial_number) <> ''
group by rtrim(serial_number) having count(*) > 1
order by count(*) desc;

-- Q8.4 — is `tractor.id` the unit number a human would recognise? Unit numbers are not personal data.
select top 20 rtrim(id) as tractor_id, rtrim(tag) as plate, model_year, rtrim(make) as make
from dbo.tractor
where company_id = @co and outservice_date is null
order by id;

-- Q8.5 — email truncation risk. `driver.email` is char(30); anything AT 30 chars is likely cut off,
--        and a truncated address is worse than none (the driver app sends to it).
select
    count(*)                                                                  as total,
    sum(case when email is null or rtrim(email) = '' then 1 else 0 end)       as blank,
    sum(case when len(rtrim(email)) = 30 then 1 else 0 end)                   as at_char_limit_30,
    sum(case when charindex('@', email) = 0 and rtrim(email) <> '' then 1 else 0 end) as no_at_sign
from dbo.driver where company_id = @co and termination_date is null;

-- Q8.6 — phone coverage: which column actually reaches drivers?
select
    sum(case when cell_phone is not null and rtrim(cell_phone) <> '' then 1 else 0 end) as has_cell_phone,
    sum(case when phone      is not null and rtrim(phone)      <> '' then 1 else 0 end) as has_phone,
    count(*) as active_drivers
from dbo.driver where company_id = @co and termination_date is null;

-- Q8.7 — the reefer determination for trailers (drives `is_reefer`, and the reefer-diversion rule later)
select
    count(*)                                                                       as total,
    sum(case when reefer_id is not null and rtrim(reefer_id) <> '' then 1 else 0 end) as has_reefer_id,
    sum(case when min_temp is not null or max_temp is not null then 1 else 0 end)  as has_temp_range,
    sum(case when heater_code is not null and rtrim(heater_code) <> '' then 1 else 0 end) as has_heater_code
from dbo.trailer where company_id = @co and outservice_date is null;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Q7 — Is `audit_log` usable as a change feed?
-- Decides whether we can add sub-minute change detection on top of the full-table hash diff, or
-- whether the hash diff stands alone (which is the plan's default and is fine).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Q7.1 — which fields are EXCLUDED from auditing? 34 rows; if our three tables appear here with
--        the fields we care about, audit_log is blind to exactly the changes we need.
select company_id, rtrim(table_name) as table_name, rtrim(field_name) as field_name
from dbo.audit_log_exclude
order by table_name, field_name;

-- Q7.2 — indexes on audit_log. Run this BEFORE Q7.3/Q1.3: if change_date_time is not a leading
--        key column, those queries are full scans of 45.5M rows and should be run off-hours
--        (or skipped — the plan does not depend on them).
select
    i.name as index_name, i.type_desc, i.is_unique,
    c.name as column_name, ic.key_ordinal, ic.is_included_column
from sys.indexes i
join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id
join sys.columns c       on c.object_id  = i.object_id and c.column_id = ic.column_id
where i.object_id = object_id('dbo.audit_log')
order by i.index_id, ic.is_included_column, ic.key_ordinal;

-- Q7.3 — SLOW unless Q7.2 shows a useful index. Does audit_log actually cover our three tables,
--        and how much change traffic do they generate? `table_name` is char(30) — trailing spaces.
select
    rtrim(table_name)      as table_name,
    count(*)               as audit_rows,
    min(change_date_time)  as earliest,
    max(change_date_time)  as latest
from dbo.audit_log
where rtrim(table_name) in ('driver','tractor','trailer')
group by rtrim(table_name)
order by count(*) desc;

-- Q7.4 — recent change volume for the three tables, which sets the expected batch size per sweep.
--        Bounded to 30 days so it is cheap even without an index.
select
    rtrim(table_name)        as table_name,
    cast(change_date_time as date) as change_day,
    count(*)                 as changes
from dbo.audit_log
where rtrim(table_name) in ('driver','tractor','trailer')
  and change_date_time >= dateadd(day, -30, getdate())
group by rtrim(table_name), cast(change_date_time as date)
order by change_day desc, table_name;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Q9 — Roster sizing. The number that tells us whether the cutover is a match exercise or a
-- migration: FuelGuard holds ~248 active drivers; McLeod holds 1,491 rows across 4 companies.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

select 'drivers  — all'          as bucket, count(*) as rows from dbo.driver  where company_id = @co
union all
select 'drivers  — no term date',        count(*) from dbo.driver  where company_id = @co and termination_date is null
union all
select 'tractors — all',                 count(*) from dbo.tractor where company_id = @co
union all
select 'tractors — in service',          count(*) from dbo.tractor where company_id = @co and outservice_date is null
union all
select 'trailers — all',                 count(*) from dbo.trailer where company_id = @co
union all
select 'trailers — in service',          count(*) from dbo.trailer where company_id = @co and outservice_date is null;

-- Q9.1 — hire/termination activity over the last 24 months: the real-world change rate the
--        2-minute sweep is sized against.
select
    year(hire_date) as yr, month(hire_date) as mth,
    count(*) as hires
from dbo.driver
where company_id = @co and hire_date >= dateadd(month, -24, getdate())
group by year(hire_date), month(hire_date)
order by yr desc, mth desc;
