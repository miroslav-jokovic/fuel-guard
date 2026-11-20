import { PGlite } from "/Users/miroslavjokovic/Projects/FuelGuard/node_modules/@electric-sql/pglite/dist/index.js";
const db = new PGlite();
const q = async (s) => { try { const r = await db.query(s); return JSON.stringify(r.rows); } catch (e) { return "ERR " + e.message; } };
await db.exec(`
create function no_update() returns trigger language plpgsql as $$ begin raise exception 'append-only' using errcode='MK011'; end $$;
create table req(id int primary key);
create sequence mw_seq;
create table attempts(id uuid primary key default gen_random_uuid(), seq bigint not null default nextval('mw_seq') unique,
  request_id int not null references req(id), kind text check (kind in ('leased','send_started','transient')), lease_id uuid,
  lease_expires_at timestamptz, not_before timestamptz, reason_code text, at timestamptz default clock_timestamp());
-- variant A: business facts with an FK to the lease row
create table events_fk(id uuid primary key default gen_random_uuid(), seq bigint not null default nextval('mw_seq') unique,
  request_id int not null references req(id), kind text, lease_id uuid references attempts(id) on delete set null, not_before timestamptz);
create trigger ev_fk_noupd before update on events_fk for each row execute function no_update();
-- variant B: no FK
create table events(id uuid primary key default gen_random_uuid(), seq bigint not null default nextval('mw_seq') unique,
  request_id int not null references req(id), kind text check (kind in ('applied_unverified','confirmed','refused','conflict','enqueue_failed','already_in_mcleod')),
  lease_id uuid, not_before timestamptz, reason_code text);
create trigger ev_noupd before update on events for each row execute function no_update();
insert into req values (1),(2);
`);
const L = (await db.query(`insert into attempts(request_id,kind,lease_expires_at) values (1,'leased', now()+interval '300 s') returning id`)).rows[0].id;
await db.exec(`update attempts set lease_id=id where id='${L}'`);
await db.exec(`insert into attempts(request_id,kind,lease_id) values (1,'send_started','${L}')`);
await db.exec(`insert into events(request_id,kind,lease_id,not_before) values (1,'applied_unverified','${L}', now()+interval '60 s')`);
await db.exec(`insert into attempts(request_id,kind,lease_id,reason_code,not_before) values (1,'transient','${L}','not_visible_yet', now()+interval '120 s')`);
await db.exec(`insert into events_fk(request_id,kind,lease_id) values (1,'confirmed','${L}')`);
// claim-side derivations across both tables
console.log("state:", await q(`select
  (select count(*) from attempts a where a.request_id=1 and a.kind='send_started') sends,
  (select max(at) from attempts a where a.request_id=1 and a.kind='send_started') last_send,
  greatest((select max(not_before) from attempts where request_id=1),(select max(not_before) from events where request_id=1)) not_before,
  (select id from attempts where request_id=1 and kind='leased' order by seq desc limit 1) = '${L}' newest_lease_found,
  (select count(*) from attempts t where t.request_id=1 and t.kind='transient' and t.reason_code='not_visible_yet'
     and t.seq > (select min(seq) from events e where e.request_id=1 and e.kind='applied_unverified')) not_visible_after_applied`));
// 90-day purge of attempts while a business fact points at the lease
console.log("purge with FK set null on append-only events:", await q(`delete from attempts where request_id=1`));
await db.exec(`delete from events_fk`); console.log("purge with no FK:", await q(`delete from attempts where request_id=1 returning kind`));
console.log("orphan lease ref left in events (no FK):", await q(`select kind, lease_id is not null has_lease from events`));
await db.close();
