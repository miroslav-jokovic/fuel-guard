-- 0522 — three things the inventory section promised and the schema did not hold
-- (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5, PR-R3: R8, R13, and the R9 race).
--
-- ── 1. ONE SERIAL NUMBER, ONE ASSET, PER ORG (R8) ─────────────────────────────────────────────
-- 0333 indexed `serial_number` for search and nothing else, so the same tablet could be entered
-- twice: two records, two labels, two histories — and a scan of either label answers half the
-- truth. The serial is the one identifier the manufacturer printed, so it is the one that must not
-- repeat. Compared trimmed and case-folded, because "R9TW40" and "r9tw40 " are the same sticker
-- typed by two people. A blank serial is "nobody recorded one" and repeats freely, as null does.
--
-- Measured on production 2026-10-27: 0 assets, 0 duplicate serials, so the index builds clean. A
-- shop that had already doubled a tablet would fail this migration loudly rather than silently,
-- which is the right failure: two rows for one tablet need a person to say which one is real.
--
-- ⚠ Not a CHECK in a trigger: a unique index is the only thing two concurrent inserts cannot both
-- pass. `assetsWrite.ts` maps its 23505 to `duplicate_serial` by the index's NAME, because the same
-- table already raises 23505 for a reused tag and the two need different sentences.
--
-- ── 2. A SHELF'S LABEL CODE IS ASSIGNED ONCE (R13) ────────────────────────────────────────────
-- `inventory_assets.tag_code` has had 0333's immutability guard since I7. `part_stock.tag_code`
-- has relied on the `.is("tag_code", null)` predicate in `tagIssuance.ts` — which holds for the
-- one writer that exists today and for nobody else, the service role included. A printed shelf
-- label is polyester stuck to a bin; changing the code it resolves to strands that label, and
-- reprinting is how two bins end up answering one code. Same rule, same SQLSTATE (`IV022`), so
-- `httpStatus.ts` already answers it 409.
--
-- ── 3. ONE OPEN KIT CHECK PER UNIT (the R9 race) ──────────────────────────────────────────────
-- PR-R2b (#1789) made "Check this unit" resume the unit's open check — a read, then an insert.
-- Two people pressing at the same instant can both read "none open" and both insert. These two
-- partial unique indexes make the second insert fail (23505), and `countSessions.ts` answers that
-- by reading back the winner's check, so both phones land in the same walk.
--
-- Shelf walks are deliberately NOT covered: a D-INV21 recount is a second person's walk of the
-- same bay in a session of its own.
--
-- Before the index can exist, the duplicates already open must go. Production holds four open
-- checks of one truck (opened 09-10 twice, 10-15, 10-19), the residue of the button that always
-- inserted. The NEWEST stays open — it is the one "Check this unit" now resumes — and the older
-- ones are CLOSED, never deleted: their answers are `asset_movements` rows that cite them, and
-- closing is the one update 0332's trigger allows. The note says who closed them and why.

-- 1 ────────────────────────────────────────────────────────────────────────────────────────────
create unique index if not exists idx_inventory_assets_serial_unique
  on inventory_assets (org_id, lower(btrim(serial_number)))
  where serial_number is not null and btrim(serial_number) <> '';

-- 2 ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function guard_part_stock_tag() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.tag_code is not null and new.tag_code is distinct from old.tag_code then
    raise exception 'shelf line already carries tag %: a tag is assigned once and never reprinted', old.tag_code
      using errcode = 'IV022';
  end if;
  return new;
end;
$$;
revoke all on function guard_part_stock_tag() from public, anon, authenticated;

drop trigger if exists trg_part_stock_tag_once on part_stock;
create trigger trg_part_stock_tag_once
  before update of tag_code on part_stock
  for each row execute function guard_part_stock_tag();

-- 3 ────────────────────────────────────────────────────────────────────────────────────────────
with ranked as (
  select id,
         row_number() over (
           partition by org_id, vehicle_id, trailer_id
           order by opened_at desc, id desc
         ) as rn
    from stock_count_sessions
   where kind = 'unit' and status = 'open'
)
update stock_count_sessions s
   set status = 'closed',
       closed_at = now(),
       note = left(concat_ws(E'\n', s.note,
         'Closed by migration 0522: a newer check of this unit was already open, and a unit has one open check at a time.'), 2000)
  from ranked r
 where s.id = r.id and r.rn > 1;

create unique index if not exists idx_stock_count_sessions_open_vehicle
  on stock_count_sessions (org_id, vehicle_id)
  where kind = 'unit' and status = 'open' and vehicle_id is not null;

create unique index if not exists idx_stock_count_sessions_open_trailer
  on stock_count_sessions (org_id, trailer_id)
  where kind = 'unit' and status = 'open' and trailer_id is not null;
