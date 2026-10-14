import express, { type RequestHandler } from "express";
import { Webhook } from "svix";
import { z } from "zod";

const DeliveryEventTypeSchema = z.enum([
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.failed",
  "email.complained",
  "email.suppressed",
]);
const EventTypeSchema = z.object({ type: z.string() });
const DeliveryEventSchema = z.object({
  type: DeliveryEventTypeSchema,
  created_at: z.iso.datetime({ offset: true }),
  data: z.object({ email_id: z.uuid() }),
});

export function createResendWebhookHandler(secret: string): RequestHandler {
  const verifier = new Webhook(secret);
  const readBody = express.raw({ type: "application/json", limit: "64kb", inflate: false });

  return (req, res) => {
    const reject = () => { res.status(400).json({ error: "Invalid webhook request" }); };
    readBody(req, res, (error: unknown) => {
      if (error || !Buffer.isBuffer(req.body)) {
        reject();
        return;
      }
      const headers: Record<string, string> = {};
      for (const name of ["svix-id", "svix-timestamp", "svix-signature"]) {
        let count = 0;
        for (let index = 0; index < req.rawHeaders.length; index += 2) {
          if (req.rawHeaders[index]?.toLowerCase() === name) count += 1;
        }
        const value = req.headers[name];
        if (count !== 1 || typeof value !== "string" || value.length === 0) {
          reject();
          return;
        }
        headers[name] = value;
      }

      let payload: unknown;
      try {
        verifier.verify(req.body, headers);
        payload = JSON.parse(req.body.toString("utf8"));
      } catch {
        reject();
        return;
      }
      const eventType = EventTypeSchema.safeParse(payload);
      if (eventType.success && !DeliveryEventTypeSchema.safeParse(eventType.data.type).success) {
        res.sendStatus(204);
        return;
      }
      const event = DeliveryEventSchema.safeParse(payload);
      if (!event.success) {
        console.warn("Resend webhook diagnostic", JSON.stringify({ diagnostic: "invalid_event_payload" }));
        reject();
        return;
      }
      console.info("Resend delivery event", JSON.stringify({
        event: event.data.type,
        messageId: event.data.data.email_id,
        eventCreatedAt: event.data.created_at,
      }));
      res.sendStatus(204);
    });
  };
}
