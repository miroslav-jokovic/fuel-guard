import { ref } from "vue";

/**
 * Whether "My alerts" is open. One ref for the app: the account menu that opens it is mounted twice
 * (the desktop sidebar and the phone's drawer) and the panel once, in the shell — an event would have
 * to be passed up through both sidebars to reach it.
 */
const open = ref(false);

export function useMyAlertsPanel() {
  return {
    open,
    show: (): void => {
      open.value = true;
    },
    close: (): void => {
      open.value = false;
    },
  };
}
