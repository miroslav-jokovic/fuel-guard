import { PGlite } from "/Users/miroslavjokovic/Projects/FuelGuard/node_modules/@electric-sql/pglite/dist/index.js";
import { readFileSync } from "node:fs";
const db = new PGlite();
await db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const O='00000000-0000-0000-0000-000000000001';
await db.exec(`insert into organizations values ('${O}');`);
await db.exec(`insert into mcleod_write_switches (org_id,operation,company_id,mode,canary_keys,changed_by,reason) values ('${O}','stop_clear','TMS','canary',array['D'],gen_random_uuid(),'x x x x x')`);
// 8 days x 700/day = 5600 requests, all but 20 confirmed; + 250k old confirmed
await db.exec(`
insert into mcleod_write_requests (id,org_id,operation,company_id,target_type,target_id,canary_key,payload,expected,origin,requested_at)
select gen_random_uuid(),'${O}','stop_clear','TMS','stop','S'||g,'D','{}','{}','prove', now() - (g * interval '1 minute')*1.8
from generate_series(1, 260000) g;
insert into mcleod_write_events (org_id,request_id,kind,lease_id,instance_id)
select org_id,id,'confirmed',gen_random_uuid(),'vm' from mcleod_write_requests where target_id not in (select 'S'||g from generate_series(1,20) g);
analyze;`);
for (let i=0;i<3;i++){ const t0=performance.now(); const r=(await db.query(`select * from mcleod_write_claim('${O}','vm','1',array['stop_clear'],array['TMS'],5)`)).rows; console.log('claim ms', Math.round(performance.now()-t0), 'leased', r.length); }
const t0=performance.now(); await db.query(`select count(*) from mcleod_write_requests r where r.org_id='${O}' and r.requested_at <= now()-interval '72 hours' and not exists (select 1 from mcleod_write_events e where e.request_id=r.id and e.kind in ('confirmed','refused','conflict'))`); console.log('daily unbounded sweep ms', Math.round(performance.now()-t0));
const t1=performance.now(); const v=(await db.query(`select state, count(*) from mcleod_write_state where org_id='${O}' and stop_id is null and request_id in (select id from mcleod_write_requests where target_id in ('S1','S2','S3','S500','S9000')) group by 1`)).rows; console.log('driver read ms', Math.round(performance.now()-t1), JSON.stringify(v));
await db.close();
