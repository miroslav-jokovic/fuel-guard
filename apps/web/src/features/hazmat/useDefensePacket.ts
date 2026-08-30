import { ref } from "vue";
import { supabase } from "@/lib/supabase";
import { useToastStore } from "@/stores/toast";

/**
 * Download a load's defense packet (M12.1).
 *
 * ⚠ This CANNOT be a plain `<a href="/api/hazmat/loads/:id/packet">`, and `HazmatPanel` shipped
 * exactly that. The hazmat router is `router.use(requireAuth, …)` and `middleware/auth.ts` accepts
 * only an `Authorization: Bearer` header — this SPA holds its session token in storage, not in a
 * cookie — so a new tab sends no credential and the link 401s every time. It could never have
 * worked, on any load, for anyone.
 *
 * `HazmatLoadDetailPage` had the correct implementation privately. One feature, two ways, one of
 * them dead; this is the one way.
 */
export function useDefensePacket() {
  const toast = useToastStore();
  const loading = ref(false);

  async function download(loadId: string): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    let url: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`/api/hazmat/loads/${loadId}/packet`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Packet failed (${res.status})`);
      const blob = await res.blob();
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hazmat-packet-${loadId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error("Could not generate the defense packet", e instanceof Error ? e.message : undefined);
    } finally {
      // Revoked in `finally` rather than straight after click(): the object URL has to outlive the
      // synchronous click, and leaking one per download is how a long review session grows a blob
      // for every packet a reviewer ever opened.
      if (url) URL.revokeObjectURL(url);
      loading.value = false;
    }
  }

  return { download, loading };
}
