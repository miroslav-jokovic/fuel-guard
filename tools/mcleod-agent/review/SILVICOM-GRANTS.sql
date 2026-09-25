-- ========================================================================================
-- Silvicom 360 - grants for silvicom_dispatch_ro (2026-09-25)
--
-- SELECT only. No INSERT, UPDATE, DELETE, EXECUTE or schema permission, and no SHOWPLAN.
--
-- Already granted, nothing to change: movement, movement_order, orders, stop, continuity,
-- trailer, tractor, users, and driver (the 18 columns). The new load and stop fields in
-- SILVICOM-READ-ROUTINE.sql all come from those tables, so they need no new grant.
--
-- What is new:
--   Part 1 - reference_number and customer, for the PU number and customer name on the
--            load board. Run on LME.
--   Part 2 - the finance tables. Run on lme_analytics first; after one night of counts
--            that look right, run the same part on LME.
-- ========================================================================================


-- ----------------------------------------------------------------------------------------
-- PART 1 - LOAD BOARD (LME)
-- ----------------------------------------------------------------------------------------
USE lme;
GO

GRANT SELECT ON dbo.reference_number TO silvicom_dispatch_ro;

-- customer: only these four columns. No credit, billing or contact fields.
GRANT SELECT ON dbo.customer (id, name, city, state) TO silvicom_dispatch_ro;
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
                  'voucher_hist', 'fuel_detail', 'fuel_detail_hist', 'equipment_item');
-- customer is granted by column, so it is checked by column: all four should show 1.
SELECT HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'id', 'COLUMN')    AS customer_id,
       HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'name', 'COLUMN')  AS customer_name,
       HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'city', 'COLUMN')  AS customer_city,
       HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'state', 'COLUMN') AS customer_state;
SELECT HAS_PERMS_BY_NAME('dbo.movement', 'OBJECT', 'UPDATE') AS can_update_movement;
REVERT;
