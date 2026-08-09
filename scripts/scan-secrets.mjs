#!/usr/bin/env node
/**
 * Secret scan over exactly the files this repository would ship (audit 2026-08-09, finding 3.7).
 *
 * WHY THIS SHAPE. The scan runs against `git archive HEAD` extracted to a temp directory, not
 * against the working tree. That is not incidental - it is the same discipline the finding asked
 * for. During the audit all three .env files left the repository inside a source archive built from
 * the working tree instead of from `git archive`; scanning the archive is therefore both the
 * correct file set (tracked content only, identical locally and in CI) and a standing demonstration
 * of how to package this repo safely.
 *
 * Consequences of that choice:
 *   - a developer's untracked .env never produces a false alarm, so the check stays credible;
 *   - a COMMITTED .env is caught immediately, which is the case that actually matters;
 *   - the result does not depend on who runs it or on their local scratch files.
 *
 * Requires the gitleaks binary. CI installs a pinned version; locally: `brew install gitleaks`.
 * Allowlisted exemptions live in .gitleaks.toml, each with a written justification.
 *
 * Run: pnpm lint:secrets
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const probe = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
if (probe.error) {
  console.error(
    "gitleaks is not installed.\n" +
      "  macOS:  brew install gitleaks\n" +
      "  other:  https://github.com/gitleaks/gitleaks/releases\n" +
      "CI installs a pinned version; this check cannot be skipped there.",
  );
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "fuelguard-secretscan-"));
try {
  // Tracked content at HEAD, nothing else. Exactly what a release archive would contain.
  const archive = spawnSync("sh", ["-c", `git archive HEAD | tar -x -C ${JSON.stringify(work)}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (archive.status !== 0) {
    console.error(
      `Could not export the tree with git archive: ${archive.stderr || archive.stdout}`,
    );
    process.exit(1);
  }

  const config = join(ROOT, ".gitleaks.toml");
  const args = ["detect", "--no-git", "--source", work, "--redact", "--verbose"];
  if (existsSync(config)) args.push("--config", config);

  const scan = spawnSync("gitleaks", args, { stdio: "inherit" });
  if (scan.status !== 0) {
    console.error(
      "\nSecret scan FAILED.\n" +
        "  A match here means a credential is committed to this repository.\n" +
        "  Rotate it first - scrubbing the commit does not un-leak a key - then remove it from the\n" +
        "  tree and move it into the environment. If it is genuinely not a secret, add a narrow\n" +
        "  allowlist entry to .gitleaks.toml WITH a written justification.",
    );
    process.exit(scan.status ?? 1);
  }
  console.log("\nOK - no secrets in the tracked tree.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
