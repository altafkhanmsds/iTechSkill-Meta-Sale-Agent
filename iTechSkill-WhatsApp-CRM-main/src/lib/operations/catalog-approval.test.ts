import { describe, it, expect, vi, beforeEach } from "vitest";
import { approveCatalogChange } from "./actions";

const mockDbState = {
  changeRequests: [] as Array<Record<string, unknown>>,
  publishJobs: [] as Array<Record<string, unknown>>,
  auditLogs: [] as Array<Record<string, unknown>>,
  v2Writes: [] as Array<Record<string, unknown>>,
};

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "itechskill_catalog_change_requests") {
        return {
          select: () => ({
            eq: (_field: string, val: unknown) => ({
              maybeSingle: () => {
                const found = mockDbState.changeRequests.find((r) => r.request_id === val);
                return Promise.resolve({ data: found || null, error: null });
              },
            }),
          }),
          update: (updates: Record<string, unknown>) => ({
            eq: (_field: string, val: unknown) => ({
              select: () => ({
                single: () => {
                  const idx = mockDbState.changeRequests.findIndex((r) => r.request_id === val);
                  if (idx >= 0) {
                    mockDbState.changeRequests[idx] = { ...mockDbState.changeRequests[idx], ...updates };
                    return Promise.resolve({ data: mockDbState.changeRequests[idx], error: null });
                  }
                  return Promise.resolve({ data: null, error: new Error("Not found") });
                },
              }),
            }),
          }),
        };
      }
      if (table === "itechskill_catalog_publish_jobs") {
        return {
          upsert: (job: Record<string, unknown>) => {
            const idx = mockDbState.publishJobs.findIndex((j) => j.request_id === job.request_id);
            if (idx >= 0) {
              mockDbState.publishJobs[idx] = { ...mockDbState.publishJobs[idx], ...job };
            } else {
              mockDbState.publishJobs.push(job);
            }
            return Promise.resolve({ error: null });
          },
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: (job: Record<string, unknown>) => {
            mockDbState.publishJobs.push(job);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "itechskill_audit_log" || table === "itechskill_operations_audit_logs") {
        return {
          insert: (log: Record<string, unknown>) => {
            mockDbState.auditLogs.push(log);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "itechskill_course_catalog_v2") {
        return {
          insert: (item: Record<string, unknown>) => {
            mockDbState.v2Writes.push(item);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {};
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
}));

describe("Catalog Four-Eye Approval & n8n Publication Alignment", () => {
  beforeEach(() => {
    mockDbState.changeRequests = [];
    mockDbState.publishJobs = [];
    mockDbState.auditLogs = [];
    mockDbState.v2Writes = [];
    vi.clearAllMocks();
  });

  it("four-eye violation: prevents user from approving their own catalog request", async () => {
    const creatorId = "user_submitter_123";
    mockDbState.changeRequests.push({
      request_id: "req_cat_001",
      submitted_by: creatorId,
      status: "pending",
      action: "upsert",
      source_key: "itechskill_short_course_excel",
      title: "Excel Course Update",
    });

    const actor = { userId: creatorId, role: "admin" };

    await expect(
      approveCatalogChange("req_cat_001", "Self-approving my own request", actor)
    ).rejects.toThrow("Four-eye policy violation");

    // Must record rejected self-approval attempt in audit log
    const audit = mockDbState.auditLogs.find(
      (a) => a.action === "catalog.approve_change_rejected"
    );
    expect(audit).toBeDefined();
    expect(audit?.actor_user_id).toBe(creatorId);

    // Must NOT have created a publish job
    expect(mockDbState.publishJobs).toHaveLength(0);
  });

  it("allows independent authorized reviewer and stages job into itechskill_catalog_publish_jobs", async () => {
    const creatorId = "user_submitter_123";
    const reviewerId = "user_reviewer_456";

    mockDbState.changeRequests.push({
      request_id: "req_cat_002",
      submitted_by: creatorId,
      status: "pending",
      action: "upsert",
      source_key: "itechskill_diploma_cyber_security",
      title: "Cyber Security Diploma",
    });

    const actor = { userId: reviewerId, role: "admin" };

    const approved = await approveCatalogChange(
      "req_cat_002",
      "Content reviewed and syllabus verified",
      actor
    );

    expect(approved.status).toBe("approved");
    expect(approved.reviewer).toBe(reviewerId);

    // Staged into itechskill_catalog_publish_jobs for n8n consumption
    expect(mockDbState.publishJobs).toHaveLength(1);
    expect(mockDbState.publishJobs[0].request_id).toBe("req_cat_002");
    expect(mockDbState.publishJobs[0].status).toBe("pending");

    // Strictly does NOT directly write to itechskill_course_catalog_v2
    expect(mockDbState.v2Writes).toHaveLength(0);

    // Audit log records approval
    const audit = mockDbState.auditLogs.find((a) => a.action === "catalog.approve_change");
    expect(audit).toBeDefined();
    expect(audit?.actor_user_id).toBe(reviewerId);
  });
});
