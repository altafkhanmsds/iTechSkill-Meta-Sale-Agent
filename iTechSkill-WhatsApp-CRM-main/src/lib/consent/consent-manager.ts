import { supabaseAdmin } from "@/lib/flows/admin-client";
import { writeAuditLog } from "@/lib/operations/audit";

export interface MarketingConsentRecord {
  phone: string;
  optedIn: boolean;
  source: "web_form" | "whatsapp_inbound" | "staff_manual" | "admission_form";
  wordingVersion: string;
  notes?: string;
  actorUserId?: string;
}

const OPT_OUT_KEYWORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit", "stopall"]);
const OPT_IN_KEYWORDS = new Set(["start", "unstop", "yes"]);

export function isOptOutKeyword(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  return OPT_OUT_KEYWORDS.has(text.trim().toLowerCase());
}

export function isOptInKeyword(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  return OPT_IN_KEYWORDS.has(text.trim().toLowerCase());
}

/**
 * Handles STOP keyword:
 * 1. Sets opted_out = true and marketing_opted_in = false in itechskill_conversation_guard.
 * 2. Cancels any pending or processing follow-up jobs in itechskill_followup_jobs.
 * 3. Records immutable audit entry.
 */
export async function handleStopKeyword(
  phone: string,
  source: string = "whatsapp_keyword",
  actorUserId: string = "system"
): Promise<{ success: boolean; cancelledJobs: number }> {
  const db = supabaseAdmin();
  const normalizedPhone = phone.trim();
  const now = new Date().toISOString();

  // 1. Update conversation guard
  await db
    .from("itechskill_conversation_guard")
    .upsert(
      {
        phone: normalizedPhone,
        opted_out: true,
        marketing_opted_in: false,
        version: 1,
      },
      { onConflict: "phone" }
    );

  // 2. Cancel queued follow-ups
  const { data: cancelled, error: cancelError } = await db
    .from("itechskill_followup_jobs")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_reason: "Student requested STOP / opt-out",
      updated_at: now,
    })
    .eq("phone", normalizedPhone)
    .in("status", ["pending", "claimed", "processing"])
    .select("job_id");

  if (cancelError) {
    console.error("[consent] error cancelling followups:", cancelError);
  }

  // 3. Write immutable audit log
  await writeAuditLog({
    actorUserId,
    actorRole: "system",
    action: "consent.stop",
    entityType: "itechskill_conversation_guard",
    entityId: normalizedPhone,
    beforeState: { opted_out: false },
    afterState: { opted_out: true, marketing_opted_in: false },
    reason: `STOP command received via ${source}`,
  });

  return {
    success: true,
    cancelledJobs: cancelled?.length ?? 0,
  };
}

/**
 * Handles START keyword:
 * Resumes requested transactional/service messaging, but DOES NOT
 * automatically grant marketing consent.
 */
export async function handleStartKeyword(
  phone: string,
  source: string = "whatsapp_keyword",
  actorUserId: string = "system"
): Promise<{ success: boolean }> {
  const db = supabaseAdmin();
  const normalizedPhone = phone.trim();

  // 1. Clear opt-out in conversation guard, keep marketing_opted_in = false
  await db
    .from("itechskill_conversation_guard")
    .upsert(
      {
        phone: normalizedPhone,
        opted_out: false,
        // Crucial: START resumes service messaging only, does NOT opt-in to marketing!
        marketing_opted_in: false,
      },
      { onConflict: "phone" }
    );

  // 2. Write immutable audit log
  await writeAuditLog({
    actorUserId,
    actorRole: "system",
    action: "consent.start",
    entityType: "itechskill_conversation_guard",
    entityId: normalizedPhone,
    beforeState: { opted_out: true },
    afterState: { opted_out: false, marketing_opted_in: false },
    reason: `START command received via ${source}. Service messaging resumed; marketing consent remains false.`,
  });

  return { success: true };
}

/**
 * Explicit marketing consent capture with source, wording version, and withdrawal audit.
 * Keeps itechskill_conversation_guard.marketing_opted_in strictly synchronized.
 */
export async function updateMarketingConsent(
  record: MarketingConsentRecord
): Promise<{ success: boolean }> {
  const db = supabaseAdmin();
  const normalizedPhone = record.phone.trim();

  // Synchronize conversation guard
  await db
    .from("itechskill_conversation_guard")
    .upsert(
      {
        phone: normalizedPhone,
        marketing_opted_in: record.optedIn,
      },
      { onConflict: "phone" }
    );

  // Write immutable audit log
  await writeAuditLog({
    actorUserId: record.actorUserId || "system",
    actorRole: "agent",
    action: record.optedIn ? "consent.marketing_opt_in" : "consent.marketing_withdrawal",
    entityType: "marketing_consent",
    entityId: normalizedPhone,
    beforeState: {},
    afterState: {
      phone: normalizedPhone,
      marketing_opted_in: record.optedIn,
      source: record.source,
      wording_version: record.wordingVersion,
      notes: record.notes,
    },
    reason: record.optedIn
      ? `Explicit marketing consent captured via ${record.source} (wording: ${record.wordingVersion})`
      : `Marketing consent withdrawn via ${record.source}`,
  });

  return { success: true };
}
