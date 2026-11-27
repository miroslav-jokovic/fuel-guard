import { PGlite } from "/Users/miroslavjokovic/Projects/FuelGuard/node_modules/@electric-sql/pglite/dist/index.js";
const db = new PGlite();
const q = async (s) => { try { const r = await db.query(s); return r.rows.length ? JSON.stringify(r.rows) : "ok (0 rows)"; } catch (e) { return "ERR " + e.message; } };
const S='00000000-0000-0000-0000-0000000000b1', A1='00000000-0000-0000-0000-0000000000a1', A2='00000000-0000-0000-0000-0000000000a2';
await db.exec(`
create table r(id uuid primary key, stop_id uuid, operation text not null,
  origin text not null check (origin in ('driver_app','office','office_retry','sweep','job','prove')),
  supersedes uuid references r(id), constraint retry check ((origin='office_retry') = (supersedes is not null)));
create unique index r_driver_stop on r(stop_id, operation) where origin='driver_app' and supersedes is null;
create unique index r_supersedes on r(supersedes) where supersedes is not null;`);
const ins = (id, origin, op='stop_clear', sup=null, conflict='on conflict do nothing') =>
  q(`insert into r values ('${id}','${S}','${op}','${origin}',${sup?`'${sup}'`:'null'}) ${conflict} returning id`);
console.log("1 first Complete:", await ins(A1,'driver_app'));
console.log("2 outbox replay same action id:", await ins(A1,'driver_app'));
console.log("3 replay with a NEW action id (team 2nd phone / reinstall), on conflict do nothing:", await ins(A2,'driver_app'));
console.log("3b same, plain insert as §2.8 sub-transaction would see it:", await ins(A2,'driver_app','stop_clear',null,''));
const R1='11111111-0000-0000-0000-000000000001', R2='11111111-0000-0000-0000-000000000002', R3='11111111-0000-0000-0000-000000000003';
console.log("4 Send again #1 (office_retry, random id, supersedes A1):", await ins(R1,'office_retry','stop_clear',A1));
console.log("5 Send again #2 also superseding A1 (double-click):", await ins(R2,'office_retry','stop_clear',A1,''));
console.log("6 Send again #2 superseding the head R1:", await ins(R2,'office_retry','stop_clear',R1,''));
console.log("7 driver_app with supersedes (retry from driver?) refused by check:", await ins(R3,'driver_app','stop_clear',A1,''));
// images: sweep enqueues per stop and kind; §2.5 index is driver_app only
const I1='22222222-0000-0000-0000-000000000001', I2='22222222-0000-0000-0000-000000000002';
console.log("8 sweep image_upload_bol:", await ins(I1,'sweep','image_upload_bol',null,''));
console.log("9 the sweep runs again / two instances: second identical image request:", await ins(I2,'sweep','image_upload_bol',null,''));
// R3-9's shape instead
await db.exec(`drop index r_driver_stop; delete from r where id='${I2}'; create unique index r9 on r(stop_id, operation) where origin <> 'office_retry';`);
console.log("10 under R3-9's index, duplicate sweep image:", await ins(I2,'sweep','image_upload_bol',null,''));
console.log("11 under R3-9's index, Send again of the image:", await ins(R3,'office_retry','image_upload_bol',I1,''));
await db.close();
