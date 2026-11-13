-- ========================================================================================
-- Silvicom 360 - grants for silvicom_dispatch_ro (2026-09-25, corrected 2026-09-28, all run 2026-09-29)
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
-- 2026-09-29: Alex ran those six lines. Checked the same day under silvicom_dispatch_ro,
-- encrypted: on LME the customer join matches on company_id (132 open orders, one customer
-- each) and statements 1-8, 16 and 22-24 run; on lme_analytics all sixteen tables read and
-- statements 9-21 run, 15 to 18 included. Still no write permission anywhere.
-- Nothing in this file is waiting to be run; running the whole file again is harmless.
--
-- 2026-10-05 - WAITING TO BE RUN: one table, fuel_tax_history (the IFTA fuel-tax history), on
-- both databases. The new statement "FUEL RECEIPTS KEYED BY HAND" reads only its source F rows -
-- the cash and own-card receipts the office keys in - and no personal data. Two lines, marked
-- below in Part 2 and Part 3.
--
-- 2026-10-10 - WAITING TO BE RUN: one table, voucher_dist (the AP voucher distribution lines),
-- on both databases. The voucher header carries the payables account; the expense account each
-- bill was coded to (repairs, tolls, office bills) is on these lines. No statement reads it yet:
-- its columns are checked against the database first, and the statement comes for review
-- before it runs. Two lines, marked below in Part 2 and Part 3.
--
-- 2026-10-19 - WAITING TO BE RUN: two small settings tables, gl_control (each company's open
-- accounting period) and fiscal_year_dtl (the start and end date of each period), on both
-- databases. The new statement "OPEN ACCOUNTING PERIOD" reads one row from them so the reports
-- can tell a month the accountant has closed from one still being posted. No amounts and no
-- personal data. Four lines, marked below in Part 2 and Part 3.
--
-- 2026-10-21 - WAITING TO BE RUN: one table, tractor, on lme_analytics only (LME already has it
-- for the truck list). The new finance statement "TRUCK SERVICE DATES AND OWNERS" reads each
-- truck's in-service and out-of-service date and owner, so a month's lease and insurance can be
-- shared over the days each truck was in service. No personal data. One line, marked below in
-- Part 2.
--
-- 2026-11-13 - WAITING TO BE RUN: Part 4 and Part 5, both on LME only.
--   Part 4 is the step Part 2 always promised: the same finance tables on LME, so the nightly
--   finance read uses the books as they are today and no longer waits for a restore of the
--   analytics copy. Checked 2026-11-13 under the connector's login: on LME it reads none of them.
--   Part 2 ALSO NEEDS RUNNING AGAIN on lme_analytics: checked the same day, the login reads no
--   finance table there either. The copy was restored on 2026-10-09, and a restore carries LME's
--   permissions, so the grants of 2026-09-28 and 2026-09-29 on the copy did not survive it. Every
--   later restore will do the same until Part 4 is on LME.
--   Part 5 is three tables for lumper fees: the charges on an order, the charges on an invoice,
--   and the settlement deductions not yet paid. No statement reads them yet; the statements come
--   for review before they run. No personal data beyond a driver id on a settlement line.
-- ========================================================================================


-- ----------------------------------------------------------------------------------------
-- PART 1 - LOAD BOARD (LME)
-- ----------------------------------------------------------------------------------------
USE lme;
GO

GRANT SELECT ON dbo.reference_number TO silvicom_dispatch_ro;

-- customer: only these columns. No credit, billing or contact fields.
GRANT SELECT ON dbo.customer (id, name, city, state_id) TO silvicom_dispatch_ro;

-- Added 2026-09-28, run 2026-09-29: company_id, so the customer join can match the company.
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

-- Added 2026-10-21, waiting to be run: the truck service dates for the per-truck P&L.
GRANT SELECT ON dbo.tractor          TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.billing_history  TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.drs_settle_hist  TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.drs_deduct_hist  TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.voucher          TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.voucher_hist     TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.fuel_detail      TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.fuel_detail_hist TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.equipment_item   TO silvicom_dispatch_ro;

-- Added 2026-09-28, run 2026-09-29. The same five tables the login already reads on LME, and
-- only needed here, on lme_analytics: statements 15 to 18 join them.
GRANT SELECT ON dbo.movement         TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.movement_order   TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.orders           TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.stop             TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.users            TO silvicom_dispatch_ro;

-- Added 2026-10-05, NOT YET RUN: the fuel-tax history, for "FUEL RECEIPTS KEYED BY HAND".
GRANT SELECT ON dbo.fuel_tax_history TO silvicom_dispatch_ro;

-- Added 2026-10-10, NOT YET RUN: the AP distribution lines, for the expense account of each bill.
GRANT SELECT ON dbo.voucher_dist     TO silvicom_dispatch_ro;

-- Added 2026-10-19, NOT YET RUN: the open accounting period, for "OPEN ACCOUNTING PERIOD".
GRANT SELECT ON dbo.gl_control       TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.fiscal_year_dtl  TO silvicom_dispatch_ro;
GO


-- ----------------------------------------------------------------------------------------
-- PART 3 - FUEL-TAX HISTORY, AP DISTRIBUTION LINES AND THE OPEN PERIOD ON LME (added 2026-10-05, 2026-10-10 and 2026-10-19, NOT YET RUN)
-- The same one table on the live database, so the hand-keyed receipts are read from the
-- books as they are today rather than from the analytics copy's last restore.
-- ----------------------------------------------------------------------------------------
USE lme;
GO

GRANT SELECT ON dbo.fuel_tax_history TO silvicom_dispatch_ro;

-- Added 2026-10-10, NOT YET RUN: the same AP distribution lines on the live database, so the
-- nightly finance read sees a bill the day it is entered.
GRANT SELECT ON dbo.voucher_dist     TO silvicom_dispatch_ro;

-- Added 2026-10-19, NOT YET RUN: the open accounting period on the live database, so a month
-- shows as closed the night the accountant closes it.
GRANT SELECT ON dbo.gl_control       TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.fiscal_year_dtl  TO silvicom_dispatch_ro;
GO


-- ----------------------------------------------------------------------------------------
-- PART 4 - FINANCE ON LME (added 2026-11-13, NOT YET RUN)
-- The finance tables of Part 2, on the live database. The five movement tables and tractor are
-- already granted on LME. The last four lines repeat Part 3; running them twice is harmless.
-- ----------------------------------------------------------------------------------------
USE lme;
GO

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
GRANT SELECT ON dbo.fuel_tax_history TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.voucher_dist     TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.gl_control       TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.fiscal_year_dtl  TO silvicom_dispatch_ro;
GO


-- ----------------------------------------------------------------------------------------
-- PART 5 - LUMPER FEES ON LME (added 2026-11-13, NOT YET RUN)
-- other_charge       the accessorial charges on an order (we read the lumper code, LUM)
-- other_charge_hist  the same charges as they went out on an invoice
-- drs_pending_deduct settlement lines not yet paid (the lumper advance and its reimbursement)
-- The paid settlement lines (drs_deduct_hist) and the invoices (billing_history) are in Part 4.
-- ----------------------------------------------------------------------------------------
USE lme;
GO

GRANT SELECT ON dbo.other_charge       TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.other_charge_hist  TO silvicom_dispatch_ro;
GRANT SELECT ON dbo.drs_pending_deduct TO silvicom_dispatch_ro;
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
                  'movement', 'movement_order', 'orders', 'stop', 'users', 'fuel_tax_history',
                  'voucher_dist', 'gl_control', 'fiscal_year_dtl', 'tractor',
                  'other_charge', 'other_charge_hist', 'drs_pending_deduct');
-- customer is granted by column, so it is checked by column: all five should show 1.
SELECT HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'company_id', 'COLUMN') AS customer_company_id,
       HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'id', 'COLUMN')       AS customer_id,
       HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'name', 'COLUMN')     AS customer_name,
       HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'city', 'COLUMN')     AS customer_city,
       HAS_PERMS_BY_NAME('dbo.customer', 'OBJECT', 'SELECT', 'state_id', 'COLUMN') AS customer_state_id;
SELECT HAS_PERMS_BY_NAME('dbo.movement', 'OBJECT', 'UPDATE') AS can_update_movement;
REVERT;
