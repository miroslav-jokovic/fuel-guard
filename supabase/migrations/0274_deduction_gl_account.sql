-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_deductions gains the GL account, so a settlement deduction can be told from a recovery
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- The owner asked, 2026-08-28, for deduction income to reach the owner-operator margin. Doing that
-- needs one thing the staging does not carry: WHICH deductions are income at all. Measured against
-- June 2026, the answer is that "deduction" is three different economic events wearing one word,
-- and only the ledger account tells them apart:
--
--   · REVENUE accounts — the carrier genuinely earned it. `CAI` → Insurance Collection O/O ($8,000),
--     `TOP`/`TRL` → Equipment Rental ($12,103.94), `SAL`/`SAT` → Installment Sale ($9,629.12).
--     ~$29,733 in June, and the money the margin was missing.
--   · BALANCE-SHEET accounts — not income and not cost, just a repayment. `FEE` → `Fuel Advance`
--     ($53,196.95, a Current Asset) is the contractor repaying fuel bought on the carrier's card;
--     `SL` → Company Driver Payable ($30,515.08). Counting either as margin would invent earnings
--     out of a receivable being settled.
--   · EXPENSE accounts — cost recovery that has ALREADY reduced the expense it came from. `OWR` →
--     Repairs and Maintenance, `IRP` → Business Licenses, `GPS` → GPS Monthly Fee. These post as
--     credits through the DRS module, so the income statement is already net of them; adding them
--     to margin would count the same dollar twice.
--
-- Why the account and not the deduct code. The code set is the carrier's and it grows: June alone
-- used 23 of them, several with names that reveal nothing (`OWR`, `TOP`, `DRT`, `STL`). A hardcoded
-- list of "income codes" would be an attribution WE invented, it would silently miss the next code
-- the bookkeeper adds, and no gate would catch it. `glid` joins to `mcleod_gl_accounts.type_id`
-- (0272) and lets McLeod's own chart of accounts do the classifying — the same posture the CPM
-- page's fleet-truth check already takes with the income statement.
--
-- Nullable: a deduction that posts nowhere is a fact about the source, and it lands in neither the
-- income nor the recovery bucket rather than being guessed into one.
alter table mcleod_deductions
  add column if not exists glid text;

-- The margin read groups an org's owner-operator deductions by account inside a date window.
create index if not exists idx_mcleod_deductions_glid
  on mcleod_deductions (org_id, glid, transacted_at);

-- raw-access-waiver: this migration widens the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
