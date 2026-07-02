import { supabase } from "@/lib/supabase";

// Same-origin by default (single-service deploy). Without the ?? "" this was `undefined`, making every
// report URL "undefined/api/…" → 404. Only set VITE_API_URL for a split-service deploy.
const API_URL = import.meta.env.VITE_API_URL ?? "";

/** Download a report from the API with the user's bearer token (so the auth header is sent). */
export async function downloadReport(path: string, filename: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
