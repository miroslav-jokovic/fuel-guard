// ONE-OFF, READ-ONLY: export the registration and annual-inspection papers the office attached to trucks
// and trailers in McLeod, for `pnpm --filter @silvicom/api mcleod:import-unit-papers` (UNIT-FILES-PLAN,
// McLeod unit-papers import, owner 2026-10-20).
//
// Where they are: `comments.attachment` (varbinary), parent_row_type T = tractor, E = trailer, measured on
// the sandbox 2026-10-20. The connector's live login is REFUSED on `comments`, so this runs against the
// sandbox restore (`--env-file=.env.sandbox`) until Alex grants a read; it says which database and which
// restore it read, and the importer records both on every paper it files.
//
// Not part of the connector, and deliberately not on its connection (`connection.mjs`): the connector's
// 15-second statement budget is for the live dispatch database during business hours, and one attachment
// here is up to 11 MB. SELECT only; one attachment per query, never the whole set in one result.
//
// The keyword pre-filter is BROAD on purpose — it only decides what is copied out. What a paper is, and
// whether it is filed, is the importer's `classifyMcleodPaper`, which is tested.
//
// Usage (from tools/mcleod-agent): node --env-file=.env.sandbox oneoff/export-unit-papers.mjs <outDir>
// Writes <outDir>/files/<commentId>.bin and <outDir>/manifest.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import sql from "mssql";

const out = process.argv[2];
if (!out) throw new Error("outDir required");
mkdirSync(`${out}/files`, { recursive: true });

const pool = await sql.connect({
  server: process.env.MCLEOD_SQL_SERVER,
  port: Number(process.env.MCLEOD_SQL_PORT || 1433),
  database: process.env.MCLEOD_SQL_DATABASE,
  user: process.env.MCLEOD_SQL_USER,
  password: process.env.MCLEOD_SQL_PASSWORD,
  options: { encrypt: process.env.MCLEOD_SQL_ENCRYPT === "true", trustServerCertificate: true },
  requestTimeout: 600000,
});

const db = (await pool.request().query("select db_name() db, (select max(restore_date) from msdb.dbo.restorehistory where destination_database_name = db_name()) restored")).recordset[0];

const X = "upper(isnull(c.attach_filename,'') + ' ' + isnull(cast(c.comments as varchar(400)),''))";
const where = `c.parent_row_type in ('T','E') and c.attachment is not null and (${X} like '%IRP%' or ${X} like '%REGIST%' or ${X} like '%REG %' or ${X} like '%TEMP%' or ${X} like '%CAB CARD%' or ${X} like '%PLATE%' or ${X} like '%ANNUAL%' or ${X} like '%INSPECT%')`;

// Ids first, then one attachment at a time: never 1.4 GB in one result set.
const ids = (await pool.request().query(`select rtrim(c.id) id from comments c where ${where} order by c.entered_date, c.id`)).recordset.map((r) => r.id);
const manifest = [];
for (const id of ids) {
  const r = (await pool.request().input("id", sql.Char(32), id).query(
    `select rtrim(c.id) comment_id, c.company_id, c.parent_row_type, rtrim(c.parent_row_id) unit_id, c.entered_date,
            rtrim(c.entered_user_id) entered_by, rtrim(c.attach_filename) filename, rtrim(c.comment_type_id) comment_type,
            cast(c.comments as varchar(2000)) text, c.attachment
       from comments c where c.id = @id`,
  )).recordset[0];
  const bytes = Buffer.from(r.attachment);
  writeFileSync(`${out}/files/${r.comment_id}.bin`, bytes);
  manifest.push({
    commentId: r.comment_id,
    companyId: String(r.company_id ?? "").trim(),
    parentType: r.parent_row_type,
    mcleodUnitId: r.unit_id,
    enteredAt: r.entered_date ? new Date(r.entered_date).toISOString() : null,
    enteredBy: r.entered_by,
    filename: r.filename,
    commentType: r.comment_type,
    text: (r.text ?? "").replace(/\s+/g, " ").trim(),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await pool.close();
writeFileSync(`${out}/manifest.json`, JSON.stringify({ source: db.db, restoredAt: db.restored, exportedAt: new Date().toISOString(), papers: manifest }, null, 1));
console.log(JSON.stringify({ source: db.db, restoredAt: db.restored, papers: manifest.length, mb: Math.round(manifest.reduce((s, p) => s + p.bytes, 0) / 1048576) }));
