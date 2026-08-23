/**
 * Table-driven cross-tenant isolation coverage (audit 2026-08-09, Stage 2.2).
 *
 * WHY THIS EXISTS. The RLS matrix passed 209/209 with tenant isolation deliberately broken. Seeding
 * `using (true)` into ftxn_select, drivers_select or anomalies_select — every org's fuel data, driver
 * PII and anomalies world-readable — changed nothing: 209 passed, 0 failed, identical to baseline.
 * Four of six seeded policy regressions survived.
 *
 * The reason was narrow and boring: the matrix asserted cross-tenant reads on exactly ONE table
 * (`vehicles`). Everything else it checked about those tables was DRIVER-SCOPE narrowing, which is
 * enforced by independent RESTRICTIVE policies from 0083 and still holds when the permissive org
 * filter is thrown wide open. So the assertions kept passing while the tenant boundary was gone.
 *
 * Hand-written per-table assertions cannot fix that, because the failure mode is a table nobody
 * remembered to write one for. This module therefore DISCOVERS the tables from the live catalog at
 * run time and asserts every one of them, so a new table is covered the moment it is created and an
 * uncoverable one is reported rather than skipped.
 *
 * THE SHAPE OF THE ASSERTION. For each RLS table carrying an org_id: make sure at least one row
 * exists belonging to org B, then read it back as a user in org A and require zero rows. A vacuous
 * pass (no row to see) is the thing to avoid above all — an empty table trivially returns 0 and would
 * report as isolation it never tested — so a table this module cannot seed is a FAILURE, not a skip.
 */

/** RLS tables that legitimately have no org_id. Each entry is a decision, not an oversight. */
const NO_ORG_COLUMN = {
  organizations: "the tenant row itself — scoped by `id = auth_org_id()`, asserted separately",
  notification_reads:
    "user-keyed read markers with no org_id column at all (0089); scoped by user_id. " +
    "That it CANNOT be org-scoped even in principle is itself a finding (audit §3.8) — " +
    "if an org_id is ever added here, delete this entry and let the loop cover it.",
  fuel_prices_posted: "global posted retail prices shared across organizations (0063)",
  fuel_stations: "global station registry facts shared across organizations (0058)",
  geocode_cache: "global station geocode cache shared across organizations (0018)",
  migration_markers: "service-only migration bookkeeping with no tenant data (0026)",
  platform_admins: "platform control-plane authority, service-role only (0070)",
  platform_audit_log: "platform-wide control-plane audit trail, service-role only (0071)",
  route_geometries: "global geographic route cache shared across organizations (0059)",
  weather_cache: "global weather cache shared across organizations, service-role only (0049)",
};

const q = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** One round trip each; the catalog does not change while the matrix runs. */
async function introspect(db) {
  const cols = (
    await db.query(`
    select c.relname as tbl, a.attname as col,
           format_type(a.atttypid, a.atttypmod) as typ,
           t.typtype, t.typname,
           a.attnotnull as notnull,
           (d.adbin is not null) as has_default,
           a.attidentity <> '' as is_identity,
           a.attgenerated <> '' as is_generated
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      join pg_type t on t.oid = a.atttypid
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname, a.attnum`)
  ).rows;

  const fks = (
    await db.query(`
    select con.conrelid::regclass::text as tbl,
           a.attname  as col,
           con.confrelid::regclass::text as ftbl,
           af.attname as fcol
      from pg_constraint con
      join pg_attribute a  on a.attrelid  = con.conrelid  and a.attnum  = con.conkey[1]
      join pg_attribute af on af.attrelid = con.confrelid and af.attnum = con.confkey[1]
     where con.contype = 'f' and array_length(con.conkey, 1) = 1`)
  ).rows;

  const pks = (
    await db.query(`
    select con.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.contype = 'p' and array_length(con.conkey, 1) = 1`)
  ).rows;

  const checks = (
    await db.query(`
    select c.relname as tbl, pg_get_constraintdef(con.oid) as def
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and con.contype = 'c'`)
  ).rows;

  const enums = (
    await db.query(`
    select t.typname, e.enumlabel
      from pg_type t join pg_enum e on e.enumtypid = t.oid
     order by e.enumsortorder`)
  ).rows;

  const tables = (
    await db.query(`
    select c.relname as tbl, c.relrowsecurity as rls,
           exists(select 1 from pg_attribute a
                   where a.attrelid = c.oid and a.attname = 'org_id'
                     and a.attnum > 0 and not a.attisdropped) as has_org
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by 1`)
  ).rows;

  const byTable = new Map();
  for (const c of cols) {
    if (!byTable.has(c.tbl)) byTable.set(c.tbl, []);
    byTable.get(c.tbl).push(c);
  }
  const fkOf = new Map(); // "tbl.col" -> {ftbl,fcol}
  for (const f of fks) fkOf.set(`${f.tbl.replace(/^public\./, "")}.${f.col}`, f);
  const pkOf = new Map();
  for (const p of pks) pkOf.set(p.tbl.replace(/^public\./, ""), p.col);
  const checkOf = new Map();
  for (const c of checks) {
    if (!checkOf.has(c.tbl)) checkOf.set(c.tbl, []);
    checkOf.get(c.tbl).push(c.def);
  }
  const enumOf = new Map();
  for (const e of enums) {
    if (!enumOf.has(e.typname)) enumOf.set(e.typname, []);
    enumOf.get(e.typname).push(e.enumlabel);
  }
  return { byTable, fkOf, pkOf, checkOf, enumOf, tables };
}

/**
 * A literal this column is allowed to hold, read out of its CHECK constraint.
 * `status text not null check (status in ('a','b'))` is common here, and 'x' would violate it.
 */
function literalFromCheck(meta, table, col) {
  for (const def of meta.checkOf.get(table) ?? []) {
    if (!new RegExp(`\\b${col}\\b`).test(def)) continue;
    const m = def.match(/'([^']+)'::/) ?? def.match(/'([^']+)'/);
    if (m) return m[1];
  }
  return null;
}

/**
 * A jsonb literal that satisfies whatever shape a CHECK demands of this column.
 *
 * The default `'{}'` is right for the payload columns that make up most of this schema, and wrong for
 * any table whose jsonb is a fixed-length ARRAY — `seven_day_statements.days` is seven days by
 * §395.8(j)(2), pinned in the database because it can never legitimately be six. Seeding an object
 * into it reads as "this table cannot be seeded", which is the harness blaming a schema that is
 * perfectly correct.
 *
 * So the check is read, the same way `literalFromCheck` reads one for text: `jsonb_typeof(x) =
 * 'array'` gives `'[]'`, and a `jsonb_array_length(x) = N` beside it fills N nulls.
 */
function jsonbFromCheck(meta, table, col) {
  for (const def of meta.checkOf.get(table) ?? []) {
    if (!new RegExp(`\\b${col}\\b`).test(def)) continue;
    if (!/jsonb_typeof\s*\([^)]*\)\s*=\s*'array'/.test(def)) continue;
    const len = def.match(/jsonb_array_length\s*\([^)]*\)\s*=\s*(\d+)/);
    const n = len ? Number(len[1]) : 0;
    return `'[${Array.from({ length: n }, () => "null").join(",")}]'::jsonb`;
  }
  return null;
}

/** A minimal, constraint-satisfying literal for one column. */
function valueFor(meta, table, c, orgId, tsIndex = 0) {
  if (c.col === "org_id") return `'${orgId}'::uuid`;
  if (c.col === "card_last4") return "'0000'";
  if (c.typtype === "e") {
    const labels = meta.enumOf.get(c.typname) ?? [];
    if (labels.length) return `'${labels[0]}'`;
  }
  if (c.typ.endsWith("[]")) return `'{}'::${c.typ}`;
  const t = c.typ;
  if (t === "uuid") return "gen_random_uuid()";
  if (/^(text|character varying|character|citext|name)/.test(t)) {
    const literal = literalFromCheck(meta, table, c.col);
    // A CHECK pins the value; otherwise make it UNIQUE. Several tables carry unique indexes over a
    // free-text business key (loads.ref is the one that bit first), and seeding two rows with the
    // same placeholder collides — which reads as "cannot seed" when the schema is in fact fine.
    return literal ? `'${literal}'` : `('x-' || gen_random_uuid()::text)`;
  }
  if (/^(smallint|integer|bigint|numeric|real|double precision)/.test(t)) return "1";
  if (t === "boolean") return "false";
  if (/^timestamp|^date$|^time/.test(t)) {
    // Successive timestamp columns get strictly increasing values. `check (window_end > window_start)`
    // is a common idiom in this schema, and filling every timestamp with `now()` violates it — which
    // shows up as "cannot seed" for a table whose schema is perfectly fine. Columns are visited in
    // attnum order, so the later one wins.
    return tsIndex === 0 ? "now()" : `now() + interval '${tsIndex} minute'`;
  }
  if (t === "jsonb" || t === "json") return jsonbFromCheck(meta, table, c.col) ?? `'{}'::${t}`;
  if (t === "inet" || t === "cidr") return `'127.0.0.1'::${t}`;
  if (t === "bytea") return "'\\x'::bytea";
  if (t === "interval") return "'1 hour'::interval";
  return `'x'`;
}

/**
 * Insert one minimal row into `table` for `orgId`, creating any NOT NULL parents it needs, and
 * return its primary key. Runs as the migration owner, so RLS is not in the path — this is setup,
 * not the thing under test.
 */
async function seed(db, meta, table, orgId, inProgress = new Set()) {
  if (inProgress.has(table)) return null; // NOT NULL FK cycle — reported by the caller
  inProgress.add(table);
  try {
    const cols = meta.byTable.get(table) ?? [];
    const pk = meta.pkOf.get(table);
    const names = [];
    const values = [];
    let tsSeen = 0;

    for (const c of cols) {
      const required = c.notnull && !c.has_default && !c.is_identity && !c.is_generated;
      const isPk = c.col === pk;
      if (!required && !(isPk && !c.has_default && !c.is_identity)) continue;
      if (c.is_generated) continue;

      const fk = meta.fkOf.get(`${table}.${c.col}`);
      if (fk && c.col !== "org_id") {
        const parent = fk.ftbl.replace(/^public\./, "");
        let parentId;
        if (parent === "auth.users") {
          parentId = (
            await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
          ).rows[0].id;
        } else if (parent.includes(".")) {
          continue; // a non-public, non-auth parent we do not model; let the insert speak
        } else {
          parentId = await seed(db, meta, parent, orgId, inProgress);
          if (parentId === null) return null;
        }
        names.push(q(c.col));
        values.push(`'${parentId}'`);
        continue;
      }
      names.push(q(c.col));
      values.push(valueFor(meta, table, c, orgId, /^timestamp|^date$|^time/.test(c.typ) ? tsSeen++ : 0));
    }

    const returning = pk ? ` returning ${q(pk)}` : "";
    const sql = names.length
      ? `insert into public.${q(table)} (${names.join(", ")}) values (${values.join(", ")})${returning}`
      : `insert into public.${q(table)} default values${returning}`;
    const res = await db.query(sql);
    return pk ? res.rows[0][pk] : true;
  } finally {
    inProgress.delete(table);
  }
}

/**
 * Assert that no RLS table leaks rows across tenants, for every such table in the schema.
 *
 * `ok(name, cond, extra)` is the matrix's own assertion helper; `asUser(claims, sql)` runs a query as
 * a non-privileged role with JWT claims. `viewer` must belong to `orgA` and must NOT be a member of
 * `orgB` — it is the party that must see nothing.
 *
 * `asAnon` runs a query as the real `anon` role with NO JWT claims — an unauthenticated caller
 * holding nothing but the publishable anon key that ships in every browser bundle. When supplied,
 * every covered table is also asserted to return NOTHING to that party. This harness had never once
 * tested as anon, which mattered: the missing function REVOKEs found in Stage 1 were callable by
 * `anon`, not merely by `authenticated`.
 *
 * `handSeed` is the escape hatch for tables the generic synthesiser cannot build — typically a
 * multi-column CHECK it has no way to reason about. Each entry is `table: (orgId) => sql`, and it is
 * deliberately a visible, shrinking list rather than a skip: a table that is hard to seed still has
 * to be covered, and writing three lines of INSERT is cheaper than discovering later that it never
 * was.
 */
export async function assertTenantIsolation({ db, asUser, ok, orgA, orgB, viewer, handSeed = {}, asAnon = null }) {
  const meta = await introspect(db);

  // Before anything else: a tenant table that never had RLS turned on would be filtered out of the
  // loop below and its absence would look exactly like coverage. Assert the precondition first, so
  // "forgot to enable RLS" fails loudly instead of quietly reducing what gets tested.
  const unprotected = meta.tables.filter((t) => t.has_org && !t.rls).map((t) => t.tbl);
  ok(
    "every table with an org_id has row level security ENABLED",
    unprotected.length === 0,
    unprotected.join(", "),
  );

  const rlsTables = meta.tables.filter((t) => t.rls);

  const covered = [];
  const unseedable = [];
  const exempt = [];

  for (const t of rlsTables) {
    if (!t.has_org) {
      const reason = NO_ORG_COLUMN[t.tbl];
      if (reason) exempt.push(t.tbl);
      else unseedable.push([t.tbl, "has no org_id column and is not a documented exemption"]);
      continue;
    }

    // Is there already an org B row (seeded by the matrix itself)? If not, make one.
    const existing = await db.query(
      `select count(*)::int as n from public.${q(t.tbl)} where org_id = $1`,
      [orgB],
    );
    if (existing.rows[0].n === 0) {
      try {
        const custom = handSeed[t.tbl];
        const id = custom ? (await db.exec(custom(orgB)), true) : await seed(db, meta, t.tbl, orgB);
        if (id === null) {
          unseedable.push([t.tbl, "NOT NULL foreign-key cycle — needs a hand-written seed"]);
          continue;
        }
      } catch (e) {
        unseedable.push([t.tbl, String(e.message).split("\n")[0]]);
        continue;
      }
    }
    covered.push(t.tbl);
  }

  // The assertion proper. One per table, so a regression names the table it broke.
  let leaked = 0;
  let anonLeaks = 0;
  for (const tbl of covered) {
    const r = await asUser(
      viewer,
      `select count(*)::int n from public.${q(tbl)} where org_id = $1`,
      [orgB],
    );
    // An ERROR is not a pass. A table the viewer cannot even query is reported as such, because
    // "permission denied" and "correctly filtered to zero" are different facts.
    const isolated = !r.error && r.rows?.[0]?.n === 0;
    if (!isolated) leaked++;
    ok(
      `tenant isolation: ${tbl} leaks nothing to another org`,
      isolated,
      r.error ? `ERROR ${r.error}` : `saw ${r.rows?.[0]?.n} org-B row(s)`,
    );

    if (asAnon) {
      // Not "no other org's rows" — NO rows. An unauthenticated caller has no org, so every policy
      // of the form `org_id = auth_org_id()` compares against NULL and must match nothing at all.
      const a = await asAnon(`select count(*)::int n from public.${q(tbl)}`);
      const locked = !a.error && a.rows?.[0]?.n === 0;
      if (!locked) anonLeaks++;
      ok(
        `anon lockout: ${tbl} returns nothing without a session`,
        locked,
        a.error ? `ERROR ${a.error}` : `saw ${a.rows?.[0]?.n} row(s)`,
      );
    }
  }

  // Coverage is itself an assertion. Without this, a table that silently stopped being seeded would
  // simply drop out of the loop and the matrix would get quieter, not redder.
  ok(
    `tenant isolation covers every RLS table with an org_id (${covered.length} covered, ${exempt.length} documented exemptions)`,
    unseedable.length === 0,
    unseedable.map(([t, why]) => `${t}: ${why}`).join(" | "),
  );

  return { covered: covered.length, exempt: exempt.length, unseedable, leaked, anonLeaks };
}
