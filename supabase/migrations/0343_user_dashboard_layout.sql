-- 0343 — user_dashboard_layout: which Dashboard widgets a person keeps, and in what order.
--
-- D-DW2/D-DW3, docs/plans/livemap/LIVE-MAP-PLAN.md step LM10. The catalogue (`DASHBOARD_WIDGETS` in
-- packages/shared) already answers which widgets a caller MAY see — that is a gate, and it stays a
-- gate. This table answers the different question of which of them they WANT, and it can only ever
-- narrow and reorder what the gate already admitted. A row here grants nothing.
--
-- ── ROW-OR-NO-ROW IS THE THIRD STATE, AND IS WHY THIS IS A TABLE AND NOT A COLUMN ────────────────
-- D-DW3 needs three states to be distinguishable and the plan's reasoning is worth repeating,
-- because getting it wrong is silent: "I have not chosen" and "I chose to show nothing" must not be
-- the same value, or a default can never be changed again for anybody who once opened the editor.
-- A missing row is the first; a row whose `widget_keys` is empty is the second. Exactly the shape
-- `user_surface_access` (0298) already ships for the per-user surface reset, for the same reason.
--
-- ── ⚠ `hidden_keys` IS A DEVIATION FROM THE PLAN'S SCHEMA, AND IT IS FORCED BY THE PLAN'S OWN
--      DONE-WHEN ───────────────────────────────────────────────────────────────────────────────
-- LM10 specifies one array — `widget_keys`, "the visible set, in order" — and then requires that
-- "a user who hides a widget still inherits a later default change to widgets they did not touch".
-- Those cannot both hold. With a visible set alone, a widget added to the catalogue AFTER somebody
-- saved a layout is absent from their array, is therefore hidden, and is hidden from a person who
-- never made any decision about it. Every user who had ever touched the editor would be frozen at
-- the catalogue as it stood that day, which is precisely the failure the third state above exists to
-- prevent — arriving through the back door.
--
-- So the row records the user's DECISION rather than a snapshot of the screen:
--
--   · `widget_keys` — what they keep, in the order they arranged it (the plan's column, unchanged);
--   · `hidden_keys` — what they explicitly turned off.
--
-- A widget in neither array is one nobody has ruled on, and it falls to the role default. "Hide
-- everything" is still expressible and still distinct from silence: `widget_keys = '{}'` with every
-- key they were shown listed in `hidden_keys`.
--
-- Rejected: a `known_keys` column holding the catalogue as it stood at save time, which carries the
-- same information (hidden = known minus visible) but states it as a UI artefact rather than as
-- something the person decided, and goes stale in a way nobody could read off the row.
--
-- ── NO CLIENT WRITES, AND A DELIBERATELY NARROWER READ THAN 0298's ───────────────────────────────
-- `user_surface_access` is readable org-wide, because what a role may reach is not a secret from the
-- org and the permissions page shows it. A layout is not that. It is a preference somebody arranged
-- for themselves, and an admin has no more business reading it than reading a colleague's saved
-- views — the same argument `saved_views` (0278) records, and `notification_events` (0089) before
-- it. So the SELECT policy is own-row.
--
-- There is no write policy at all. That is NOT because a layout is audit-worthy — it is not, and the
-- API writes no audit row for it, unlike every other route in the `org` module. It is because this
-- repo keeps one writer per table (`lint:table-writers`), the endpoint has to validate keys against
-- the catalogue anyway, and PostgREST cannot. A layout full of keys no widget answers to is inert,
-- but it is inert the way a mess is inert.
--
-- ── NOT EVIDENCE ────────────────────────────────────────────────────────────────────────────────
-- Deliberately not in `RETENTION_FORBIDDEN`: nothing legal reads a dashboard arrangement, and the
-- row is the reader's to delete — deleting it is how "restore the default" is spelled. The cascade
-- through `memberships` is therefore correct; when somebody leaves an org, their arrangement of that
-- org's dashboard goes with them.
--
-- Rollback: drop table public.user_dashboard_layout;

create table if not exists user_dashboard_layout (
  org_id      uuid        not null,
  user_id     uuid        not null,

  -- `DashboardWidget.key` values from packages/shared/src/dashboardWidgets.ts — "dispatch.live-map".
  -- Deliberately unconstrained against a literal list, for 0296's and 0298's reason: pinning the
  -- keys would mean a migration every time the product gains a widget, paid for by constraining a
  -- column whose wrong values are inert. The resolver looks each key up in the catalogue and drops
  -- what it does not recognise, so a stale key shows nothing and hides nothing.
  --
  -- The ceilings are there so a row cannot be used as storage, not to describe the catalogue: they
  -- are an order of magnitude above the ten widgets that exist, and `array_position(… , null)`
  -- refuses a null element, which would otherwise read back as a key matching nothing.
  widget_keys text[]      not null default '{}'
                          check (coalesce(array_length(widget_keys, 1), 0) <= 64
                                 and array_position(widget_keys, null) is null),
  hidden_keys text[]      not null default '{}'
                          check (coalesce(array_length(hidden_keys, 1), 0) <= 64
                                 and array_position(hidden_keys, null) is null),

  -- Kept and hidden are answers to the same question, so a key cannot be both. Without this the
  -- resolver would have to pick a winner, and whichever it picked would be a rule living in code
  -- that the data is free to contradict.
  check (not (widget_keys && hidden_keys)),

  updated_at  timestamptz not null default now(),

  primary key (org_id, user_id),

  -- `memberships` carries UNIQUE (org_id, user_id), which makes this reference legal, and it buys
  -- three things at once the way 0298's does: a layout cannot name a non-member, deleting the org
  -- cascades to here through the membership, and removing a member takes their layout with them.
  foreign key (org_id, user_id) references memberships (org_id, user_id) on delete cascade
);

alter table user_dashboard_layout enable row level security;

-- Own row only — see the header. `for select` and nothing else: the API is the only writer.
drop policy if exists user_dashboard_layout_own on user_dashboard_layout;
create policy user_dashboard_layout_own on user_dashboard_layout for select
  using (org_id = auth_org_id() and user_id = auth_user_id());

-- A row cannot be walked into another tenant by an update (0161's invariant, applied here too).
drop trigger if exists trg_user_dashboard_layout_org_immutable on user_dashboard_layout;
create trigger trg_user_dashboard_layout_org_immutable
  before update on user_dashboard_layout
  for each row execute function forbid_org_change();

drop trigger if exists trg_user_dashboard_layout_updated on user_dashboard_layout;
create trigger trg_user_dashboard_layout_updated
  before update on user_dashboard_layout
  for each row execute function set_updated_at();

comment on table user_dashboard_layout is
  'One person''s Dashboard arrangement (D-DW3). Narrows and reorders what the widget gates already
   admitted; it can never grant a widget. Three states: no row = inherit the role default, empty
   `widget_keys` = "show me nothing", a list = that list in that order. `hidden_keys` is what they
   turned off, and a key in neither array is one they have not ruled on, so it still follows the
   default — see the migration header for why one array could not express that. Own-row read,
   service-role writes only. Not evidence.';
