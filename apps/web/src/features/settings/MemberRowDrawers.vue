<script setup lang="ts">
import type { OrgMember } from "@silvicom/shared";
import MemberDevicesDrawer from "./MemberDevicesDrawer.vue";
import MemberPasswordResetDrawer from "./MemberPasswordResetDrawer.vue";
import MemberRenameDrawer from "./MemberRenameDrawer.vue";

/**
 * The drawers a member's row opens that own their whole act — the request, its step-up prompt and what it says
 * afterwards — so the Users page holds one "which act, on whom" and nothing else about them. Three today: the name (0301),
 * "Send password reset…" (0363) and "Signed-in devices…" (IA-S3). At most one is open, which is why it is one value and not a
 * ref each. ("Remove two-step sign-in…", for a lost authenticator, went with the authenticator itself: Q-IA20.)
 */
defineProps<{ act: { kind: "rename" | "reset" | "devices"; member: OrgMember } | null }>();
/** `saved`: the act changed what the members list shows (a rename), so the page reloads it. */
const emit = defineEmits<{ close: []; saved: [] }>();
</script>

<template>
  <MemberRenameDrawer :member="act?.kind === 'rename' ? act.member : null" @close="emit('close')" @saved="emit('saved')" />
  <MemberPasswordResetDrawer :member="act?.kind === 'reset' ? act.member : null" @close="emit('close')" />
  <MemberDevicesDrawer :member="act?.kind === 'devices' ? act.member : null" @close="emit('close')" />
</template>
