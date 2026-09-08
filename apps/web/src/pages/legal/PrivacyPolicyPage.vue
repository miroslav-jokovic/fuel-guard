<script setup lang="ts">
import { computed } from "vue";
import { AppTable } from "@silvicom/ui";
import LegalDocument from "@/features/legal/LegalDocument.vue";
import LegalSection from "@/features/legal/LegalSection.vue";
import {
  COMPANY_NAME,
  DATA_MATRIX,
  NOT_COLLECTED,
  PRODUCT_NAME,
  supportEmail,
} from "@/features/legal/legalMeta";

/**
 * The privacy policy (P3.2, D-PR9). Public, unauthenticated, indexable.
 *
 * ── WHO THIS IS WRITTEN FOR ────────────────────────────────────────────────────────────────────
 * Two readers, in this order. A DRIVER who wants to know whether their employer can see where they
 * are — the answer is that the app collects no location at all, and it is the third line on the
 * page rather than buried in a table. And a STORE REVIEWER checking that the policy names every
 * data type the app's manifest declares; that is what the table is for, and it is generated from
 * `legalMeta.ts` so it cannot fall out of step with the manifest.
 *
 * ⚠ Nothing here is drafted from a template. Every row of the matrix corresponds to a real write in
 * this system, and the retention answers are the ones the schema actually enforces — the evidence
 * tables are append-only and pinned in `RETENTION_FORBIDDEN`, which is why this page can promise
 * three years without a caveat.
 */
const email = computed(() => supportEmail());
</script>

<template>
  <LegalDocument
    title="Privacy policy"
    summary="What the Silvicom 360 driver app collects, why, who can see it, and how long it is kept."
  >
    <LegalSection id="who-we-are" title="Who we are">
      <p>
        {{ COMPANY_NAME }} makes fleet compliance and safety software for trucking carriers. This
        policy covers the {{ PRODUCT_NAME }} driver app for iPhone and Android.
      </p>
      <p>
        Your login is issued by the trucking company you drive for. That company decides what the app
        shows you and holds the records it creates; we run the software on their behalf. In data
        protection terms your carrier is the controller of your information and {{ COMPANY_NAME }} is
        its processor.
      </p>
    </LegalSection>

    <LegalSection id="no-location" title="The app does not track your location">
      <p>
        The driver app asks for no location permission on either iPhone or Android, and it contains no
        location software. The map you see on a stop is a picture drawn from the addresses dispatch
        entered — it does not know where your phone is.
      </p>
      <p>Nor does the app collect any of the following:</p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li v-for="item in NOT_COLLECTED" :key="item">{{ item }}</li>
      </ul>
      <p>
        Your carrier may run separate telematics in the truck itself. That is their system, not this
        app, and this policy does not cover it — ask your fleet manager what the truck records.
      </p>
    </LegalSection>

    <LegalSection id="what-we-collect" title="What the app collects">
      <p>
        Everything in this table is collected to make the app work. None of it is used to track you
        across other companies' apps or websites, none of it is sold, and none of it is shared with
        advertisers.
      </p>
      <AppTable class="w-full text-left text-sm">
        <thead>
          <tr class="text-xs uppercase tracking-wide text-ink-muted">
            <th class="py-1.5 pr-3 font-semibold">Data</th>
            <th class="py-1.5 pr-3 font-semibold">Tied to you</th>
            <th class="py-1.5 pr-3 font-semibold">Why</th>
            <th class="py-1.5 font-semibold">Kept for</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in DATA_MATRIX" :key="row.data" class="border-t border-edge-subtle align-top">
            <td class="py-2 pr-3 text-ink">{{ row.data }}</td>
            <td class="py-2 pr-3 text-ink-secondary">{{ row.linked ? "Yes" : "No" }}</td>
            <td class="py-2 pr-3 text-ink-secondary">{{ row.purpose }}</td>
            <td class="py-2 text-ink-secondary">{{ row.retention }}</td>
          </tr>
        </tbody>
      </AppTable>
    </LegalSection>

    <LegalSection id="who-sees-it" title="Who can see it">
      <ul class="list-disc space-y-1.5 pl-5">
        <li>
          <span class="text-ink">Your carrier.</span> Dispatchers, safety and management staff at the
          company that issued your login see your loads, your shifts, the photographs you take, and
          your messages with dispatch. This is the point of the app.
        </li>
        <li>
          <span class="text-ink">Other drivers — almost nothing.</span> A driver cannot open another
          driver's records. The only thing colleagues see of you is your first name and position on
          the score leaderboard, and only when your carrier turns that on.
        </li>
        <li>
          <span class="text-ink">Our own staff.</span> {{ COMPANY_NAME }} accesses carrier data only
          to operate and support the service, and every such action is recorded in an audit log your
          carrier can read.
        </li>
        <li>
          <span class="text-ink">Sentry</span>, our crash-reporting provider, receives crash
          diagnostics with personal details removed. It is our only sub-processor for driver app data.
        </li>
        <li>
          <span class="text-ink">Law enforcement or a regulator</span>, where your carrier or the law
          requires it — for example a DOT audit of qualification records.
        </li>
      </ul>
    </LegalSection>

    <LegalSection id="retention" title="How long it is kept">
      <p>
        The table above gives the period for each kind of data. Two of those answers are not ours to
        change: federal rules require your carrier to keep driver qualification records for three
        years after you stop driving for them (49 CFR §391.51), and the records that serve as proof of
        work — photographs, completed stops, compliance checks — cannot be edited or deleted after
        they are created. A correction is a new record placed beside the old one, so the history stays
        honest.
      </p>
    </LegalSection>

    <LegalSection id="security" title="How it is protected">
      <ul class="list-disc space-y-1.5 pl-5">
        <li>Everything the app sends is encrypted in transit; the app refuses unencrypted connections.</li>
        <li>
          Work you do with no signal is held in an encrypted database on the phone until it can be
          sent, and the key never leaves the phone's secure hardware.
        </li>
        <li>
          Photographs are stripped of their embedded camera data — including any location the camera
          recorded — before they are stored or sent.
        </li>
        <li>
          Each carrier's data is isolated from every other carrier's in the database itself, not only
          in the app.
        </li>
      </ul>
    </LegalSection>

    <LegalSection id="your-choices" title="Your choices and your rights">
      <ul class="list-disc space-y-1.5 pl-5">
        <li>
          <span class="text-ink">Notifications.</span> You can turn off any alert that is not
          safety-critical, in the app under Notifications, or switch them off entirely in your phone's
          settings.
        </li>
        <li>
          <span class="text-ink">Camera.</span> The app asks before it first opens the camera, and you
          can withdraw that permission in your phone's settings. Some stops require a photograph, so
          declining may mean you cannot complete them in the app.
        </li>
        <li>
          <span class="text-ink">Seeing or correcting your records.</span> Ask your fleet manager —
          they hold the records and can change them. If they cannot help, write to us at the address
          below and we will work with them.
        </li>
        <li>
          <span class="text-ink">Closing your account.</span> Your login belongs to your employer, so
          it usually ends when your employment does. You can also ask for it to be closed directly —
          see below.
        </li>
        <li>
          Depending on where you live you may have further rights over your information, such as a
          right to a copy of it. Those requests go to your carrier as the controller; we will help
          them answer.
        </li>
      </ul>
    </LegalSection>

    <LegalSection id="closing-your-account" title="Closing your account">
      <p>
        Ask your fleet manager to close your login, or write to us at the address below. Your login
        stops working straight away and your carrier is asked to delete what it is allowed to delete
        within 30 days. Your driver qualification file is the exception: your carrier is required by
        law to keep it for three years after you leave, and closing your login does not remove it.
      </p>
    </LegalSection>

    <LegalSection id="children" title="Children">
      <p>
        The app is for employed commercial drivers. It is not directed at anyone under 18 and we do
        not knowingly collect information from children.
      </p>
    </LegalSection>

    <LegalSection id="changes" title="Changes to this policy">
      <p>
        If we change what the app collects or who can see it, we will update this page, raise the
        version number at the top, and tell your carrier before the change takes effect.
      </p>
    </LegalSection>

    <LegalSection id="contact" title="How to reach us">
      <p v-if="email">
        Email <a :href="`mailto:${email}`" class="text-link hover:text-link-hover">{{ email }}</a>, or
        speak to your fleet manager, who can reach us on your behalf.
      </p>
      <p v-else>
        Speak to your fleet manager. They hold your records and can reach {{ COMPANY_NAME }} on your
        behalf.
      </p>
    </LegalSection>
  </LegalDocument>
</template>
