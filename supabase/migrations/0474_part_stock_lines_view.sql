-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 0474 — `part_stock_lines`: a stock line with its part's and its location's names, as ONE row
-- (US6b F32, docs/plans/design-system/UI-STANDARDIZATION.md §7).
--
-- Labels' "Shelves" list was one `/stock` response capped at 200 lines (`PAGE_MAX`), searched and
-- paged in the browser: a shop past 200 shelf lines would see the first 200 and no sign of the rest.
-- The fix is the asset list's — the server pages, and the server searches — but the search is over
-- part number, description and location name, which live in three tables, and PostgREST cannot OR
-- across a row and its embedded resources: `or=(parts.part_number.ilike…,stock_locations.name.ilike…)`
-- answers "failed to parse logic tree" (measured 2026-10-14). A view puts the three on one row, where
-- one `.or()` can reach them.
--
-- It restates no rule. A stock line's shape still comes from `toStockLineDto` (apps/api inventory
-- stock.ts); this is the same join `STOCK_COLUMNS` asks PostgREST for, flattened — `!inner` there is
-- `join` here, so a line whose part or location is gone appears in neither.
--
-- `security_invoker = on`, for 0150's reason: a view otherwise runs with its OWNER's rights and would
-- hand any caller every org's shelves. With it, `part_stock`'s own policy (0331) applies to a read
-- through the view exactly as to a direct one. The API reads it with the service role and filters by
-- org itself, like every service query.
--
-- A new relation with no reader yet: the reader (`listStock`'s search) ships in the NEXT merge, so no
-- deployed code ever asks for a view the database does not have (docs/MIGRATION-DISCIPLINE.md).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

drop view if exists public.part_stock_lines;

create view public.part_stock_lines with (security_invoker = on) as
select
  ps.org_id,
  ps.part_id,
  ps.location_id,
  ps.quantity_on_hand,
  ps.reorder_point,
  ps.reorder_quantity,
  ps.aisle,
  ps.row,
  ps.bin,
  ps.tag_code,
  ps.active,
  p.part_number,
  p.description as part_description,
  p.unit_of_measure,
  p.last_cost,
  l.name as location_name
from public.part_stock ps
join public.parts p on p.id = ps.part_id and p.org_id = ps.org_id
join public.stock_locations l on l.id = ps.location_id and l.org_id = ps.org_id;

comment on view public.part_stock_lines is
  'A stock line with its part number, description and location name on one row (0474, US6b F32), so one PostgREST or() can search all three. security_invoker: part_stock''s policy applies.';
