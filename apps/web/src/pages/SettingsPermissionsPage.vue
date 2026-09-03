<script setup lang="ts">
import { ref } from "vue";
import { AppCallout, AppTabs, type TabItem } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import RolesTab from "@/features/permissions/RolesTab.vue";
import PeopleTab from "@/features/permissions/PeopleTab.vue";

/**
 * Permissions (SURFACE-ENTITLEMENTS-PLAN.md S6; EDITABLE-PERMISSIONS-PLAN.md P5).
 *
 * ── WHAT THIS PAGE BECAME ───────────────────────────────────────────────────────────────────────
 * P0 shipped it read-only, with a card saying in as many words that the matrix could not be changed
 * here — honest at the time, because the matrix was a compile-time literal mirrored into ~89 RLS
 * predicates and an "edit" control would have changed what the UI hid and nothing about what the
 * database allowed. S1–S5 removed that reason: an org's answers now live in four tables, travel in
 * the JWT (sections) and in `/api/me` (screens), and are enforced by RLS, the API, the router guard
 * and the sidebar. Until this step the only way to write one was a `PUT` with curl.
 *
 * ── TWO TABS, BECAUSE THEY ANSWER TWO DIFFERENT QUESTIONS ───────────────────────────────────────
 * Roles is the default setup — the 7 × 11 matrix and the screens each role opens. People is the
 * custom setup the owner asked for on 2026-09-02, and it is not a shortcut into the same rows: a
 * person's answer outlives their role changing underneath them, and it is the only layer where
 * "shown" is a real answer rather than a reset (D-SURF6, D-SURF7).
 *
 * ── WHAT THIS PAGE DOES NOT GOVERN, SAID OUT LOUD ───────────────────────────────────────────────
 * ⚠ Q-SURF1 (step S7) is not done: roughly two dozen API endpoints still ask a hand-written list of
 * roles, and about sixty ask only that the caller is signed in. Those are mostly correct by design —
 * provider webhooks, the driver app's own surfaces, participation-scoped messaging — but "mostly" is
 * not a measurement, and a permissions page that implied completeness before that audit landed would
 * be making a promise the product has not yet checked. The callout below says so, and it comes out
 * when S7 does.
 */
const tabs: TabItem[] = [
  { value: "roles", label: "Roles" },
  { value: "people", label: "People" },
];
const tab = ref("roles");
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="What each role can reach, what one person can reach, and exactly what they see in the sidebar."
    />

    <AppCallout tone="info">
      Sections decide what the database itself will hand over, so a change to one applies within an
      hour, when the person's sign-in refreshes. Screens decide what appears in the sidebar and which
      addresses open, and apply the next time they load a page. A screen can only narrow what a
      section already allows — it can never hand out data the section refuses.
    </AppCallout>

    <AppTabs v-model="tab" :tabs="tabs" label="Permission views" id-prefix="permissions" />

    <div v-if="tab === 'roles'" id="permissions-panel-roles" role="tabpanel" aria-labelledby="permissions-tab-roles">
      <RolesTab />
    </div>
    <div v-else id="permissions-panel-people" role="tabpanel" aria-labelledby="permissions-tab-people">
      <PeopleTab />
    </div>

    <AppCallout tone="caution">
      Not every part of the product is governed from this page yet. A handful of API endpoints still
      decide access from a fixed list of roles rather than from the matrix above, so denying someone a
      screen hides it and closes its address, and a few background or integration endpoints will still
      answer. Those are being worked through; nothing on this page overstates what it controls.
    </AppCallout>
  </div>
</template>
