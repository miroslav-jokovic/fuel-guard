<script setup lang="ts">
import type { OrgMember } from "@silvicom/shared";
import MemberDevicesDrawer from "./MemberDevicesDrawer.vue";
import MemberPasswordResetDrawer from "./MemberPasswordResetDrawer.vue";

/**
 * The drawers a member's row opens that own their whole act — the request, its step-up prompt and what it says
 * afterwards — so the Users page holds one "which act, on whom" and nothing else about them. Two today:
 * "Send password reset…" (0363) and "Signed-in devices…" (IA-S3). At most one is open, which is why it is one
 * value and not a ref each.
 */
defineProps<{ act: { kind: "reset" | "devices"; member: OrgMember } | null }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <MemberPasswordResetDrawer :member="act?.kind === 'reset' ? act.member : null" @close="emit('close')" />
  <MemberDevicesDrawer :member="act?.kind === 'devices' ? act.member : null" @close="emit('close')" />
</template>
