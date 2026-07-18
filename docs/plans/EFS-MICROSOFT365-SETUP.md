# Connect EFS Reports from a Microsoft 365 Mailbox — Step by Step

**Goal:** EFS emails the scheduled reports to `miki@silvicominc.com`; FuelGuard reads that mailbox and
imports them automatically. **Time:** ~15 minutes, one-time. **Who:** the last few steps need a Microsoft
365 **admin** for silvicominc.com.

## Why an "app registration" (plain English)
Microsoft turned off simple email+password login for apps. The supported way for a program to read a 365
mailbox is **Microsoft Graph** with a registered app that has **read-only mail** permission. That's what
these steps set up. The connector is already built and tested — you just create the app and paste 5 values
into the settings.

The app will: read **unread** emails that have attachments in the chosen folder, pull the `.csv`/`.xlsx`
report attachments, import them, and mark those emails **read**. Nothing is deleted. A file it can't read is
left in the mailbox for you and flagged in the weekly digest.

---

## Step 1 — (Recommended) Make a folder + rule so the app only touches EFS mail
In Outlook (web or desktop), as Miki:
1. Create a folder, e.g. **`FuelGuard EFS`**.
2. Create a rule: **From** the EFS/WEX sender address **→ move to** `FuelGuard EFS`. (Leave messages
   **unread** — that's how the app knows what's new.)

This keeps the app pointed at only EFS reports, not the rest of the inbox. (You can skip this and read the
whole inbox, but the folder is cleaner and safer.)

## Step 2 — Register the app in Microsoft Entra (Azure AD)
1. Go to **https://entra.microsoft.com** → **Applications** → **App registrations** → **New registration**.
2. Name: **`FuelGuard EFS Ingest`**. Accounts: **Single tenant**. Leave Redirect URI blank. **Register**.
3. On the app's **Overview**, copy these two values (you'll paste them later):
   - **Directory (tenant) ID**
   - **Application (client) ID**

## Step 3 — Give it read-only mail permission (admin)
1. In the app → **API permissions** → **Add a permission** → **Microsoft Graph** → **Application
   permissions**.
2. Search **`Mail.Read`**, check it, **Add permissions**.
3. Click **Grant admin consent for Silvicom** → confirm. The Mail.Read row should show a **green
   check**. (This step needs an admin.)

## Step 4 — Create a client secret (the app's password)
1. App → **Certificates & secrets** → **Client secrets** → **New client secret**.
2. Description `FuelGuard`, expiry e.g. **24 months** → **Add**.
3. **Copy the secret _Value_ immediately** (it's shown only once). This is `EFS_GRAPH_CLIENT_SECRET`.
   > ⏰ It expires — set a calendar reminder to create a new one before the expiry date.

## Step 5 — (Recommended, admin) Restrict the app to ONLY the EFS mailbox
By default `Mail.Read` lets the app read *every* mailbox in the company. Lock it to just the EFS mailbox
with an **Application Access Policy**. In PowerShell as an Exchange admin:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser   # first time only
Connect-ExchangeOnline

# A mail-enabled security group containing ONLY the EFS mailbox (create one if needed):
#   New-DistributionGroup -Name "FuelGuard-EFS-Mailboxes" -Type Security -Members miki@silvicominc.com

New-ApplicationAccessPolicy `
  -AppId <Application (client) ID> `
  -PolicyScopeGroupId FuelGuard-EFS-Mailboxes@silvicominc.com `
  -AccessRight RestrictAccess `
  -Description "FuelGuard EFS ingest — EFS mailbox only"

# Verify it CAN read the EFS mailbox and CANNOT read another one:
Test-ApplicationAccessPolicy -Identity miki@silvicominc.com  -AppId <Application (client) ID>   # AccessCheckResult: Granted
Test-ApplicationAccessPolicy -Identity someoneelse@silvicominc.com -AppId <Application (client) ID> # Denied
```

(Policy changes can take a little while to apply.)

## Step 6 — Put the values into FuelGuard (Railway → API service → Variables)
| Variable | Value |
|---|---|
| `EFS_INGEST_SOURCE` | `graph` |
| `EFS_GRAPH_TENANT_ID` | Directory (tenant) ID from Step 2 |
| `EFS_GRAPH_CLIENT_ID` | Application (client) ID from Step 2 |
| `EFS_GRAPH_CLIENT_SECRET` | secret **Value** from Step 4 |
| `EFS_GRAPH_MAILBOX` | `miki@silvicominc.com` |
| `EFS_GRAPH_FOLDER` | `FuelGuard EFS` (from Step 1; omit to read the whole mailbox) |
| `EFS_INGEST_MINUTES` | `30` |

Then **redeploy / restart** the API. In the logs you should see:

```
[efs-ingest] auto-ingest enabled — source=graph, every 30m
```

## Step 7 — Schedule the reports in EFS
In eManager, set the **Transaction Detail** and **Reject** reports to a **recurring schedule**, emailed to
`miki@silvicominc.com`, in the **same format** (`.csv` or `.xlsx`) you export today. If eManager doesn't
offer scheduled delivery, call EFS (**888‑824‑7378**) to enable it.

## Step 8 — Verify end to end
1. Send yourself (or wait for) one real EFS report into the `FuelGuard EFS` folder, left **unread**.
2. In FuelGuard → **Settings → Data & Sync → Import EFS reports → "Check now"** (or wait up to 30 min).
3. Confirm: the email flips to **read**, new rows appear on **Transactions / Fuel Log**, anomalies/dashboard
   update, and the card shows "updated just now".
4. If something can't be read, the email stays **unread**-cleared but in the folder, and the weekly digest's
   data-health line flags "EFS delivery(ies) could not be imported."

---

## Good to know
- **Security:** the app is read-only mail, and Step 5 restricts it to the one mailbox. It cannot send email
  or read anything else.
- **Safe to resend:** re-delivering the same report is a no-op (duplicate detection by file + row), so you
  can forward a report again without double-counting.
- **Turn it off:** set `EFS_INGEST_SOURCE=off` and restart. Manual upload on the Import page still works.
- **Rate limits:** importing scores fills through the rate-limited Samsara client, so even a big backlog
  paces itself.
