-- 0331: the shop's shelf — locations, parts, stock lines, and the movement ledger under them.
--
-- INVENTORY-PLAN.md step I2 (D-INV1, D-INV4, D-INV8, D-INV11, D-INV13, D-INV14, D-INV15, D-INV26,
-- D-INV27). The first schema of the maintenance module's second feature; §396.17 annual inspections
-- (0279–0286) were the first.
--
-- ── THE ONE IDEA THIS SCHEMA IS BUILT ON ────────────────────────────────────────────────────────
-- `part_stock.quantity_on_hand` is never typed by anybody. Every change to it is a `part_movements`
-- row — received, issued, adjusted, transferred, counted, returned — and the quantity is the running
-- projection of that ledger, maintained inside `record_part_movement` and nowhere else. Three
-- reasons, in the order they matter:
--
--   1. "Where did the eleventh filter go" is the only inventory question anybody actually asks, and
--      a typed total destroys the evidence that answers it.
--   2. A write that sets a quantity directly is exactly the partial upsert `lint:upserts` forbids —
--      Postgres checks NOT NULL before conflict arbitration, so the convenient version of it is the
--      one that fails in production and not in a test.
--   3. A count is then a movement whose delta is taken AT COMMIT TIME against a locked row, so a
--      delivery received while somebody is walking the shelf is added to the count rather than
--      erased by it. That is not a nicety; it is the difference between a count you can trust and a
--      count you have to repeat.
--
-- ── THIS SHOP HAS NO SHELF NUMBERS (owner, 2026-09-09) ──────────────────────────────────────────
-- `aisle`, `row` and `bin` are three nullable text fragments and NOTHING requires them. The owner's
-- measurement is that this is a shop and not a warehouse: there are no aisle numbers to type, and a
-- schema that demanded them would have produced a form nobody could fill in. They stay as columns
-- because a shop that someday numbers its shelves should not need a migration to say so, and
-- because three fragments sort by aisle where one string does not.
--
-- What addresses a shelf here instead is `part_stock.tag_code` — the label stuck to it, resolved by
-- D-INV7's `/api/tags/resolve`. That inverts the usual order deliberately: the person does not read
-- an address off the shelf and type it, they point a camera at the shelf and the row arrives.
--
-- ── WHY THE INSERT COMES BEFORE THE UPDATE, WHICH REVERSES §2.12's WORDING ──────────────────────
-- §2.12 rule 2 says "guarded UPDATE first, insert only when row_count = 1"; step I2's numbered list
-- says insert first, then update. They cannot both be followed and only one of them is safe.
--
-- The movement id is client-generated and is the idempotency key (D-INV27) — a phone replaying a
-- queued write sends the same UUID. If the projection moved BEFORE the insert discovered the
-- conflict, every replay would move the shelf again and the ledger would disagree with the shelf by
-- exactly the number of times the network was bad. Insert-first is therefore the only order that
-- makes a replay free: the conflict is detected before anything else happens, and the existing row
-- is returned untouched.
--
-- Nothing is lost by the reversal, because the function is one transaction: when the guarded UPDATE
-- raises `IV010`, the INSERT above it rolls back with it. The "guard" §2.12 was naming is the
-- `>= 0` predicate ON the update, not its position in the function.
--
-- ── THE SQLSTATE REGISTER ───────────────────────────────────────────────────────────────────────
--   IV010  insufficient_stock          the guarded UPDATE matched no row (D-INV26)
--   IV011  part_movements_append_only  the ledger was edited, by anybody, service role included
--   IV012  unknown_location            unknown, foreign, inactive, or a transfer to itself
--   IV013  part_inactive               unknown, foreign, or retired and not being corrected
--   IV014  occurred_at_out_of_range    the device clock is more than 24 hours out
--   IV015  malformed_movement          no id, or no quantity for the reason given
--   IV016  movement_in_flight          a concurrent duplicate is mid-insert; retry (see the RPC)
--
-- The last two are not in step I2's list of five. `IV015` is the shape check the jsonb payload needs
-- because a `jsonb` argument cannot be typed by the signature; `IV016` is the concurrency case
-- described at the insert. Both are named rather than left to a bare 23502/23505, on the same
-- reasoning the five named ones exist: an error the API cannot map is an error the shop sees as 500.
--
-- ── RLS ─────────────────────────────────────────────────────────────────────────────────────────
-- Section `maintenance`, wrapped in `auth_section_or_default` on 0293–0295's pattern so an org that
-- edits its own section access reaches these tables too (D-PERM4). The role lists ARE the shipped
-- defaults and equal `rolesThatManage('maintenance')` / `rolesThatCanView('maintenance')` in
-- `packages/shared/src/auth.ts`, which is what `check-section-policies.mjs` verifies. `accountant`
-- and `auditor` read and do not write: the bookkeeper reads what the shelf is worth, the shop moves
-- it.
--
-- ── RETENTION ───────────────────────────────────────────────────────────────────────────────────
-- None of these four tables is in `RETENTION_FORBIDDEN` and none carries a prune rule. `part_movements`
-- is append-only by trigger, which is a different mechanism at a different layer and is stated here
-- so nobody reads its absence from the retention list as an oversight: a shop ledger is business
-- history, not regulatory evidence, and no regulation names a period for it. It also carries no
-- `audit_row_change` trigger — a ledger is its own audit, and a second copy of every row would double
-- the largest table in the module to say nothing new.

-- ── stock locations ─────────────────────────────────────────────────────────────────────────────
-- A table and not an enum (D-INV1). Multi-location is a paid tier in MaintainX and UpKeep and the
-- top complaint when it is missing. It is also the second time this product has modelled a place:
-- `terminals` was created at 0097 and dropped at 0259 after measuring zero rows, so this one earns
-- its existence by being the thing stock is held AT rather than a registry hoping to be populated.
-- If `terminals` is ever rebuilt, this points at it; it does not wait for it.
create table if not exists stock_locations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null check (length(name) between 1 and 120),
  code       text not null check (length(code) between 1 and 24),
  address    text check (length(address) <= 240),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_stock_locations_code on stock_locations (org_id, lower(code));
create index if not exists idx_stock_locations_active on stock_locations (org_id, active, name);

alter table stock_locations enable row level security;

drop policy if exists stock_locations_select on stock_locations;
create policy stock_locations_select on stock_locations for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() = any (array['admin','fleet_manager','technician','auditor','accountant'])));

drop policy if exists stock_locations_write on stock_locations;
create policy stock_locations_write on stock_locations for all
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])))
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])));

-- ── parts ───────────────────────────────────────────────────────────────────────────────────────
-- The definition, not the stock: the same filter sits on three shelves and its part number does not
-- change per shelf.
--
-- `upc` is the supplier's own barcode and is what makes scanning a factory carton useful — D-INV7's
-- resolver tries `parseTag` first and falls through to this column, so it is indexed because that
-- fall-through runs on every unrecognised scan.
--
-- `last_cost` is the ONLY money in this schema, and it is deliberately not an average (D-INV15). It
-- answers "what is this shelf worth" and nothing else: parts cost never reaches Finance, because GL
-- 30230000 already carries $270,670.22 of it and a part leaving a shelf is not a spend event
-- (D-INV11). It is maintained by the RPC from a `received` row's unit cost and by nothing else.
create table if not exists parts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  part_number     text not null check (length(part_number) between 1 and 64),
  description     text not null check (length(description) between 1 and 240),
  manufacturer    text check (length(manufacturer) <= 120),
  category        text check (length(category) <= 64),
  -- A closed vocabulary rather than free text, mirroring `UNITS_OF_MEASURE` in inventoryContract.ts.
  -- D-INV13 forbids custom FIELDS; it does not require free text inside the fields that exist, and
  -- "each"/"EA"/"Each" from four people makes the number 12 on a stock line unsayable.
  unit_of_measure text not null default 'each'
    check (unit_of_measure in ('each','pair','set','case','box','roll','foot','gallon','quart','litre','pound')),
  upc             text check (length(upc) <= 32),
  image_path      text check (length(image_path) <= 400),
  last_cost       numeric(12,2) check (last_cost >= 0),
  active          boolean not null default true,
  notes           text check (length(notes) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists idx_parts_number on parts (org_id, lower(part_number));
create index if not exists idx_parts_upc on parts (org_id, upc) where upc is not null;
create index if not exists idx_parts_active on parts (org_id, active, part_number);

alter table parts enable row level security;

drop policy if exists parts_select on parts;
create policy parts_select on parts for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() = any (array['admin','fleet_manager','technician','auditor','accountant'])));

drop policy if exists parts_write on parts;
create policy parts_write on parts for all
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])))
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])));

-- ── stock lines ─────────────────────────────────────────────────────────────────────────────────
-- One part at one location: the row a BIN label is stuck to and the thing a count counts.
--
-- `quantity_on_hand` carries `check (>= 0)` and a default of zero. D-INV26: negative stock is
-- refused and there is no setting to allow it. A shelf that has gone negative does not have a
-- permissive-inventory problem, it has a counting problem, and the fix is a `counted` movement.
--
-- `tag_code` is null until a label is printed (I10). A shelf works perfectly well without one — the
-- tag is what makes a scan land on this row, not what makes the row exist.
create table if not exists part_stock (
  org_id           uuid not null references organizations(id) on delete cascade,
  part_id          uuid not null references parts(id) on delete restrict,
  location_id      uuid not null references stock_locations(id) on delete restrict,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  reorder_point    integer check (reorder_point >= 0),
  reorder_quantity integer check (reorder_quantity >= 0),
  -- Optional, always. See the header: this shop has no shelf numbers.
  aisle            text check (length(aisle) <= 32),
  row              text check (length(row) <= 32),
  bin              text check (length(bin) <= 32),
  tag_code         text check (length(tag_code) <= 16),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (org_id, part_id, location_id)
);
create unique index if not exists idx_part_stock_tag on part_stock (org_id, tag_code) where tag_code is not null;
create index if not exists idx_part_stock_location on part_stock (org_id, location_id, part_id);
-- The low-stock query (I12) reads exactly this shape: a line whose reorder point is set and met.
create index if not exists idx_part_stock_reorder on part_stock (org_id, location_id)
  where reorder_point is not null and active;

alter table part_stock enable row level security;

drop policy if exists part_stock_select on part_stock;
create policy part_stock_select on part_stock for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() = any (array['admin','fleet_manager','technician','auditor','accountant'])));

drop policy if exists part_stock_write on part_stock;
create policy part_stock_write on part_stock for all
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])))
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])));

-- ── the movement ledger ─────────────────────────────────────────────────────────────────────────
-- One row of the truth (D-INV4), append-only by the trigger below (`IV011`), which fires for the
-- service role too.
--
-- `id` has NO default. That is the point: the client generates it (D-INV27), so the same UUID
-- arriving twice is the same movement and not a second one. A default would make a forgotten id
-- silently become a new movement, which is the failure this column exists to prevent.
--
-- `occurred_at` is the phone's clock and `received_at` is the server's, and they are two columns
-- rather than one because a technician who counted a shelf in a dead bay submits an hour later. The
-- RPC refuses an `occurred_at` more than 24 hours from now (`IV014`), which catches a device whose
-- clock is wrong without discarding a legitimate replay.
--
-- `supplier` is here and is NOT vendor management (D-INV14: "receiving takes a supplier name and a
-- cost"). It is on the movement rather than on the part because the same filter bought from two
-- suppliers is one part, and because 5 of 1,464 AP vouchers carry a PO number — this fleet does not
-- have a purchasing process to model.
create table if not exists part_movements (
  id               uuid primary key,
  org_id           uuid not null references organizations(id) on delete cascade,
  part_id          uuid not null references parts(id) on delete restrict,
  location_id      uuid not null references stock_locations(id) on delete restrict,
  reason           text not null
    check (reason in ('received','issued','adjusted','transferred','counted','returned')),
  adjust_reason    text check (adjust_reason in ('damaged','lost','found','expired','correction')),
  quantity_delta   integer not null,
  counted_total    integer check (counted_total >= 0),
  -- The FK arrives with `stock_count_sessions` in I5. Nullable and unconstrained until then, because
  -- a column and its first reader ship in two merges and a table that does not exist cannot be
  -- referenced by one that does.
  count_session_id uuid,
  unit_cost        numeric(12,2) check (unit_cost >= 0),
  supplier         text check (length(supplier) <= 120),
  -- Both `restrict`: a movement is the record that a part went into THAT truck, and a fleet that
  -- retires the truck has not un-issued the part. The roster has no hard delete anyway (0235).
  vehicle_id       uuid references vehicles(id) on delete restrict,
  trailer_id       uuid references trailers(id) on delete restrict,
  work_order_ref   text check (length(work_order_ref) <= 64),
  note             text check (length(note) <= 2000),
  actor_user_id    uuid,
  -- Both legs of a transfer carry the outbound leg's id here, so the pair is recoverable from the
  -- ledger. See `record_part_movement` for why a transfer is two rows written by one call.
  transfer_group_id uuid,
  blind            boolean,
  occurred_at      timestamptz not null,
  received_at      timestamptz not null default now(),
  -- An adjustment is the only reason that admits an unexplained decrease, so it is the only one that
  -- is refused without a reason. Research §2.5: every good product in the category makes an
  -- unexplained decrease impossible, because an inventory anybody can quietly write down is an
  -- inventory nobody trusts.
  constraint part_movements_adjust_needs_reason
    check (reason <> 'adjusted' or adjust_reason is not null),
  constraint part_movements_count_has_total
    check (reason <> 'counted' or counted_total is not null),
  -- D-INV5: a part is issued to exactly one unit. Not "at least one" — a row naming both a truck and
  -- a trailer cannot be attributed to either.
  constraint part_movements_one_unit
    check (vehicle_id is null or trailer_id is null)
);
create index if not exists idx_part_movements_line on part_movements (org_id, part_id, location_id, occurred_at desc);
create index if not exists idx_part_movements_recent on part_movements (org_id, occurred_at desc);
create index if not exists idx_part_movements_vehicle on part_movements (org_id, vehicle_id, occurred_at desc) where vehicle_id is not null;
create index if not exists idx_part_movements_trailer on part_movements (org_id, trailer_id, occurred_at desc) where trailer_id is not null;
create index if not exists idx_part_movements_session on part_movements (org_id, count_session_id) where count_session_id is not null;

alter table part_movements enable row level security;

drop policy if exists part_movements_select on part_movements;
create policy part_movements_select on part_movements for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() = any (array['admin','fleet_manager','technician','auditor','accountant'])));

-- INSERT only, and no UPDATE or DELETE policy at all, which is belt to the trigger's braces: a
-- browser session with `maintenance: manage` may add to the ledger and may not rewrite it.
drop policy if exists part_movements_insert on part_movements;
create policy part_movements_insert on part_movements for insert
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() = any (array['admin','fleet_manager','technician'])));

-- ── append-only, enforced (IV011) ───────────────────────────────────────────────────────────────
-- 0220's shape. Fires for the service role too, which is the whole point: the API holds the service
-- key and bypasses RLS, so RLS alone would leave the ledger editable by the one caller that matters.
create or replace function guard_part_movements_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'part_movements is append-only: a correction is a new movement'
    using errcode = 'IV011';
end;
$$;

drop trigger if exists trg_part_movements_append_only on part_movements;
create trigger trg_part_movements_append_only
  before update or delete on part_movements
  for each row
  execute function guard_part_movements_append_only();

-- ── the one door the projection moves through ───────────────────────────────────────────────────
-- `security definer` + `set search_path = ''`, service_role only. Everything below is schema-qualified
-- because the empty search_path means nothing resolves implicitly — which is the point of setting it.
--
-- (The search_path warning that applies to `auth_role()` and `auth_section_or_default` — that it
-- blocks inlining and cost the fuel-spend page 128x per row — is about STABLE sql scalars used inside
-- RLS predicates. This is a plpgsql function called once per movement; there is nothing to inline.)
--
-- ── WHY A TRANSFER IS TWO ROWS WRITTEN BY ONE CALL ──────────────────────────────────────────────
-- A transfer is stock leaving one shelf and arriving at another, and those are two ledger rows: the
-- projection is per (part, location), so one row cannot move it in two places. The step text does not
-- say where the second row comes from, and the alternative — two API calls from `transferStock` —
-- can half-fail, which destroys stock at the source and never delivers it. So both legs are written
-- here, inside the one transaction, and the inbound leg's id is DERIVED from the outbound one
-- (`md5(id || ':in')`) so that a replayed transfer is as idempotent as any other movement. Both rows
-- carry the outbound id in `transfer_group_id`; the function returns the outbound row, which is the
-- one whose id the client sent.
create or replace function record_part_movement(p_org uuid, p_actor uuid, p_row jsonb)
returns public.part_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid := (p_row->>'id')::uuid;
  v_part      uuid := (p_row->>'partId')::uuid;
  v_from      uuid := (p_row->>'locationId')::uuid;
  v_to        uuid := nullif(p_row->>'toLocationId', '')::uuid;
  v_reason    text := p_row->>'reason';
  v_occurred  timestamptz := coalesce((p_row->>'occurredAt')::timestamptz, now());
  v_qty       integer := nullif(p_row->>'quantity', '')::integer;
  v_counted   integer := nullif(p_row->>'countedTotal', '')::integer;
  v_cost      numeric(12,2) := nullif(p_row->>'unitCost', '')::numeric;
  v_onhand    integer;
  v_delta     integer;
  v_existing  public.part_movements;
  v_out       public.part_movements;
  v_active    boolean;
  v_moved     integer;
begin
  if v_id is null then
    raise exception 'a movement needs a client-generated id' using errcode = 'IV015';
  end if;

  -- 1. IDEMPOTENCY BEFORE ANYTHING ELSE. A replayed write must not re-validate, re-lock or re-move
  --    anything — it must return the row it already produced. See the header for why this cannot be
  --    the second step.
  select * into v_existing from public.part_movements m where m.id = v_id and m.org_id = p_org;
  if found then
    return v_existing;
  end if;

  -- 2. The clock. A phone whose date is wrong would otherwise file today's count under 2019 and
  --    quietly leave the shelf's history unreadable.
  if v_occurred > now() + interval '24 hours' or v_occurred < now() - interval '24 hours' then
    raise exception 'occurred_at % is more than 24 hours from now', v_occurred using errcode = 'IV014';
  end if;

  -- 3. The location, and the org boundary. The API reads with the service role and therefore bypasses
  --    RLS, so this is the layer that stops one tenant's movement landing on another's shelf.
  if not exists (select 1 from public.stock_locations l
                 where l.id = v_from and l.org_id = p_org and l.active) then
    raise exception 'unknown or inactive stock location %', v_from using errcode = 'IV012';
  end if;
  if v_reason = 'transferred' then
    if v_to is null or v_to = v_from then
      raise exception 'a transfer needs a different destination location' using errcode = 'IV012';
    end if;
    if not exists (select 1 from public.stock_locations l
                   where l.id = v_to and l.org_id = p_org and l.active) then
      raise exception 'unknown or inactive stock location %', v_to using errcode = 'IV012';
    end if;
  end if;

  -- 4. The part. A deactivated part still accepts `counted` and `adjusted`, because those are the two
  --    verbs that CORRECT a shelf — refusing them would leave a retired part's leftover quantity on
  --    the books with no way to write it down.
  select p.active into v_active from public.parts p where p.id = v_part and p.org_id = p_org;
  if not found then
    raise exception 'unknown part %', v_part using errcode = 'IV013';
  end if;
  if not v_active and v_reason not in ('counted', 'adjusted') then
    raise exception 'part % is inactive', v_part using errcode = 'IV013';
  end if;

  -- 5. The stock lines exist before the ledger touches them. A full payload, so this is not the
  --    partial upsert `lint:upserts` forbids: every not-null column is supplied and the conflict
  --    target is the whole primary key.
  insert into public.part_stock (org_id, part_id, location_id, quantity_on_hand)
  values (p_org, v_part, v_from, 0)
  on conflict (org_id, part_id, location_id) do nothing;
  if v_reason = 'transferred' then
    insert into public.part_stock (org_id, part_id, location_id, quantity_on_hand)
    values (p_org, v_part, v_to, 0)
    on conflict (org_id, part_id, location_id) do nothing;
  end if;

  -- 6. Lock the source line and read what is actually on it. `for update` is what makes a count
  --    honest: the delta below is computed against the quantity as it stands at COMMIT time, so a
  --    delivery received while the shelf was being walked is added to the count rather than erased.
  select s.quantity_on_hand into v_onhand
  from public.part_stock s
  where s.org_id = p_org and s.part_id = v_part and s.location_id = v_from
  for update;

  -- 7. The sign lives here and only here. A caller that had to decide whether `issued` is negative
  --    would eventually get it wrong in one of the five places that build a movement.
  v_delta := case v_reason
    when 'received'    then v_qty
    when 'returned'    then v_qty
    when 'issued'      then -v_qty
    when 'transferred' then -v_qty
    when 'adjusted'    then nullif(p_row->>'quantityDelta', '')::integer
    when 'counted'     then v_counted - v_onhand
  end;
  if v_delta is null then
    raise exception 'movement % (%) carries no quantity', v_id, v_reason using errcode = 'IV015';
  end if;

  insert into public.part_movements (
    id, org_id, part_id, location_id, reason, adjust_reason, quantity_delta, counted_total,
    count_session_id, unit_cost, supplier, vehicle_id, trailer_id, work_order_ref, note,
    actor_user_id, transfer_group_id, blind, occurred_at
  ) values (
    v_id, p_org, v_part, v_from, v_reason,
    nullif(p_row->>'adjustReason', ''), v_delta, v_counted,
    nullif(p_row->>'countSessionId', '')::uuid, v_cost, nullif(p_row->>'supplier', ''),
    nullif(p_row->>'vehicleId', '')::uuid, nullif(p_row->>'trailerId', '')::uuid,
    nullif(p_row->>'workOrderRef', ''), nullif(p_row->>'note', ''),
    p_actor,
    case when v_reason = 'transferred' then v_id end,
    case when p_row ? 'blind' then (p_row->>'blind')::boolean end,
    v_occurred
  )
  on conflict (id) do nothing
  returning * into v_out;

  -- The second half of D-INV27, and the one a single-threaded test never reaches. The `select` at
  -- step 1 catches a replay that arrives after the first one committed, which is every replay the
  -- offline queue actually produces. It does NOT catch two copies of the same write in flight at the
  -- same moment — a double-tap, or a queue flush racing a foreground retry — because neither
  -- transaction can see the other's uncommitted row. Without the conflict clause above, that pair
  -- raises a bare 23505 at the caller; with it, the loser falls through to here.
  --
  -- `on conflict do nothing` does not wait on the in-flight inserter, so the row may still be
  -- invisible when we look. That is a retry, not a failure, and it says so: IV016 is the one error
  -- in this function that means "ask again", and the API maps it accordingly.
  if v_out is null then
    select * into v_existing from public.part_movements m where m.id = v_id and m.org_id = p_org;
    if found then
      return v_existing;
    end if;
    raise exception 'movement % is already being recorded', v_id using errcode = 'IV016';
  end if;

  -- 8. The guarded UPDATE. `quantity_on_hand + delta >= 0` inside the predicate rather than as a
  --    check afterwards, so two technicians issuing the last filter at the same moment cannot both
  --    succeed: the second one's UPDATE matches no row (D-INV26).
  update public.part_stock s
     set quantity_on_hand = s.quantity_on_hand + v_delta,
         updated_at = now()
   where s.org_id = p_org and s.part_id = v_part and s.location_id = v_from
     and s.quantity_on_hand + v_delta >= 0;
  get diagnostics v_moved = row_count;
  if v_moved = 0 then
    raise exception 'part % at location % has % on hand and cannot move %',
      v_part, v_from, v_onhand, v_delta using errcode = 'IV010';
  end if;

  -- 9. The inbound leg of a transfer, same transaction. Its id is derived so a replay collides.
  if v_reason = 'transferred' then
    insert into public.part_movements (
      id, org_id, part_id, location_id, reason, quantity_delta, note, actor_user_id,
      transfer_group_id, occurred_at
    ) values (
      (md5(v_id::text || ':in'))::uuid, p_org, v_part, v_to, 'transferred', v_qty,
      nullif(p_row->>'note', ''), p_actor, v_id, v_occurred
    )
    on conflict (id) do nothing;

    update public.part_stock s
       set quantity_on_hand = s.quantity_on_hand + v_qty,
           updated_at = now()
     where s.org_id = p_org and s.part_id = v_part and s.location_id = v_to;
  end if;

  -- 10. Last cost (D-INV15), maintained from the only event that knows one. Not an average, not
  --     configurable, and never read by Finance.
  if v_reason = 'received' and v_cost is not null then
    update public.parts p set last_cost = v_cost, updated_at = now()
     where p.id = v_part and p.org_id = p_org;
  end if;

  return v_out;
end;
$$;

revoke all on function record_part_movement(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function record_part_movement(uuid, uuid, jsonb) to service_role;

comment on function record_part_movement(uuid, uuid, jsonb) is
  'The only writer of part_stock.quantity_on_hand (D-INV4). Idempotent on the client-generated movement id (D-INV27); refuses to go negative (IV010, D-INV26); a transfer writes both legs.';

-- ── the projection is rebuildable, which is what makes it a projection ──────────────────────────
-- If this ever returns a changed row, the ledger and the shelf have disagreed and the ledger wins.
-- The matrix asserts it is a no-op after a mixed sequence — an assertion that is only worth anything
-- because it would catch the RPC dropping a delta.
create or replace function rebuild_part_stock(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with truth as (
    select m.part_id, m.location_id, sum(m.quantity_delta)::integer as qty
      from public.part_movements m
     where m.org_id = p_org
     group by m.part_id, m.location_id
  )
  update public.part_stock s
     set quantity_on_hand = greatest(coalesce(t.qty, 0), 0),
         updated_at = now()
    from truth t
   where s.org_id = p_org
     and s.part_id = t.part_id
     and s.location_id = t.location_id
     and s.quantity_on_hand is distinct from greatest(coalesce(t.qty, 0), 0);
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function rebuild_part_stock(uuid) from public, anon, authenticated;
grant execute on function rebuild_part_stock(uuid) to service_role;

comment on function rebuild_part_stock(uuid) is
  'Recomputes part_stock.quantity_on_hand from the part_movements ledger. Returns the number of rows it had to change — a non-zero result is a defect report, not a repair.';

-- ── the photo bucket (D-INV8) ───────────────────────────────────────────────────────────────────
-- 0146's pattern, with the deliberate omission of its second half: there is NO `storage.objects`
-- policy here. Uploads go through the API with the service role and reads are signed URLs
-- (`modules/evidence/compliance.ts:186`, TTL 300s), so a client policy would grant a door nobody
-- uses. It would also break `lint:section-policies`, which reduces `storage.objects` to `objects`,
-- finds no module for it and errors — the gate is right, and the answer is not to write the policy.
insert into storage.buckets (id, name, public, file_size_limit)
values ('inventory-photos', 'inventory-photos', false, 10 * 1024 * 1024)  -- one phone photo of a part
on conflict (id) do nothing;

comment on table part_movements is
  'The shop inventory ledger (D-INV4). Append-only (IV011); every row is one change to one stock line; part_stock.quantity_on_hand is its projection.';
comment on table part_stock is
  'One part at one location. quantity_on_hand is a projection maintained only by record_part_movement; aisle/row/bin are optional because this shop has no shelf numbers.';
