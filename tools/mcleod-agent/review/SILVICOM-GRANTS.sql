-- ========================================================================================
-- Silvicom 360 - grants for silvicom_dispatch_ro (2026-09-25, corrected 2026-09-28)
--
-- SELECT only. No INSERT, UPDATE, DELETE, EXECUTE or schema permission, and no SHOWPLAN.
--
-- Already granted on LME, nothing to change: movement, movement_order, orders, stop,
-- continuity, trailer, tractor, users, and driver (the 18 columns). The new load and stop
-- fields in SILVICOM-READ-ROUTINE.sql all come from those tables, so they need no new grant.
--
-- What is new:
--   Part 1 - reference_number and customer, for the PU number and customer name on the
--            load board. Run on LME.
--   Part 2 - the finance tables, plus the five movement tables the finance statements join.
--            Run on lme_analytics first; after one night of counts that look right, run the
--            finance tables on LME (the movement tables are already granted there).
--
-- 2026-09-28: Alex ran this on 2026-09-28. Three corrections since, all checked under the
-- connector's own login:
--   - customer has no "state" column; it is state_id. Alex fixed that line when he ran it.
--   - customer also needs company_id. Customer ids repeat across companies (6,243 rows, 4,252
--     distinct ids), so without it the 143 open orders match 268 customer rows, and 82 of them
--     match two customers with different names. We match company_id on every join; this one
--     cannot without the column. One line, Part 1, marked below.
--   - statements 15 to 18 (settled movements, their stops and totals, billing history) also
--     read movement, movement_order, orders, stop and users. On LME the login already has
--     them; on lme_analytics it did not, so those four statements were refused there. Five
--     lines, Part 2, marked below.
-- Only the lines marked "not yet run" are new; running the whole file again is harmless.
-- ========================================================================================


-- ----------------------------------------------------------------------------------------
-- PART 1 - LOAD BOARD (LME)
-- ----------------------------------------------------------------------------------------
USE lme;
GO

GRANT SELECT ON dbo.reference_number TO silvicom_dispatch_ro;

-- customer: only these columns. No credit, billing or contact fields.
GRANT SELECT ON dbo.customer (id, name, city, state_id) TO silvicom_dispatch_ro;

-- Added 2026-09-28, not yet run: company_id, so the customer join can match the company.
GRANT SELECT ON dbo.customer (company_id) TO silvicom_dispatch_ro;
GO


-- ----------------------------------------------------------------------------------------
-- PART 2 - FINANCE (lme_analytics now, LME after the first night)
-- ----------------------------------------------------------------------------------------
USE lme_analytics;
GO

-- Only if the login has no user in this database yet:
-- CREATE USER silvicom_dispatch_ro FOR LOGIN silvicom_dispatch_ro;

GRANT SELECT ON dbo.gl_ledger        TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.gl_ledger_hist   TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.gl_account       TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.billing_history  TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.drs_settle_hist  TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.drs_deduct_hist  TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.voucher          TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.voucher_hist     TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.fuel_detail      TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.fuel_detail_hist TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.equipment_item   TO silvicom_dispatch_ro;

-- Added 2026-09-28, not yet run. The same five tables the login already reads on LME, and
-- only needed here, on lme_analytics: statements 15 to 18 join them.
GRANT SELECT ON dbo.movement         TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.movement_order   TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.orders           TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.stop             TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.users            TO silvicom_dispatch_ro;
GO


-- ----------------------------------------------------------------------------------------
-- CHECK (optional) - run in each database after its part. Each table from that part should
-- show 1 (the finance tables show 0 on LME until Part 2 is run there), and the last line 0:
-- the login can read, and cannot write.
-- ----------------------------------------------------------------------------------------
EXECUTE AS USER = 'silvicom_dispatch_ro';
SELECT t.name AS table_name,
       HAS_PERMS_BY_NAME('dbo.' + t.name, 'OBJECT', 'SELECT') AS can_select
  FROM sys.tables AS t
 WHERE t.name IN ('reference_number', 'gl_ledger', 'gl_ledger_hist', 'gl_account',
                  'billing_history', 'drs_settle_hist', 'drs_deduct_hist', 'voucher',
                  'voucher_hist', 'fuel_detail', 'fuel_detail_hist', 'equipment_item',
                  'movement', 'movement_order', 'orders', 'stop', 'users');
-- customer is granted by column, so it is checked by column: all five should show 1.
SELECT HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'company_id', 'COLUMN') AS customer_company_id,
       HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'id', 'COLUMN')       AS customer_id,
       HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'name', 'COLUMN')     AS customer_name,
       HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'city', 'COLUMN')     AS customer_city,
       HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'state_id', 'COLUMN') AS customer_state_id;
SELECT HAS_PERMS_BY_NAME('dbo.movement', 'OBJECT', 'UPDATE') AS can_update_movement;
REVERT;
