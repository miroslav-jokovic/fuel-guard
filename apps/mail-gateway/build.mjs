// The gateway's Lambda bundle (BROKER-MAIL-READER-PLAN §6 Build): one ESM file, `dist/index.mjs`,
// with every dependency inside it, zipped as `dist/mail-gateway.zip`.
//
// The ONLY value built in is the commit, from MAILGW_COMMIT (the deploy job sets it to the commit it
// builds). It is the same for staging and production by definition, so production runs exactly the
// bytes staging ran — the zip is stored once per commit in a write-once bucket (setup.sh), and the
// production job deploys that object rather than building its own (§6 Production deploy).
//
// The zip is made deterministic: fixed file times and no extra attributes, so building the same commit
// twice gives the same bytes (and the hotfix path's own build matches the object staging stored).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, utimesSync } from "node:fs";

const commit = process.env.MAILGW_COMMIT ?? "";
if (commit && !/^[0-9a-f]{7,40}$/.test(commit)) throw new Error("MAILGW_COMMIT must be a commit sha");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
await build({
  entryPoints: ["src/lambda.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: false,
  sourcemap: false,
  legalComments: "none",
  define: { __MAILGW_COMMIT__: JSON.stringify(commit) },
  // CommonJS dependencies inside an ESM bundle still call `require` for node builtins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const epoch = new Date("2000-01-01T00:00:00Z");
utimesSync("dist/index.mjs", epoch, epoch);
execFileSync("zip", ["-X", "-q", "-D", "mail-gateway.zip", "index.mjs"], { cwd: "dist" });
console.log(`bundle: dist/mail-gateway.zip${commit ? ` (commit ${commit.slice(0, 7)})` : " (no commit: local build)"}`);
