import { useQuery } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";

/**
 * WP2 — read-only view of the card → truck assignments (`fuel_cards`), the ground truth the decline
 * scorer checks pump units against. Rows are LEARNED nightly from attributed fill history (≥5 fills,
 * ≥70% majority — see cardAssignments service) or set manually (manual is authoritative). RLS scopes
 * the query to the caller's org.
 */
export interface CardAssignmentRow {
  id: string;
  card_ref: string;
  card_last4: string | null;
  vehicle_id: string | null;
  assignment_source: string | null;
  status: string | null;
  updated_at: string;
}

/** Display form of a card ref — never show a full PAN in the UI. */
export function maskCardRef(cardRef: string | null | undefined, last4?: string | null): string {
  const digits = (cardRef ?? "").replace(/\D/g, "");
  const tail = last4 ?? (digits.length >= 4 ? digits.slice(-4) : null);
  return tail ? `•••• ${tail}` : (cardRef ?? "—");
}

export function useCardAssignments() {
  return useQuery({
    queryKey: ["fuel_cards"],
    queryFn: async (): Promise<CardAssignmentRow[]> => {
      const { data, error } = await supabase
        .from("fuel_cards")
        .select("id, card_ref, card_last4, vehicle_id, assignment_source, status, updated_at")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as CardAssignmentRow[];
    },
  });
}
