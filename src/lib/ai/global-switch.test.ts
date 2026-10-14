import { describe, it, expect, vi } from "vitest";
import {
  verifySenderReconciliation,
  updateGlobalAiAgentSettings,
  getGlobalAiAgentSettings,
} from "./global-switch";

describe("Sender Reconciliation & Master AI Switch", () => {
  it("fails reconciliation when no phone_number_id is configured in CRM", async () => {
    const mockDb = {
      from: (table: string) => ({
        select: () => ({
          maybeSingle: () => {
            if (table === "whatsapp_config") return Promise.resolve({ data: null, error: null });
            if (table === "itechskill_runtime_config")
              return Promise.resolve({ data: { allowed_sender_ids: ["999000111"] }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { allowed_sender_ids: ["999000111"] }, error: null }),
          }),
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    };

    const res = await verifySenderReconciliation(mockDb as any);
    expect(res.reconciled).toBe(false);
    expect(res.error).toContain("No WhatsApp phone number ID configured in CRM");
  });

  it("fails reconciliation when runtime allowed_sender_ids does not match CRM phone number", async () => {
    const mockDb = {
      from: (table: string) => ({
        select: () => ({
          maybeSingle: () => {
            if (table === "whatsapp_config")
              return Promise.resolve({
                data: { phone_number_id: "crm_phone_123", status: "connected" },
                error: null,
              });
            return Promise.resolve({ data: null, error: null });
          },
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { allowed_sender_ids: ["different_phone_456"] }, error: null }),
          }),
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    };

    const res = await verifySenderReconciliation(mockDb as any);
    expect(res.reconciled).toBe(false);
    expect(res.error).toContain("does not include CRM Phone Number ID");
  });

  it("blocks AI activation when sender reconciliation fails", async () => {
    const mockDb = {
      from: (table: string) => ({
        select: () => ({
          maybeSingle: () => {
            if (table === "whatsapp_config")
              return Promise.resolve({
                data: { phone_number_id: "crm_phone_123", status: "connected" },
                error: null,
              });
            return Promise.resolve({ data: null, error: null });
          },
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { allowed_sender_ids: ["different_phone_456"] }, error: null }),
          }),
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    };

    await expect(
      updateGlobalAiAgentSettings(true, { id: "admin-1", email: "admin@test.com" }, mockDb as any)
    ).rejects.toThrow("Activation blocked by sender reconciliation gate");
  });

  it("succeeds reconciliation when CRM, runtime config, and templates match the same phone number", async () => {
    const mockDb = {
      from: (table: string) => ({
        select: () => ({
          maybeSingle: () => {
            if (table === "whatsapp_config")
              return Promise.resolve({
                data: { phone_number_id: "prod_phone_999", status: "connected" },
                error: null,
              });
            return Promise.resolve({ data: null, error: null });
          },
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { allowed_sender_ids: ["prod_phone_999"] }, error: null }),
          }),
          limit: () =>
            Promise.resolve({
              data: [{ sender_id: "prod_phone_999" }],
              error: null,
            }),
        }),
      }),
    };

    const res = await verifySenderReconciliation(mockDb as any);
    expect(res.reconciled).toBe(true);
    expect(res.primarySenderId).toBe("prod_phone_999");
  });

  it("defaults to fail-closed (disabled) when global config tables are uninitialized", async () => {
    const mockDb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: new Error("table missing") }),
          }),
        }),
      }),
    };

    const settings = await getGlobalAiAgentSettings(mockDb as any);
    expect(settings.enabled).toBe(false);
    expect(settings.effective_source).toBe("fallback_disabled");
  });
});
