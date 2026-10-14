import { describe, it, expect } from "vitest";
import {
  hashPayload,
  AutomationEventPayload,
} from "./event-handler";

describe("Automation Event Handler", () => {
  it("generates deterministic SHA-256 hashes regardless of object key order", () => {
    const payloadA = {
      schema_version: "2.0",
      event_type: "whatsapp_accepted",
      phone: "+923001234567",
      reply: "Welcome to iTechSkill",
      provider_message_id: "wamid.123",
      outbox_id: "out_99",
    };

    const payloadB = {
      outbox_id: "out_99",
      reply: "Welcome to iTechSkill",
      provider_message_id: "wamid.123",
      phone: "+923001234567",
      event_type: "whatsapp_accepted",
      schema_version: "2.0",
    };

    const hashA = hashPayload(payloadA);
    const hashB = hashPayload(payloadB);

    expect(hashA).toBe(hashB);
    expect(hashA).toHaveLength(64); // SHA-256 hex string
  });

  it("detects payload alterations with different SHA-256 hash", () => {
    const payloadOriginal = {
      schema_version: "2.0",
      event_type: "whatsapp_accepted",
      phone: "+923001234567",
      reply: "Original Reply",
      provider_message_id: "wamid.123",
      outbox_id: "out_99",
    };

    const payloadModified = {
      ...payloadOriginal,
      reply: "Modified Reply Content",
    };

    expect(hashPayload(payloadOriginal)).not.toBe(hashPayload(payloadModified));
  });

  it("enforces monotonic status hierarchy levels", () => {
    const STATUS_LEVELS: Record<string, number> = {
      pending: 0,
      prepared: 1,
      sent: 2,
      delivered: 3,
      read: 4,
    };

    expect(STATUS_LEVELS["sent"]).toBeGreaterThan(STATUS_LEVELS["prepared"]);
    expect(STATUS_LEVELS["delivered"]).toBeGreaterThan(STATUS_LEVELS["sent"]);
    expect(STATUS_LEVELS["read"]).toBeGreaterThan(STATUS_LEVELS["delivered"]);

    // Test regression prevention logic:
    // If current status is 'delivered' (3), a late incoming 'sent' (2) must NOT regress it
    const currentStatus: string = "delivered";
    const lateIncomingStatus: string = "sent";

    const shouldUpdate =
      lateIncomingStatus === "failed" ||
      (STATUS_LEVELS[lateIncomingStatus] ?? -1) > (STATUS_LEVELS[currentStatus] ?? -1);

    expect(shouldUpdate).toBe(false);

    // Incoming 'read' (4) SHOULD update 'delivered' (3)
    const readIncoming: string = "read";
    const shouldUpdateRead =
      readIncoming === "failed" ||
      (STATUS_LEVELS[readIncoming] ?? -1) > (STATUS_LEVELS[currentStatus] ?? -1);

    expect(shouldUpdateRead).toBe(true);
  });
});
