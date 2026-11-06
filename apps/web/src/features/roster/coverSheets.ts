import { ref } from "vue";
import { fetchObjectUrl } from "@/lib/api";

/**
 * Print the scan cover sheets for the ticked drivers (DRIVER-PAPER-INTAKE-PLAN PI1). The PDF is fetched
 * as the signed-in user (`fetchObjectUrl`: the route is behind `requireAuth`, which a plain link would
 * not carry) and handed to the browser as a download, so it lands where the office's print dialog
 * already looks — the same file every time for the same selection.
 */
export function useCoverSheets() {
  const printing = ref(false);
  async function print(driverIds: string[]): Promise<void> {
    printing.value = true;
    try {
      const url = await fetchObjectUrl("/api/compliance/cover-sheets", { method: "POST", body: { driverIds } });
      const a = document.createElement("a");
      a.href = url;
      a.download = "driver-cover-sheets.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      printing.value = false;
    }
  }
  return { printing, print };
}
