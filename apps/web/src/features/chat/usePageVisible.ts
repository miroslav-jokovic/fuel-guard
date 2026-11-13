import { onScopeDispose, ref, type Ref } from "vue";

/**
 * Whether a person can see this page right now (`document.visibilityState`), as a ref.
 *
 * A conversation is READ only while it is on a visible screen (CHAT-WEB-PUSH-PLAN D-WP6). Until 2026-11-13 the
 * page marked it read whenever its data loaded — and a realtime signal refetches it in a HIDDEN tab too, so a PC
 * left on /chat read every line as it arrived: the sender saw "Seen" for words nobody saw, and the phone push,
 * which goes only to whoever has not read the line (D-WP3), would never have rung.
 */
export function usePageVisible(): Ref<boolean> {
  const visible = ref(typeof document === "undefined" || document.visibilityState === "visible");
  if (typeof document === "undefined") return visible;
  const update = () => { visible.value = document.visibilityState === "visible"; };
  document.addEventListener("visibilitychange", update);
  onScopeDispose(() => document.removeEventListener("visibilitychange", update));
  return visible;
}
