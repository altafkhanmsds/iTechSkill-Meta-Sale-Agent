import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createIncidentFingerprint,
  recordIncident,
} from "./incidents";
import { loadOperationsAlerts, loadOperationsSummary } from "./queries";

const mockDbState = {
  alerts: [] as Array<Record<string, unknown>>,
};

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "itechskill_operations_alerts") {
        return {
          select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
            const chain = {
              eq: (field: string, val: unknown) => {
                if (field === "fingerprint") {
                  return {
                    maybeSingle: () => {
                      const found = mockDbState.alerts.find((a) => a.fingerprint === val);
                      return Promise.resolve({ data: found || null, error: null });
                    },
                  };
                }
                if (field === "status") {
                  const filtered = mockDbState.alerts.filter((a) => a.status === val);
                  return {
                    order: () => ({
                      range: () => Promise.resolve({ data: filtered, count: filtered.length, error: null }),
                    }),
                  };
                }
                return chain;
              },
              in: (field: string, vals: string[]) => {
                const filtered = mockDbState.alerts.filter((a) => vals.includes(a.status as string));
                if (opts?.count === "exact" && opts?.head) {
                  return Promise.resolve({ count: filtered.length, data: null, error: null });
                }
                return {
                  order: () => ({
                    range: () => Promise.resolve({ data: filtered, count: filtered.length, error: null }),
                  }),
                };
              },
              order: () => ({
                range: () => Promise.resolve({ data: mockDbState.alerts, count: mockDbState.alerts.length, error: null }),
              }),
            };
            return chain;
          },
          insert: (data: Record<string, unknown>) => ({
            select: () => ({
              single: () => {
                mockDbState.alerts.push(data);
                return Promise.resolve({ data, error: null });
              },
            }),
          }),
          update: (data: Record<string, unknown>) => ({
            eq: (field: string, val: unknown) => ({
              select: () => ({
                single: () => {
                  const idx = mockDbState.alerts.findIndex((a) => a[field] === val);
                  if (idx >= 0) {
                    mockDbState.alerts[idx] = { ...mockDbState.alerts[idx], ...data };
                    return Promise.resolve({ data: mockDbState.alerts[idx], error: null });
                  }
                  return Promise.resolve({ data: null, error: new Error("Not found") });
                },
              }),
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

describe("Diagnostics & Incident Counters", () => {
  beforeEach(() => {
    mockDbState.alerts = [];
    vi.clearAllMocks();
  });

  describe("Fingerprint generation and normalization", () => {
    it("deduplicates identical failures into identical fingerprints", () => {
      const fp1 = createIncidentFingerprint({
        tenantId: "tenant_alpha",
        alertType: "webhook_timeout",
        failedCase: "inbound_event",
        normalizedCause: "Connection to upstream provider timed out after 5000ms",
      });

      const fp2 = createIncidentFingerprint({
        tenantId: "tenant_alpha",
        alertType: "webhook_timeout",
        failedCase: "inbound_event",
        normalizedCause: "Connection to upstream provider timed out after 5000ms",
      });

      expect(fp1).toBe(fp2);
    });

    it("normalizes volatile timestamps, UUIDs, and eval run IDs", () => {
      const fpWithRunA = createIncidentFingerprint({
        tenantId: "tenant_1",
        alertType: "ai_eval_failed",
        failedCase: "course_fee_inquiry",
        normalizedCause:
          "Run eval_20260921_abc12345 error at 2026-09-21T15:30:00.000Z id 12345678-1234-1234-1234-123456789abc fee mismatch",
      });

      const fpWithRunB = createIncidentFingerprint({
        tenantId: "tenant_1",
        alertType: "ai_eval_failed",
        failedCase: "course_fee_inquiry",
        normalizedCause:
          "Run eval_20260922_fed98765 error at 2026-09-22T08:15:30.123Z id 87654321-4321-4321-4321-cba987654321 fee mismatch",
      });

      expect(fpWithRunA).toBe(fpWithRunB);
    });

    it("enforces tenant isolation so different tenants produce distinct fingerprints", () => {
      const fpTenantA = createIncidentFingerprint({
        tenantId: "tenant_alpha",
        alertType: "meta_auth_failure",
        failedCase: "webhook",
        normalizedCause: "Token expired",
      });

      const fpTenantB = createIncidentFingerprint({
        tenantId: "tenant_beta",
        alertType: "meta_auth_failure",
        failedCase: "webhook",
        normalizedCause: "Token expired",
      });

      expect(fpTenantA).not.toBe(fpTenantB);
    });
  });

  describe("Incident deduplication, counter increments, and last_seen_at updates", () => {
    it("creates a new incident on first occurrence", async () => {
      const result = await recordIncident({
        tenantId: "tenant_test",
        alertType: "catalog_mismatch",
        failedCase: "python_diploma",
        normalizedCause: "Expected 45000 PKR got 50000 PKR",
      });

      expect(result.isNew).toBe(true);
      expect(result.alert.status).toBe("pending");
      expect(mockDbState.alerts).toHaveLength(1);
    });

    it("increments occurrence count and updates last_seen_at for recurring incidents", async () => {
      const first = await recordIncident({
        tenantId: "tenant_test",
        alertType: "webhook_latency",
        failedCase: "meta_inbound",
        normalizedCause: "Response took 4200ms exceeding 2000ms SLA",
      });

      const initialTimestamp = first.alert.created_at;

      const second = await recordIncident({
        tenantId: "tenant_test",
        alertType: "webhook_latency",
        failedCase: "meta_inbound",
        normalizedCause: "Response took 4200ms exceeding 2000ms SLA",
      });

      expect(second.isNew).toBe(false);
      expect(second.alert.fingerprint).toBe(first.alert.fingerprint);
      expect(mockDbState.alerts).toHaveLength(1);

      const count =
        (second.alert as any).occurrence_count ||
        (second.alert.details as Record<string, unknown>)?.occurrence_count;
      expect(count).toBe(2);
      expect(second.alert.last_seen_at).toBeDefined();
    });

    it("ensures dashboard count matches actual unresolved incident rows", async () => {
      await recordIncident({
        tenantId: "tenant_test",
        alertType: "alert_1",
        failedCase: "case_1",
        normalizedCause: "failure reason A",
      });

      await recordIncident({
        tenantId: "tenant_test",
        alertType: "alert_2",
        failedCase: "case_2",
        normalizedCause: "failure reason B",
      });

      const alertsResult = await loadOperationsAlerts({ status: "pending" });
      expect(alertsResult.total).toBe(2);
      expect(alertsResult.data).toHaveLength(2);
      expect(alertsResult.data.map((a) => a.alert_type).sort()).toEqual(["alert_1", "alert_2"]);
    });
  });
});
