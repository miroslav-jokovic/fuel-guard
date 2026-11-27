import { PGlite } from "/Users/miroslavjokovic/Projects/FuelGuard/node_modules/@electric-sql/pglite/dist/index.js";
const db = new PGlite();
const q = async (s) => { try { const r = await db.query(s); return r.rows.length ? JSON.stringify(r.rows) : "ok"; } catch (e) { return "ERR " + e.message; } };
const O='00000000-0000-0000-0000-000000000001', U='00000000-0000-0000-0000-0000000000ff';
await db.exec(`
create table organizations(id uuid primary key);
create table org_integrations(org_id uuid references organizations(id), provider text, config jsonb not null default '{}', primary key(org_id,provider));
create table mcleod_write_requests(id uuid primary key default gen_random_uuid(), org_id uuid not null, operation text not null, company_id text not null,
  origin text not null check (origin in ('driver_app','office','office_retry','sweep','job','prove')),
  stop_type text, customer_id text, supersedes uuid references mcleod_write_requests(id), stop_id uuid);
create table mcleod_write_events(id uuid primary key default gen_random_uuid(), seq bigint generated always as identity, request_id uuid not null references mcleod_write_requests(id),
  kind text not null, switch_id uuid);
create table mcleod_write_switches(id uuid primary key default gen_random_uuid(), seq bigint generated always as identity, org_id uuid not null,
  operation text not null, company_id text not null, mode text not null check (mode in ('off','test','canary','live')),
  canary_scope jsonb, proven_by_request uuid references mcleod_write_requests(id), owner_signoff_by uuid, changed_by uuid not null, reason text not null,
  constraint canary_scope check ((mode='canary') = (canary_scope is not null)));
-- A literal reading of ROUND3 §2.4, as the trigger v2 would write from it
create function sw_proof() returns trigger language plpgsql as $$
declare v_tests jsonb; begin
  select coalesce(config->'mcleod'->'test_companies','[]') into v_tests from org_integrations where org_id=new.org_id and provider='mcleod';
  v_tests := coalesce(v_tests,'[]');
  if new.mode='test' and not (v_tests ? new.company_id) then raise exception 'test only on a listed test company' using errcode='MK013'; end if;
  if new.mode='canary' then
    if jsonb_array_length(v_tests) > 0 then
      if not exists (select 1 from mcleod_write_requests r join mcleod_write_events e on e.request_id=r.id and e.kind='confirmed'
                     join mcleod_write_events l on l.request_id=r.id and l.kind='leased' join mcleod_write_switches s on s.id=l.switch_id and s.mode='test'
                     where r.id=new.proven_by_request and r.org_id=new.org_id and r.operation=new.operation) then
        raise exception 'canary needs a confirmed test request' using errcode='MK013'; end if;
    elsif new.owner_signoff_by is null then raise exception 'canary needs the owner sign-off when no test company' using errcode='MK013'; end if;
  end if;
  if new.mode='live' and not exists (select 1 from mcleod_write_requests r join mcleod_write_events e on e.request_id=r.id and e.kind='confirmed'
                     join mcleod_write_events l on l.request_id=r.id and l.kind='leased' join mcleod_write_switches s on s.id=l.switch_id and s.mode='canary'
                     where r.id=new.proven_by_request and r.org_id=new.org_id and r.operation=new.operation and r.company_id=new.company_id) then
    raise exception 'live needs a confirmed canary request on this company' using errcode='MK013'; end if;
  return new; end $$;
create trigger sw_proof before insert on mcleod_write_switches for each row execute function sw_proof();
insert into organizations values ('${O}');
insert into org_integrations values ('${O}','mcleod','{"mcleod":{"test_companies":["TEST1"]}}');
`);
const sw = (mode, co, extra='') => q(`insert into mcleod_write_switches(org_id,operation,company_id,mode,changed_by,reason${extra?','+extra.split('=')[0]:''}) values ('${O}','stop_clear','${co}','${mode}','${U}','reason here'${extra?','+extra.split('=').slice(1).join('='):''}) returning id`);
console.log("1 test on live TMS (refused?):", await sw('test','TMS'));
console.log("2 canary on TMS, no proof (refused?):", await sw('canary','TMS',`canary_scope='{"stop_types":["pickup"]}'`));
// Bypass A: an admin edits org_integrations.config (a mutable jsonb) and lists TMS as a test company
await db.exec(`update org_integrations set config = jsonb_set(config,'{mcleod,test_companies}','["TEST1","TMS"]') where org_id='${O}'`);
console.log("A test on TMS after config edit (refused?):", await sw('test','TMS'));
// Bypass B: empty the list -> 'no test company' -> sign-off path; sign-off is any uuid
await db.exec(`update org_integrations set config = jsonb_set(config,'{mcleod,test_companies}','[]') where org_id='${O}'`);
console.log("B canary via sign-off after emptying list, signoff = the admin's own id:", await sw('canary','TMS',`canary_scope,owner_signoff_by='{}'::jsonb,'${U}'`));
// Bypass C: empty scope '{}' satisfies 'canary_scope is not null'
console.log("C empty canary_scope accepted:", await q(`select count(*) from mcleod_write_switches where mode='canary' and canary_scope='{}'::jsonb`));
// Bypass D: live after ONE pickup confirmed under a pickup-only canary -> EDI deliveries go live
const r = (await db.query(`insert into mcleod_write_requests(org_id,operation,company_id,origin,stop_type,customer_id) values ('${O}','stop_clear','TMS','driver_app','pickup','CUST1') returning id`)).rows[0].id;
const cs = (await db.query(`select id from mcleod_write_switches where mode='canary' order by seq desc limit 1`)).rows[0].id;
await db.exec(`insert into mcleod_write_events(request_id,kind,switch_id) values ('${r}','leased','${cs}'); insert into mcleod_write_events(request_id,kind) values ('${r}','confirmed');`);
console.log("D live from one pickup proof (scope never covered deliveries/EDI):", await sw('live','TMS',`proven_by_request='${r}'`));
await db.close();
