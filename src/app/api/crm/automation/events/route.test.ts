import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        limit: () => Promise.resolve({ data: [{ id: "acct-test" }], error: null }),
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
}));

vi.mock("@/lib/automation/event-handler", () => ({
  processAutomationEvent: vi.fn().mockResolvedValue({
    status: 200,
    body: { success: true, processed: true },
  }),
}));

describe("POST /api/crm/automation/events — Authentication and Security Hardening", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.AUTOMATION_SECRET = "sec_test_automation_12345";
    process.env.N8N_CRM_WEBHOOK_SECRET = "sec_test_n8n_67890";
  });

  it("fail-closed: rejects request when no automation secrets are configured on the server", async () => {
    delete process.env.AUTOMATION_SECRET;
    delete process.env.N8N_CRM_WEBHOOK_SECRET;
    delete process.env.CRM_API_SECRET;
    delete process.env.AUTOMATION_CRON_SECRET;
    delete process.env.CRON_SECRET;

    const req = new Request("https://crm.itechskill.com/api/crm/automation/events", {
      method: "POST",
      headers: {
        "x-itechskill-crm-secret": "some_arbitrary_value",
      },
      body: JSON.stringify({ event_id: "evt_1", type: "lead_status_updated" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("Required automation secret is not configured");
  });

  it("rejects when request contains no secret header or bearer token", async () => {
    const req = new Request("https://crm.itechskill.com/api/crm/automation/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ event_id: "evt_1", type: "lead_status_updated" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("Missing authentication secret");
  });

  it("rejects when request contains an invalid secret header", async () => {
    const req = new Request("https://crm.itechskill.com/api/crm/automation/events", {
      method: "POST",
      headers: {
        "x-itechskill-crm-secret": "wrong_secret_attack_attempt",
        "content-type": "application/json",
      },
      body: JSON.stringify({ event_id: "evt_1", type: "lead_status_updated" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("Invalid secret");
  });

  it("authenticates successfully with valid x-itechskill-crm-secret header", async () => {
    const req = new Request("https://crm.itechskill.com/api/crm/automation/events", {
      method: "POST",
      headers: {
        "x-itechskill-crm-secret": "sec_test_automation_12345",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        event_id: "evt_101",
        event_type: "lead_status_updated",
        contact_id: "cnt_1",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("authenticates successfully with valid Authorization: Bearer token", async () => {
    const req = new Request("https://crm.itechskill.com/api/crm/automation/events", {
      method: "POST",
      headers: {
        Authorization: "Bearer sec_test_n8n_67890",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        event_id: "evt_102",
        event_type: "lead_status_updated",
        contact_id: "cnt_2",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("rejects requests missing an Idempotency-Key or event_id", async () => {
    const req = new Request("https://crm.itechskill.com/api/crm/automation/events", {
      method: "POST",
      headers: {
        "x-itechskill-crm-secret": "sec_test_automation_12345",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "lead_status_updated",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Missing required Idempotency-Key");
  });
});
