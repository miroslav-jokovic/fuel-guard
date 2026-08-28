-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_gl_accounts — the chart of accounts, so the GL totals can be READ as an income statement
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- The gap this closes: `mcleod_gl_totals` (0269) holds month × module × glid dollars, but a glid is
-- a number nobody can classify. The owner's 2026-08-28 fleet-net reconciliation had to join the
-- account names and types from a RECON TRANSCRIPT (F10) to prove our store reproduces the income
-- statement to the dollar — Jan–Jun 2026 net matched his spreadsheet exactly, July matched once his
-- stale P&L print was accounted for. That join belongs in the store, sourced from McLeod's own
-- `gl_account` master (`descr`, `type_id` — "Revenue", "Operating Expenses", "General & Admin
-- Expenses", …), so the fleet-truth check runs on every page load instead of once in a chat.
--
-- Why a table and not a hardcoded map: the classification IS data McLeod owns; accounts get added
-- and renamed by the carrier's bookkeeper, and a code-constant copy is how the check silently rots.
-- The agent re-sweeps the whole master (123 rows measured) with every --financial pass; full-row
-- idempotent upsert on (org_id, glid), same posture as every 0257-family staging table.
--
-- raw-access-waiver: this migration CREATES the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
create table if not exists mcleod_gl_accounts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  glid        text not null,                -- gl_account.id, trimmed
  descr       text,                         -- the human name the R4/R1 worksheets rule on
  type_id     text,                         -- McLeod's own class: Revenue / Operating Expenses / …
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists uq_mcleod_gl_accounts
  on mcleod_gl_accounts (org_id, glid);

alter table mcleod_gl_accounts enable row level security;
