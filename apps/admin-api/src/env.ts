import { z } from "zod";

/**
 * Validated environment for the PLATFORM plane. Secrets live ONLY here (never in the admin web bundle).
 * The service-role key here is the same project key the customer API uses, but it runs in a SEPARATE
 * service/process — platform god-mode never shares the customer API's process or memory.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8090),
  // The admin SPA origin(s) allowed to call this API (its own subdomain), comma-separated.
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5174")
    .transform((s) => s.split(",").map((o) => o.trim())),

  // Supabase — same project as the customer app; used for JWKS verification + the service-role client.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Absolute path to the built admin SPA to serve (single-service deploy for the platform plane).
  ADMIN_DIST: z.string().optional(),

  // Stripe (Phase 2) — kept optional so Phase 0 boots without them.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
