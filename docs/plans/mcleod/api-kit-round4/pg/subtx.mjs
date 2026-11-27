import { PGlite } from "/Users/miroslavjokovic/Projects/FuelGuard/node_modules/@electric-sql/pglite/dist/index.js";
const db = new PGlite();
const q = async (s) => { try { const r = await db.query(s); return JSON.stringify(r.rows); } catch (e) { return "ERR " + (e.code ?? "") + " " + e.message; } };
await db.exec(`
create table evidence(id serial primary key, note text);
create table req(id int primary key, payload jsonb check (octet_length(payload::text) <= 20));
create unique index req_u on req ((payload->>'stop')) ;
create table alerts(note text);
-- §2.8 as written: catch every error except 40001/40P01, re-raise those; record enqueue_failed
create function complete(p_mode text) returns text language plpgsql as $$
declare v_note text := 'requested'; begin
  insert into evidence(note) values ('stop_completed');
  begin
    if p_mode = 'check' then insert into req values (1, '{"x":"aaaaaaaaaaaaaaaaaaaaaaaa"}');
    elsif p_mode = 'dup' then insert into req values (2, '{"stop":"s"}'); insert into req values (3, '{"stop":"s"}');
    elsif p_mode = 'serial' then raise exception 'ser' using errcode = '40001';
    elsif p_mode = 'deadlock' then raise exception 'dl' using errcode = '40P01';
    elsif p_mode = 'cast' then perform 'x'::int;
    elsif p_mode = 'custom' then raise exception 'mk' using errcode = 'MK010';
    elsif p_mode = 'cancel' then raise exception 'c' using errcode = '57014';
    end if;
  exception
    when serialization_failure or deadlock_detected then raise;   -- re-raise
    when others then v_note := 'enqueue_failed:' || sqlstate; insert into alerts values (v_note);
  end;
  update evidence set note = note || '/' || v_note where id = currval('evidence_id_seq');
  return v_note; end $$;
-- variant: re-raise written inside a WHEN OTHERS by sqlstate test
create function complete2(p_mode text) returns text language plpgsql as $$
declare v_note text := 'requested'; begin
  insert into evidence(note) values ('c2');
  begin
    if p_mode = 'serial' then raise exception 'ser' using errcode = '40001'; end if;
    if p_mode = 'deadlock' then raise exception 'dl' using errcode = '40P01'; end if;
  exception when others then
    if sqlstate in ('40001','40P01') then raise; end if;
    v_note := 'enqueue_failed:' || sqlstate;
  end;
  return v_note; end $$;
`);
for (const m of ['ok','check','dup','cast','custom','serial','deadlock','cancel']) {
  await db.exec('delete from evidence; delete from req; delete from alerts');
  const r = await q(`select complete('${m}')`);
  console.log(m.padEnd(9), r, "| evidence:", await q(`select note from evidence`), "| req:", await q(`select count(*) from req`), "| alerts:", await q(`select count(*) from alerts`));
}
for (const m of ['serial','deadlock']) { await db.exec('delete from evidence'); console.log('complete2', m, await q(`select complete2('${m}')`), await q(`select count(*) from evidence`)); }
await db.close();
