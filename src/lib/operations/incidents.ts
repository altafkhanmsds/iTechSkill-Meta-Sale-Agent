import crypto from "crypto";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import type { AlertSeverity, AlertStatus, OperationsAlert } from "./types";

export interface CreateIncidentParams {
  tenantId?: string;
  alertType: string;
  severity?: AlertSeverity;
  failedCase?: string;
  normalizedCause: string;
  details?: Record<string, unknown>;
}

/**
 * Creates a stable incident fingerprint.
 * Strictly excludes volatile execution artifacts such as run IDs,
 * timestamps, random seeds, and ephemeral payload fields.
 *
 * Keys on: tenant + alert_type + failed_case + normalized_cause
 */
export function createIncidentFingerprint(params: {
  tenantId?: string;
  alertType: string;
  failedCase?: string;
  normalizedCause: string;
}): string {
  const tenant = (params.tenantId || "default").trim().toLowerCase();
  const alertType = params.alertType.trim().toLowerCase();
  const failedCase = (params.failedCase || "general").trim().toLowerCase();

  // Strip volatile fields (timestamps, UUIDs, run IDs like eval_2026...)
  const normalizedCause = params.normalizedCause
    .trim()
    .toLowerCase()
    .replace(/eval_\d+_[a-f0-9]+/gi, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(\.\d+)?(z|[+-]\d{2}:\d{2})?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const rawKey = `${tenant}:${alertType}:${failedCase}:${normalizedCause}`;
  return crypto.createHash("sha256").update(rawKey).digest("hex").slice(0, 32);
}

/**
 * Upserts an operational incident using the stable fingerprint.
 * If an active (pending/acknowledged) incident exists with the same fingerprint,
 * updates `last_seen_at` and increments occurrence count on the existing record.
 */
export async function recordIncident(params: CreateIncidentParams): Promise<{
  fingerprint: string;
  isNew: boolean;
  alert: OperationsAlert;
}> {
  const db = supabaseAdmin();
  const fingerprint = createIncidentFingerprint({
    tenantId: params.tenantId,
    alertType: params.alertType,
    failedCase: params.failedCase,
    normalizedCause: params.normalizedCause,
  });

  const now = new Date().toISOString();

  // Check for existing active or recent incident
  const { data: existing, error: findError } = await db
    .from("itechskill_operations_alerts")
    .select("*")
    .eq("fingerprint", fingerprint)
    .maybeSingle();

  if (findError) {
    console.error("[incidents] lookup error:", findError);
  }

  if (existing) {
    // Increment occurrence count & update last_seen_at
    const currentCount =
      typeof existing.occurrence_count === "number"
        ? existing.occurrence_count
        : Number((existing.details as Record<string, unknown>)?.occurrence_count ?? 1);
    const newCount = currentCount + 1;

    const mergedDetails = {
      ...(existing.details || {}),
      ...(params.details || {}),
      occurrence_count: newCount,
      failed_case: params.failedCase,
      normalized_cause: params.normalizedCause,
    };

    // If previously resolved, reopening resets status to pending
    const statusToSet: AlertStatus =
      existing.status === "resolved" ? "pending" : (existing.status as AlertStatus);

    const updatePayload: Record<string, unknown> = {
      status: statusToSet,
      last_seen_at: now,
      details: mergedDetails,
    };

    // Attempt updating occurrence_count column
    try {
      updatePayload.occurrence_count = newCount;
    } catch {
      // Column may not exist on older schema, stored in details
    }

    const { data: updated, error: updateError } = await db
      .from("itechskill_operations_alerts")
      .update(updatePayload)
      .eq("fingerprint", fingerprint)
      .select()
      .single();

    if (updateError) {
      // Retry without explicit occurrence_count column if schema lacks it
      delete updatePayload.occurrence_count;
      const { data: fallbackUpdated, error: fallbackError } = await db
        .from("itechskill_operations_alerts")
        .update(updatePayload)
        .eq("fingerprint", fingerprint)
        .select()
        .single();

      if (fallbackError) throw new Error(`recordIncident update failed: ${fallbackError.message}`);
      return { fingerprint, isNew: false, alert: fallbackUpdated as OperationsAlert };
    }

    return { fingerprint, isNew: false, alert: updated as OperationsAlert };
  }

  // Create new incident
  const insertPayload: Record<string, unknown> = {
    fingerprint,
    alert_type: params.alertType,
    severity: params.severity || "urgent",
    status: "pending",
    details: {
      ...(params.details || {}),
      occurrence_count: 1,
      failed_case: params.failedCase,
      normalized_cause: params.normalizedCause,
    },
    first_seen_at: now,
    last_seen_at: now,
  };

  const { data: created, error: insertError } = await db
    .from("itechskill_operations_alerts")
    .insert(insertPayload)
    .select()
    .single();

  if (insertError) {
    throw new Error(`recordIncident insert failed: ${insertError.message}`);
  }

  return { fingerprint, isNew: true, alert: created as OperationsAlert };
}
