import { PGlite } from "/Users/miroslavjokovic/Projects/FuelGuard/node_modules/@electric-sql/pglite/dist/index.js";
const db = new PGlite();
const q = async (s) => { try { await db.exec(s); return "ok"; } catch (e) { return "ERR " + e.message; } };
await db.exec(`create table load_stops(id serial primary key, load_id int not null, mcleod_stop_id text, status text default 'pending',
  seq int not null, constraint load_stops_seq_check check ((seq between 1 and 50) or (seq between 101 and 150)));
create unique index idx_load_stops_load_seq on load_stops(load_id, seq);
insert into load_stops(load_id,mcleod_stop_id,status,seq) values (1,'A','completed',1),(1,'B','completed',2),(1,'C','completed',3),(1,'D','pending',4);`);
// Sweep 1: McLeod removed worked stop C; D moves to seq 3. DR-5: move incoming to band, park removed worked C in band, then final.
console.log("sweep1 band incoming:", await q(`update load_stops set seq = seq+100 where load_id=1 and mcleod_stop_id = any(array['A','B','D'])`));
console.log("sweep1 park C:", await q(`update load_stops set seq = seq+100 where load_id=1 and mcleod_stop_id='C'`));
console.log("sweep1 final:", await q(`update load_stops set seq = case mcleod_stop_id when 'A' then 1 when 'B' then 2 when 'D' then 3 end where load_id=1 and mcleod_stop_id in ('A','B','D')`));
console.log(JSON.stringify((await db.query(`select mcleod_stop_id, seq from load_stops order by seq`)).rows));
// Sweep 2: any change, e.g. ETA only; step 2 moves incoming to +100 again
console.log("sweep2 band incoming:", await q(`update load_stops set seq = seq+100 where load_id=1 and mcleod_stop_id = any(array['A','B','D'])`));
// deferrable alternative + ON CONFLICT used by old code
await db.exec(`create table s2(id serial primary key, load_id int, seq int, name text, constraint u unique(load_id,seq) deferrable initially deferred)`);
console.log("old code on conflict vs deferrable:", await q(`insert into s2(load_id,seq,name) values (1,1,'x') on conflict (load_id,seq) do update set name=excluded.name`));
