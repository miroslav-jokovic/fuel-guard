import { z } from "zod";

/**
 * EFS report ingestion (storage bucket or an M365 mailbox) and the SOAP client's optional mutual TLS.
 *
 * Split out of `env.ts` by concern (2026-11-06, ads Track G env-split): that file had reached its 500-line
 * budget, and the first casualty was a setting read from `process.env` beside the typed `Env` because there was
 * no room to declare it (D-AD8's sandbox allowlist). Spread into the one schema, so a deployment still gets one
 * parse and one error listing everything it is missing. Every key, default and parse moved unchanged, held so by
 * `envSplit.test.ts` against the pre-split schema's recorded outputs.
 */
export const efsIngestEnvFields = {
  // Automated EFS report ingestion (removes the daily manual upload). "off" (default) disables the
  // scheduler. Sources: "storage" polls a Supabase Storage bucket where reports land under
  // <orgId>/incoming/; "graph" reads an M365 mailbox via Microsoft Graph (see docs/plans/EFS-MICROSOFT365-SETUP.md).
  // EFS_INGEST_MINUTES sets the poll cadence (Chunk 3).
  EFS_INGEST_SOURCE: z.enum(["off", "storage", "graph"]).default("off"),
  EFS_INGEST_BUCKET: z.string().default("efs-reports"),
  EFS_INGEST_MINUTES: z.coerce.number().min(1).default(30),
  // Optional single-tenant guard: when set, only this org ingests (relevant for the shared "graph" mailbox
  // so a multi-org deployment can't double-read one inbox). Unset = every org uses the configured source.
  EFS_INGEST_ORG_ID: z.string().optional(),
  // Microsoft 365 "graph" source — app-only credentials from the Entra app registration. The app needs the
  // Mail.ReadWrite APPLICATION permission (read + mark-as-read) with admin consent, ideally scoped to just EFS_GRAPH_MAILBOX via an
  // Application Access Policy. EFS_GRAPH_FOLDER (optional) restricts reading to one mail folder by name.
  EFS_GRAPH_TENANT_ID: z.string().optional(),
  EFS_GRAPH_CLIENT_ID: z.string().optional(),
  EFS_GRAPH_CLIENT_SECRET: z.string().optional(),
  EFS_GRAPH_MAILBOX: z.string().optional(),
  EFS_GRAPH_FOLDER: z.string().optional(),
  // ── Optional mutual TLS (client certificate) for the EFS SOAP endpoint ─────────────────────────
  // EFS has not yet confirmed whether their production endpoint requires a client certificate. This
  // block is INERT until a cert is supplied: with all three unset the client uses ordinary TLS and
  // behaves exactly as before, so it is safe to ship ahead of their answer. When EFS says "yes,
  // mTLS", drop the PEMs into these vars and redeploy — no code change.
  //
  // Values are PEM TEXT, not paths (Railway/Docker have no persistent secret files). Newlines may be
  // supplied literally or escaped as \n; both are normalised. Use *_B64 for a base64-encoded PEM when
  // the platform's env editor mangles multi-line values.
  EFS_SOAP_CLIENT_CERT_PEM: z.string().optional(),      // client certificate chain (leaf first)
  EFS_SOAP_CLIENT_KEY_PEM: z.string().optional(),       // matching private key
  EFS_SOAP_CLIENT_KEY_PASSPHRASE: z.string().optional(),// only if the key is encrypted
  EFS_SOAP_CLIENT_CERT_B64: z.string().optional(),
  EFS_SOAP_CLIENT_KEY_B64: z.string().optional(),
  // Extra CA bundle, if EFS's endpoint is signed by a private/enterprise root Node doesn't trust.
  EFS_SOAP_CA_PEM: z.string().optional(),
  EFS_SOAP_CA_B64: z.string().optional(),
  // PKCS#12 alternative (some issuers only hand out a .pfx). Base64 of the .p12/.pfx file.
  EFS_SOAP_CLIENT_PFX_B64: z.string().optional(),
  EFS_SOAP_CLIENT_PFX_PASSPHRASE: z.string().optional(),
  // Escape hatch for a staging endpoint with a self-signed cert. NEVER set this in production — it
  // disables certificate verification for EFS calls. Boot logs a loud warning when it is on.
  EFS_SOAP_TLS_INSECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Escape hatch for pointing the EFS SOAP client at a LOCAL endpoint — a mock CardManagementWS on
  // localhost, or a staging box on a private VLAN — during development. It disables the outbound
  // ADDRESS checks added for security audit 2026-08-09 finding 3.8 (lib/ssrfGuard.ts); https and the
  // ban on credentials embedded in the URL still apply, since neither has a development use.
  //
  // Like EFS_SOAP_TLS_INSECURE this is REFUSED — thrown, not warned about — when NODE_ENV=production.
  // Turning it on there would restore the exact request-forgery hole the guard exists to close, and a
  // bypass that can ship is not a bypass, it is the vulnerability with an env var in front of it.
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
};
