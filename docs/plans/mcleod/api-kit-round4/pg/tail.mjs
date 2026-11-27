import { PGlite } from "/Users/miroslavjokovic/Projects/FuelGuard/node_modules/@electric-sql/pglite/dist/index.js";
const db = new PGlite();
const q = async (s) => { try { const r = await db.query(s); return r.rows.length ? JSON.stringify(r.rows) : "ok"; } catch (e) { return "ERR " + e.message; } };
// Today's DDL: 0085 inline check renamed by 0423 to load_stops_seq_check (1..50), unique non-deferrable idx_load_stops_load_seq.
await db.exec(`
create table load_stops(id serial primary key, load_id int not null, mcleod_stop_id text, status text not null default 'pending',
  seq int not null, name text, constraint load_stops_seq_check check (seq >= 1 and seq <= 50));
create unique index idx_load_stops_load_seq on load_stops(load_id, seq);
create unique index uq_load_stops_load_mcleod_stop on load_stops(load_id, mcleod_stop_id);
-- S0a must widen the check for the band (§2.2 does not say this; DR-5 did)
alter table load_stops drop constraint load_stops_seq_check;
alter table load_stops add constraint load_stops_seq_check check ((seq between 1 and 50) or (seq between 101 and 150));
-- §2.2 rule: incoming -> band; removed worked -> band; delete removed pending; incoming -> final; removed -> tail
create function apply_stops(p_load int, p jsonb) returns void language plpgsql as $$
declare v_max int; begin
  update load_stops set seq = seq + 100 where load_id = p_load and mcleod_stop_id in (select x->>'id' from jsonb_array_elements(p) x);
  delete from load_stops where load_id = p_load and status = 'pending' and mcleod_stop_id not in (select x->>'id' from jsonb_array_elements(p) x);
  update load_stops set seq = seq + 100 where load_id = p_load and seq <= 50
     and mcleod_stop_id not in (select x->>'id' from jsonb_array_elements(p) x);
  update load_stops s set seq = (x->>'seq')::int, name = x->>'name' from jsonb_array_elements(p) x where s.load_id = p_load and s.mcleod_stop_id = x->>'id';
  insert into load_stops(load_id, mcleod_stop_id, seq, name)
    select p_load, x->>'id', (x->>'seq')::int, x->>'name' from jsonb_array_elements(p) x
    on conflict (load_id, mcleod_stop_id) do nothing;
  select coalesce(max((x->>'seq')::int),0) into v_max from jsonb_array_elements(p) x;
  update load_stops s set seq = v_max + r.rn from
    (select id, row_number() over (order by seq) rn from load_stops where load_id = p_load and seq > 100) r where s.id = r.id;
end $$;
insert into load_stops(load_id,mcleod_stop_id,status,seq) values (1,'A','completed',1),(1,'B','completed',2),(1,'C','completed',3),(1,'D','pending',4);
`);
const show = async () => JSON.stringify((await db.query(`select mcleod_stop_id m, status, seq from load_stops where load_id=1 order by seq`)).rows.map(r=>r.m+r.seq+(r.status==='pending'?'':'*')));
const S = (arr) => `'${JSON.stringify(arr.map(([id,seq])=>({id,seq,name:id})))}'::jsonb`;
console.log("sweep1 (C removed, D->3):", await q(`select apply_stops(1, ${S([['A',1],['B',2],['D',3]])})`), await show());
console.log("sweep2 (same):", await q(`select apply_stops(1, ${S([['A',1],['B',2],['D',3]])})`), await show());
console.log("sweep3 (E added at 4, after removed C at tail 4):", await q(`select apply_stops(1, ${S([['A',1],['B',2],['D',3],['E',4]])})`), await show());
console.log("sweep4 (swap D,E):", await q(`select apply_stops(1, ${S([['A',1],['B',2],['E',3],['D',4]])})`), await show());
console.log("band empty after commit:", await q(`select count(*) n from load_stops where seq > 50`));
// Rollback: old code = delete pending + upsert onConflict(load_id,seq) — what does it do to tail C*?
console.log("old code delete pending:", await q(`delete from load_stops where load_id=1 and status='pending'`));
console.log("old code upsert seq 5 (McLeod adds F at 5, tail C sits at 5):", await q(`insert into load_stops(load_id,mcleod_stop_id,seq,name) values (1,'F',5,'F') on conflict (load_id,seq) do update set name=excluded.name, mcleod_stop_id=excluded.mcleod_stop_id`), await show());
// Over 50: McLeod highest seq 49, two worked stops McLeod removed
await db.exec(`insert into load_stops(load_id,mcleod_stop_id,status,seq) select 2, 'S'||g, case when g in (10,11) then 'completed' else 'pending' end, g from generate_series(1,49) g`);
const big = []; let k=1; for (let g=1; g<=49; g++) { if (g===10||g===11) continue; big.push(['S'+g,k++]); } big.push(['N1',48]); big.push(['N2',49]);
console.log("tail > 50 (McLeod max 49, 2 removed worked):", await q(`select apply_stops(2, ${S(big)})`));
console.log("seqs in band left behind? load 2:", await q(`select count(*) filter (where seq>50) band, count(*) n from load_stops where load_id=2`));
// deferrable alternative vs ON CONFLICT
await db.exec(`create table s2(id serial primary key, load_id int, seq int, name text, constraint u unique(load_id,seq) deferrable initially deferred)`);
console.log("old code ON CONFLICT vs deferrable:", await q(`insert into s2(load_id,seq,name) values (1,1,'x') on conflict (load_id,seq) do update set name=excluded.name`));
await db.close();
