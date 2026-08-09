import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  WEB_APP_URL: "https://app.example.com",
  ALLOWED_ORIGINS: "https://app.example.com",
};

describe("production environment validation", () => {
  it("requires server Supabase credentials and non-local URLs", () => {
    expect(() => loadEnv({ ...base, SUPABASE_URL: "" })).toThrow(/SUPABASE_URL/);
    expect(() => loadEnv({ ...base, WEB_APP_URL: "http://localhost:5173" })).toThrow(/WEB_APP_URL/);
    expect(() => loadEnv({ ...base, ALLOWED_ORIGINS: "http://localhost:5173" })).toThrow(/ALLOWED_ORIGINS/);
  });

  it("keeps local development permissive", () => {
    expect(loadEnv({ NODE_ENV: "development" }).WEB_APP_URL).toBe("http://localhost:5173");
  });
});
