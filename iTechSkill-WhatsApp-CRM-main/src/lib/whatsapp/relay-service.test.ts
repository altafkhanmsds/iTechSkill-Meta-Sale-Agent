import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  verifyMetaWebhookSignature,
  expandWebhookBatch,
} from "./relay-service";

describe("WhatsApp Relay Service", () => {
  const secret = "test_app_secret_123456";

  it("validates authentic Meta webhook signatures in constant time", () => {
    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [],
    });
    const expectedHash = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    const validSignature = `sha256=${expectedHash}`;

    expect(verifyMetaWebhookSignature(rawBody, validSignature, secret)).toBe(true);
  });

  it("rejects forged or tampered signatures", () => {
    const rawBody = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const forgedSignature = "sha256=abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

    expect(verifyMetaWebhookSignature(rawBody, forgedSignature, secret)).toBe(false);
  });

  it("rejects malformed signature headers", () => {
    const rawBody = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    expect(verifyMetaWebhookSignature(rawBody, "invalid-header-format", secret)).toBe(false);
    expect(verifyMetaWebhookSignature(rawBody, "", secret)).toBe(false);
  });

  it("expands webhook batches and pairs contacts accurately by wa_id", () => {
    const metaPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID_1",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+923001234567",
                  phone_number_id: "1167458436461085",
                },
                contacts: [
                  { profile: { name: "Ahmed Khan" }, wa_id: "923001112223" },
                  { profile: { name: "Sara Ali" }, wa_id: "923004445556" },
                ],
                messages: [
                  {
                    from: "923001112223",
                    id: "wamid.HBgLMTIz",
                    timestamp: "1726480000",
                    type: "text",
                    text: { body: "Fee details for AI diploma?" },
                  },
                  {
                    from: "923004445556",
                    id: "wamid.HBgLNDU2",
                    timestamp: "1726480005",
                    type: "image",
                    image: { id: "media_img_99", mime_type: "image/jpeg" },
                  },
                ],
                statuses: [
                  {
                    id: "wamid.OUT123",
                    status: "delivered",
                    timestamp: "1726480010",
                    recipient_id: "923001112223",
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    const batches = expandWebhookBatch(metaPayload);
    expect(batches).toHaveLength(1);
    const expanded = batches[0];
    expect(expanded.messages).toHaveLength(2);
    expect(expanded.statuses).toHaveLength(1);

    // Message 1 verification
    const msg1 = expanded.messages[0];
    expect(msg1.from).toBe("923001112223");
    expect(msg1.contact_profile?.name).toBe("Ahmed Khan");
    expect(msg1.timestamp).toBe("1726480000"); // Preserves provider Unix seconds
    expect(msg1.text?.body).toBe("Fee details for AI diploma?");

    // Message 2 verification
    const msg2 = expanded.messages[1];
    expect(msg2.from).toBe("923004445556");
    expect(msg2.contact_profile?.name).toBe("Sara Ali");
    expect(msg2.image?.id).toBe("media_img_99");

    // Status verification
    const status1 = expanded.statuses[0];
    expect(status1.id).toBe("wamid.OUT123");
    expect(status1.status).toBe("delivered");
  });
});
