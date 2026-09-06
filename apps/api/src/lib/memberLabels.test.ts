import { describe, expect, it } from "vitest";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { displayNameFor, labelOf, memberLabels } from "./memberLabels.js";

/**
 * `memberLabels` — the one read behind everything that prints an actor (0301, S9).
 *
 * Pinned: ONE directory call answers every current member and no auth lookup is made for them; a
 * person who has left the org is looked up individually (the only display-purpose `getUserById`
 * left in the product); every failure leaves a person unlabelled rather than throwing into a binder
 * or a timeline; and `labelOf` prefers the name, then the email, then nothing.
 */
const ORG = "00000000-0000-4000-8000-00000000000a";
const HERE = "00000000-0000-4000-8000-000000000001";
const NAMELESS = "00000000-0000-4000-8000-000000000002";
const GONE = "00000000-0000-4000-8000-000000000003";
const DELETED = "00000000-0000-4000-8000-000000000004";

const directory = [
  { user_id: HERE, email: "here@example.test", full_name: "Hera Here", role: "dispatcher", joined_at: "2026-01-01T00:00:00Z" },
  { user_id: NAMELESS, email: "nameless@example.test", full_name: null, role: "technician", joined_at: "2026-01-02T00:00:00Z" },
];

describe("memberLabels", () => {
  it("answers current members from ONE directory call and never asks auth for them", async () => {
    const rec = createSupabaseRecorder({ rpc: { org_member_directory: directory } });
    const labels = await memberLabels(rec.client, ORG, [HERE, NAMELESS, HERE]);
    expect(labels.get(HERE)).toEqual({ name: "Hera Here", email: "here@example.test" });
    expect(labels.get(NAMELESS)).toEqual({ name: null, email: "nameless@example.test" });
    expect(rec.rpcs()).toEqual([{ fn: "org_member_directory", args: { p_org_id: ORG } }]);
    expect(rec.authCalls).toHaveLength(0);
  });

  it("looks up somebody who has LEFT the org individually — profile and auth — and only them", async () => {
    const rec = createSupabaseRecorder({
      rpc: { org_member_directory: directory },
      tables: { user_profiles: [{ full_name: "Gone Person" }] },
      auth: { getUserById: (id: string) => ({ data: { user: { id, email: "gone@example.test" } }, error: null }) },
    });
    const labels = await memberLabels(rec.client, ORG, [HERE, GONE]);
    expect(labels.get(GONE)).toEqual({ name: "Gone Person", email: "gone@example.test" });
    expect(rec.authCalls.map((c) => c.fn)).toEqual(["getUserById"]);
    expect(rec.authCalls[0]?.args[0]).toBe(GONE);
  });

  it("leaves a deleted login unlabelled instead of throwing into the caller", async () => {
    const rec = createSupabaseRecorder({
      rpc: { org_member_directory: directory },
      auth: {
        getUserById: () => {
          throw new Error("user not found");
        },
      },
    });
    const labels = await memberLabels(rec.client, ORG, [DELETED]);
    expect(labels.has(DELETED)).toBe(false);
  });

  it("falls through to the per-person path when the directory itself fails", async () => {
    const rec = createSupabaseRecorder({
      rpc: { org_member_directory: { error: { message: "function does not exist" } } },
      auth: { getUserById: (id: string) => ({ data: { user: { id, email: "still@example.test" } }, error: null }) },
    });
    const labels = await memberLabels(rec.client, ORG, [HERE]);
    expect(labels.get(HERE)).toEqual({ name: null, email: "still@example.test" });
  });

  it("asks nothing for an empty list", async () => {
    const rec = createSupabaseRecorder({ rpc: { org_member_directory: directory } });
    expect((await memberLabels(rec.client, ORG, [])).size).toBe(0);
    expect(rec.rpcs()).toHaveLength(0);
  });
});

describe("labelOf", () => {
  it("prefers the name, then the email, then nothing", () => {
    expect(labelOf({ name: "Hera Here", email: "here@example.test" })).toBe("Hera Here");
    expect(labelOf({ name: null, email: "here@example.test" })).toBe("here@example.test");
    expect(labelOf({ name: null, email: null })).toBeNull();
    expect(labelOf(undefined)).toBeNull();
  });
});

describe("displayNameFor", () => {
  it("names a driver member by the roster when they have no profile, and by the profile when they do", async () => {
    const roster = createSupabaseRecorder({
      tables: { user_profiles: [], drivers: [{ full_name: "Roster Name" }] },
    });
    expect(await displayNameFor(roster.client, HERE, ORG, "driver")).toBe("Roster Name");
    const profiled = createSupabaseRecorder({
      tables: { user_profiles: [{ full_name: "Own Name" }], drivers: [{ full_name: "Roster Name" }] },
    });
    expect(await displayNameFor(profiled.client, HERE, ORG, "driver")).toBe("Own Name");
  });

  it("answers null for an office member with no profile, without touching the roster", async () => {
    const rec = createSupabaseRecorder({ tables: { user_profiles: [] } });
    expect(await displayNameFor(rec.client, HERE, ORG, "dispatcher")).toBeNull();
    expect(rec.forTable("drivers")).toHaveLength(0);
  });
});
