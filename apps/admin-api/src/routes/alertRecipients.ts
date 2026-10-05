import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  requirePlatformAuth,
  requireAAL2,
  requirePlatformAdmin,
  requirePlatformRole,
  requireStepUp,
} from "../middleware/platformAuth.js";
import { adminClient } from "../lib/supabaseAdmin.js";
import { writePlatformAudit } from "../lib/audit.js";
import { apiError } from "../lib/http.js";
import {
  addAlertRecipient,
  listAlertRecipients,
  maskAddress,
  normaliseAddress,
  removeAlertRecipient,
  type AlertRecipient,
} from "../lib/alertRecipients.js";

/**
 * /admin/alert-recipients — who hears a platform alarm (0427; Settings in the console).
 *
 * Any platform role may READ the list, with phone numbers masked to their last four digits.
 * Adding or removing is owner/admin with a fresh second factor, like every other change on this
 * plane: removing the last phone silences the 01:00 page that a broken release sends, which is a
 * production-safety control, not a preference. Both are written to the platform audit trail.
 */
const view = (r: AlertRecipient) => ({ ...r, address: maskAddress(r.channel, r.address) });

const addSchema = z.object({
  channel: z.enum(["email", "sms"]),
  address: z.string().min(3).max(254),
  label: z.string().trim().max(80).optional(),
});

export function alertRecipientsRouter(): Router {
  const r = Router();
  r.use(requirePlatformAuth, requireAAL2, requirePlatformAdmin);

  r.get("/", async (req: Request, res: Response) => {
    try {
      res.json({ recipients: (await listAlertRecipients(adminClient(req))).map(view) });
    } catch {
      res.status(500).json(apiError("internal_error", "Could not load alert recipients"));
    }
  });

  r.post(
    "/",
    requirePlatformRole("platform_owner", "platform_admin"),
    requireStepUp,
    async (req: Request, res: Response) => {
      const parsed = addSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", "Body must be { channel: email|sms, address, label? }"));
        return;
      }
      const { channel, label } = parsed.data;
      const address = normaliseAddress(channel, parsed.data.address);
      if (!address) {
        res
          .status(400)
          .json(
            apiError(
              "invalid_address",
              channel === "sms" ? "Enter a US phone number (10 digits) or one starting with +" : "Enter a valid email address",
            ),
          );
        return;
      }
      try {
        const admin = adminClient(req);
        const added = await addAlertRecipient(admin, req.platform!.id, { channel, address, label: label || null });
        if (added === "duplicate") {
          res.status(409).json(apiError("duplicate", "That address is already on the list"));
          return;
        }
        const ua = req.headers["user-agent"];
        await writePlatformAudit(admin, req.platform!, {
          action: "alert_recipient.add",
          targetEntity: "platform_alert_recipients",
          targetId: added.id,
          after: { channel, address: maskAddress(channel, address), label: added.label },
          ip: req.ip ?? null,
          userAgent: typeof ua === "string" ? ua : null,
        });
        res.status(201).json({ recipient: view(added) });
      } catch {
        res.status(500).json(apiError("internal_error", "Could not add the recipient"));
      }
    },
  );

  // POST rather than DELETE: the row is stamped removed, not deleted (0427), and the console's api
  // helper speaks POST. Same gate as adding.
  r.post(
    "/:id/remove",
    requirePlatformRole("platform_owner", "platform_admin"),
    requireStepUp,
    async (req: Request, res: Response) => {
      const id = req.params.id;
      if (typeof id !== "string" || !z.uuid().safeParse(id).success) {
        res.status(400).json(apiError("invalid_request", "Invalid recipient id"));
        return;
      }
      try {
        const admin = adminClient(req);
        const removed = await removeAlertRecipient(admin, req.platform!.id, id);
        if (!removed) {
          res.status(404).json(apiError("not_found", "No such recipient on the list"));
          return;
        }
        const ua = req.headers["user-agent"];
        await writePlatformAudit(admin, req.platform!, {
          action: "alert_recipient.remove",
          targetEntity: "platform_alert_recipients",
          targetId: removed.id,
          before: { channel: removed.channel, address: maskAddress(removed.channel, removed.address), label: removed.label },
          ip: req.ip ?? null,
          userAgent: typeof ua === "string" ? ua : null,
        });
        res.json({ ok: true });
      } catch {
        res.status(500).json(apiError("internal_error", "Could not remove the recipient"));
      }
    },
  );

  return r;
}
