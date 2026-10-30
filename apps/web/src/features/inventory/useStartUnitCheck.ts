import { useRouter } from "vue-router";
import { formatDateTime } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import { useOpenCountSession } from "./useInventory";

/**
 * Start a check of one truck or trailer and open it (D-INV19) — from the truck's Equipment tab header
 * (`UnitEquipmentSection`) and, since EA3, from the equipment card on every truck's and trailer's page
 * (`HolderEquipmentCard`'s *Check equipment*). One function, so both doors open the same walk.
 *
 * The session id is the SERVER's, exactly as a shelf count's is: a walk is opened with the network
 * up, because the screen cannot show what to check without it, and two taps of Start must not make
 * two walks. `blind` is false — a kit check is not a blind count, because the whole question is "is
 * the thing the system names actually here", which cannot be asked without naming it.
 */
export function useStartUnitCheck() {
  const router = useRouter();
  const toast = useToastStore();
  const openWalk = useOpenCountSession();

  async function startCheck(kind: "tractor" | "trailer", unitId: string) {
    try {
      const walk = await openWalk.mutateAsync({
        kind: "unit",
        ...(kind === "tractor" ? { vehicleId: unitId } : { trailerId: unitId }),
        blind: false,
      });
      // R9: the server hands back this unit's open check rather than starting a second walk, and the
      // screen says so — a technician who expected a fresh list should know answers are already in it.
      if (walk.resumed) {
        toast.info("Continuing the open check", `Started ${formatDateTime(walk.openedAt)}${walk.startedByName ? ` by ${walk.startedByName}` : ""}.`);
      }
      void router.push({ name: "count-session", params: { sessionId: walk.id } });
    } catch (e) {
      toast.error("Could not start the check", e instanceof Error ? e.message : undefined);
    }
  }

  return { startCheck, openWalk };
}
