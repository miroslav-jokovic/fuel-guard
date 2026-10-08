import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tonight's release, approved from the console (RELEASE-TRAIN-PLAN D-REL14, table 0440).
 *
 * D-REL5 made a GitHub review the only go signal, and on 10/08 the night shipped nothing because
 * nobody opened GitHub before bed. The candidate is still GitHub's release PR (`main → production`,
 * opened and refreshed at 18:00 by release-candidate.yml) — this module reads it, never restates it —
 * and the approval lands in our database, where release.yml reads it at 01:07
 * (`scripts/release-train.mjs approval`).
 */
export interface ReleaseCandidate {
  number: number;
  url: string;
  title: string;
  /** The PR body without its marker line: the release notes, markdown. */
  notes: string;
  /** What an approval here ships: the commit the notes describe, or main's head without a marker. */
  shipsSha: string;
  /** False when the body carries no marker (a PR written before D-REL14): the head may include merges the notes do not list. */
  pinnedByNotes: boolean;
  headSha: string;
  updatedAt: string;
}

const MARKER = /<!-- release-candidate-sha: ([0-9a-f]{40}) -->\n?/;

/**
 * The commit the release notes describe, from the line release-candidate.yml writes
 * (`candidateMarker` in scripts/release-train.mjs; the test holds the two together). Pure.
 */
export function candidateShaFrom(body: string | null | undefined): string | null {
  return body?.match(MARKER)?.[1] ?? null;
}

interface GitHubPull {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  updated_at: string;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
}

/**
 * The open release PR, or null when there is none (production already serves main, or tonight's
 * PR shipped). The repository is public, so no token is needed; GITHUB_TOKEN only lifts GitHub's
 * 60-an-hour anonymous limit, which Railway's shared egress addresses could otherwise exhaust.
 */
export async function fetchCandidate(
  fetchImpl: typeof fetch,
  repo: string,
  token: string | undefined,
): Promise<ReleaseCandidate | null> {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/pulls?base=production&state=open&per_page=20`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  // Only main into production, from this repository — a fork's PR into production is not a release.
  const pr = ((await res.json()) as GitHubPull[]).find((p) => p.head.ref === "main" && p.head.repo?.full_name === repo);
  if (!pr) return null;
  const marked = candidateShaFrom(pr.body);
  return {
    number: pr.number,
    url: pr.html_url,
    title: pr.title,
    notes: (pr.body ?? "").replace(MARKER, "").trim(),
    shipsSha: marked ?? pr.head.sha,
    pinnedByNotes: marked !== null,
    headSha: pr.head.sha,
    updatedAt: pr.updated_at,
  };
}

export interface ReleaseApproval {
  id: string;
  prNumber: number;
  commitSha: string;
  approvedBy: string | null;
  approvedAt: string;
}

type Row = { id: string; pr_number: number; commit_sha: string; approved_by: string | null; approved_at: string };
const COLUMNS = "id, pr_number, commit_sha, approved_by, approved_at";

/** Live approvals of one release PR, newest first, each with its approver's email. */
export async function listApprovals(admin: SupabaseClient, prNumber: number): Promise<ReleaseApproval[]> {
  const { data, error } = await admin
    .from("platform_release_approvals")
    .select(COLUMNS)
    .eq("pr_number", prNumber)
    .is("revoked_at", null)
    .order("approved_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map((r) => r.approved_by).filter((x): x is string => !!x))];
  const emails = new Map<string, string>();
  if (ids.length) {
    const { data: admins, error: aErr } = await admin.from("platform_admins").select("id, email").in("id", ids);
    if (aErr) throw aErr;
    for (const a of (admins ?? []) as { id: string; email: string }[]) emails.set(a.id, a.email);
  }
  return rows.map((r) => ({
    id: r.id,
    prNumber: r.pr_number,
    commitSha: r.commit_sha,
    approvedBy: r.approved_by ? (emails.get(r.approved_by) ?? null) : null,
    approvedAt: r.approved_at,
  }));
}

export async function approveRelease(
  admin: SupabaseClient,
  adminId: string,
  prNumber: number,
  commitSha: string,
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from("platform_release_approvals")
    .insert({ pr_number: prNumber, commit_sha: commitSha, approved_by: adminId })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

/** Stamps every live approval of the PR withdrawn. Returns the commits withdrawn (none = nothing was live). */
export async function revokeRelease(admin: SupabaseClient, adminId: string, prNumber: number): Promise<string[]> {
  const { data, error } = await admin
    .from("platform_release_approvals")
    .update({ revoked_at: new Date().toISOString(), revoked_by: adminId })
    .eq("pr_number", prNumber)
    .is("revoked_at", null)
    .select("commit_sha");
  if (error) throw error;
  return ((data ?? []) as { commit_sha: string }[]).map((r) => r.commit_sha);
}
