import { computed, ref, type Ref } from "vue";
import { HANDBOOK_PLACEMENTS, type LinkHandbookStatus } from "@silvicom/shared";
import { stageCapture, type CaptureIo } from "@/features/apply/capture/stageCapture";
import { usePacketAdoption, type AdoptionStop } from "@/features/apply/signing/usePacketAdoption";
import type { PacketCeremonyState } from "@/features/apply/signing/usePacketCeremony";

/**
 * ⚠ WORKAROUND — the handbook adopting its own signature (APPLICATION-FLOW-V2-PLAN.md A-1, C0b).
 *
 * The handbook signs with the signature adopted for the PACKET. An application filed before the packet
 * was signed on screen (`d61557dc`) has none, and the server refuses every place without one. Until
 * `signature_adoptions` exists (D-AW15), this screen collects it through the packet's own adoption
 * screens — `usePacketAdoption`, as the permissions do — which stage the picture in `signature_mark`.
 * The typed name travels with the FIRST place (`HandbookMark.signed_name`) and the server pins it there.
 *
 * Removed by C3s, with the server's `handbookSelfAdoption.ts`.
 *
 * ⚠ The stops are the handbook's five driver places, each a `signature`. Signed-ness is the SERVER's
 * (`driverSigned`), refetched after every place; nothing is filed from here, so `filedHere` stays empty.
 */
export function useHandbookAdoption(
  token: Ref<string>,
  handbook: Ref<LinkHandbookStatus>,
  options: { stage?: typeof stageCapture; io?: CaptureIo } = {},
) {
  const working = ref(false);
  const filedHere = ref(new Set<string>());
  const stops = computed<AdoptionStop[]>(() =>
    HANDBOOK_PLACEMENTS.filter((p) => p.party === "driver").map((p) => ({ id: p.id, mark: "signature" as const, signedAt: null })),
  );
  const isSigned = (stop: AdoptionStop): boolean => (handbook.value.driverSigned as readonly string[]).includes(stop.id);
  const outstanding = computed(() => stops.value.filter((s) => !isSigned(s)));
  const collected = computed(() => stops.value.filter(isSigned));

  const adoption = usePacketAdoption({
    token,
    stops,
    filedHere,
    outstanding,
    working,
    // The server's pin is the first handbook place's name: a resumed walk shows it rather than asking again.
    served: computed(() => ({ signature: handbook.value.adoption?.adoptedName ?? null, initials: null })),
    markStaged: computed(() => handbook.value.adoption?.pictureStaged ?? false),
    stage: options.stage,
    io: options.io,
  });

  const complete = computed(() => outstanding.value.length === 0);
  const state = computed<PacketCeremonyState>(() =>
    complete.value ? "done" : adoption.confirmed.value ? "signing" : adoption.adopted.value ? "confirming" : "adopting",
  );

  return {
    ...adoption,
    state,
    stops,
    collected,
    complete,
    total: computed(() => stops.value.length),
    working: computed(() => working.value),
  };
}
