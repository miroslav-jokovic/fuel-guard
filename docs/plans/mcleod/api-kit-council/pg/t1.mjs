import { PGlite } from "/Users/miroslavjokovic/Projects/FuelGuard/node_modules/@electric-sql/pglite/dist/index.js";
const db = new PGlite();
const q = async (s) => { try { const r = await db.exec(s); return "ok"; } catch (e) { return "ERR " + e.message; } };
console.log(await q(`
create table organizations(id int primary key);
create table loads(id int primary key, org_id int not null references organizations(id) on delete cascade);
create table load_stops(id int primary key, org_id int not null references organizations(id) on delete cascade, load_id int not null references loads(id) on delete cascade);
create table reqs(id int primary key, org_id int not null references organizations(id) on delete cascade,
  load_id int references loads(id) on delete restrict, stop_id int references load_stops(id) on delete restrict,
  supersedes int references reqs(id) on delete restrict);
create table evs(id int primary key, org_id int not null references organizations(id) on delete cascade, request_id int not null references reqs(id) on delete restrict);
insert into organizations values (1),(2);
insert into loads values (10,1),(20,2);
insert into load_stops values (100,1,10),(200,2,20);
insert into reqs values (1000,1,10,100,null),(1001,1,10,100,1000),(2000,2,20,200,null);
insert into evs values (1,1,1000),(2,1,1001),(3,2,2000);
`));
console.log("delete org1:", await q(`delete from organizations where id=1`));
console.log("delete stop 200:", await q(`delete from load_stops where id=200`));
console.log("delete load 20:", await q(`delete from loads where id=20`));
// reversed creation order: reqs FK created before loads cascade? simulate variant where org->loads FK newer
console.log(await q(`
create table o2(id int primary key);
create table r2(id int primary key, org_id int not null references o2(id) on delete cascade, load_id int);
create table l2(id int primary key, org_id int not null);
alter table r2 add foreign key (load_id) references l2(id) on delete restrict;
alter table l2 add foreign key (org_id) references o2(id) on delete cascade;
insert into o2 values (1); insert into l2 values (10,1); insert into r2 values (1,1,10);`));
console.log("delete o2 (loads FK newer):", await q(`delete from o2 where id=1`));
await db.close();
