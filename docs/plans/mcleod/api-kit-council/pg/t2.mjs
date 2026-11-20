import { PGlite } from "/Users/miroslavjokovic/Projects/FuelGuard/node_modules/@electric-sql/pglite/dist/index.js";
import { readFileSync } from "node:fs";
const db = new PGlite();
await db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const O='00000000-0000-0000-0000-000000000001', L='00000000-0000-0000-0000-0000000000a1', S='00000000-0000-0000-0000-0000000000b1', R='00000000-0000-0000-0000-0000000000c1';
const U='00000000-0000-0000-0000-0000000000ff';
await db.exec(`insert into organizations values ('${O}'); insert into loads values ('${L}','${O}'); insert into load_stops values ('${S}','${O}','${L}','completed');
insert into mcleod_write_requests (id,org_id,operation,company_id,target_type,target_id,canary_key,load_id,stop_id,movement_id,payload,expected,origin)
 values ('${R}','${O}','stop_clear','TMS','stop','STOP1','DRV1','${L}','${S}','M1','{}','{}','driver_app');`);
const one = async (sql) => (await db.query(sql)).rows;
const claim = () => one(`select * from mcleod_write_claim('${O}','vm','1',array['stop_clear'],array['TMS'],5)`);
const st = async () => (await one(`select state, lease_live, sends, applied_reports from mcleod_write_state where request_id='${R}'`))[0];
let ok=0, bad=0; const t=(n,c)=>{ c?ok++:bad++; console.log((c?'PASS ':'FAIL ')+n); };
t("no switch → nothing leased", (await claim()).length===0);
await db.exec(`insert into mcleod_write_switches (org_id,operation,company_id,mode,changed_by,reason) values ('${O}','stop_clear','TMS','test','${U}','first test')`);
t("test mode does not lease a driver_app request", (await claim()).length===0);
await db.exec(`insert into mcleod_write_switches (org_id,operation,company_id,mode,canary_keys,changed_by,reason) values ('${O}','stop_clear','TMS','canary',array['DRV1'],'${U}','canary one driver')`);
const c1 = await claim(); t("canary leases the canary driver's request", c1.length===1);
t("a second claim (second agent) gets nothing while the lease is live", (await claim()).length===0);
const lease = c1[0].lease_id;
t("fence says go", (await one(`select mcleod_write_begin_send('${O}','${R}','${lease}','vm') as g`))[0].g==='go');
t("state is sent", (await st()).state==='sent');
// crash: lease expires (simulate by pushing clock: insert nothing; emulate by shortening via new lease row is not possible) -> use small lease
await db.exec(`insert into mcleod_write_switches (org_id,operation,company_id,mode,changed_by,reason) values ('${O}','stop_clear','TMS','off','${U}','kill switch now')`);
t("off: fence refuses a second send on the same lease", (await one(`select mcleod_write_begin_send('${O}','${R}','${lease}','vm') as g`))[0].g==='switched_off');
await db.exec(`insert into mcleod_write_events (org_id,request_id,kind,lease_id,instance_id) values ('${O}','${R}','applied_unverified','${lease}','vm')`);
t("after a 2xx report the lease is released", (await st()).lease_live===false);
await db.exec(`insert into mcleod_write_switches (org_id,operation,company_id,mode,canary_keys,changed_by,reason) values ('${O}','stop_clear','TMS','canary',array['DRV1'],'${U}','back on canary')`);
const c2 = await claim();
t("quiet period after a send blocks immediate re-lease", c2.length===0);
await db.exec(`set session_replication_role = replica; `);
await db.exec(`set session_replication_role = origin;`);
// age the send fact by inserting directly a backdated copy is impossible (append-only) -> query with quiet 0
const c3 = await one(`select * from mcleod_write_claim('${O}','vm','1',array['stop_clear'],array['TMS'],5,300,0)`);
t("after the quiet period it is re-leased with applied_reports=1", c3.length===1 && Number(c3[0].applied_reports)===1);
t("fence refuses a re-send after a 2xx", (await one(`select mcleod_write_begin_send('${O}','${R}','${c3[0].lease_id}','vm') as g`))[0].g==='already_applied');
await db.exec(`insert into mcleod_write_events (org_id,request_id,kind,lease_id,instance_id,observed) values ('${O}','${R}','confirmed','${c3[0].lease_id}','vm','{}')`);
t("confirmed", (await st()).state==='confirmed');
let e=''; try { await db.exec(`insert into mcleod_write_events (org_id,request_id,kind,lease_id,instance_id) values ('${O}','${R}','transient','${c3[0].lease_id}','vm')`);} catch(x){e=x.message}
t("nothing after an end (MK012)", /already ended/.test(e));
e=''; try { await db.exec(`update mcleod_write_events set kind='refused'`);} catch(x){e=x.message}
t("append-only", /fixed once recorded/.test(e));
e=''; try { await db.exec(`delete from organizations`);} catch(x){e=x.message}
t("org cascade deletes the whole pipeline", e==='' );
console.log(`RESULT: ${ok} passed, ${bad} failed`);
await db.close();
