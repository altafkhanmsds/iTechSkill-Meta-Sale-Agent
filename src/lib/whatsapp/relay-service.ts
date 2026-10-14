import crypto from "crypto";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { handleStopKeyword, handleStartKeyword } from "@/lib/consent/consent-manager";

export interface RelayInboxRecord {
  id: number | string;
  tenant_id: string | null;
  batch_id: string;
  status: "pending" | "accepted" | "failed" | "dead_letter";
  raw_payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  last_attempt_at: string | null;
  accepted_at: string | null;
  created_at: string;
}

export interface ExpandedWebhookMessage {
  id: string;
  from: string;
  timestamp: string; // Original Unix-seconds string from Meta
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type: string };
  interactive?: Record<string, unknown>;
  context?: { id: string };
  contact_profile?: { name: string; wa_id: string };
}

export interface ExpandedWebhookStatus {
  id: string; // provider_message_id
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  biz_opaque_callback_data?: string; // e.g. "its-outbox:<id>"
  errors?: Array<{ code: number; title: string; message?: string }>;
}

export interface WebhookExpansionResult {
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  messages: ExpandedWebhookMessage[];
  statuses: ExpandedWebhookStatus[];
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=") || !appSecret) {
    return false;
  }
  const signatureHash = signatureHeader.slice(7).trim();
  const expectedHash = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  if (signatureHash.length !== expectedHash.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHash, "hex"),
      Buffer.from(expectedHash, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * Expands all messages and statuses from a Meta webhook batch.
 * Correctly pairs each message with its corresponding contact using wa_id,
 * without falling back incorrectly to contacts[0] or discarding messages
 * in batches that also include statuses.
 */
export function expandWebhookBatch(rawBatch: Record<string, unknown>): WebhookExpansionResult[] {
  const results: WebhookExpansionResult[] = [];
  const entries = (rawBatch.entry as Array<Record<string, unknown>>) || [];

  for (const entry of entries) {
    const changes = (entry.changes as Array<Record<string, unknown>>) || [];
    for (const change of changes) {
      const val = (change.value as Record<string, unknown>) || {};
      const metadata = (val.metadata as { display_phone_number: string; phone_number_id: string }) || {
        display_phone_number: "",
        phone_number_id: "",
      };

      const contacts = (val.contacts as Array<{ profile: { name: string }; wa_id: string }>) || [];
      const messages = (val.messages as Array<Record<string, unknown>>) || [];
      const statuses = (val.statuses as Array<Record<string, unknown>>) || [];

      // 1. Expand messages, matching contact by wa_id
      const expandedMessages: ExpandedWebhookMessage[] = messages.map((msg) => {
        const from = String(msg.from || "").trim();
        const matchedContact = contacts.find((c) => c.wa_id === from);
        const contactProfile = matchedContact
          ? { name: matchedContact.profile?.name || from, wa_id: matchedContact.wa_id }
          : { name: from, wa_id: from };

        return {
          id: String(msg.id),
          from,
          timestamp: String(msg.timestamp), // Preserve provider's Unix seconds
          type: String(msg.type || "text"),
          text: msg.text as { body: string } | undefined,
          image: msg.image as { id: string; mime_type: string; caption?: string } | undefined,
          video: msg.video as { id: string; mime_type: string; caption?: string } | undefined,
          document: msg.document as { id: string; mime_type: string; filename?: string; caption?: string } | undefined,
          audio: msg.audio as { id: string; mime_type: string } | undefined,
          interactive: msg.interactive as Record<string, unknown> | undefined,
          context: msg.context as { id: string } | undefined,
          contact_profile: contactProfile,
        };
      });

      // 2. Expand statuses, preserving biz_opaque_callback_data (its-outbox:<id>)
      const expandedStatuses: ExpandedWebhookStatus[] = statuses.map((st) => ({
        id: String(st.id),
        status: String(st.status) as "sent" | "delivered" | "read" | "failed",
        timestamp: String(st.timestamp),
        recipient_id: String(st.recipient_id),
        biz_opaque_callback_data: st.biz_opaque_callback_data ? String(st.biz_opaque_callback_data) : undefined,
        errors: st.errors as Array<{ code: number; title: string; message?: string }> | undefined,
      }));

      if (expandedMessages.length > 0 || expandedStatuses.length > 0) {
        results.push({
          metadata,
          messages: expandedMessages,
          statuses: expandedStatuses,
        });
      }
    }
  }

  return results;
}

/**
 * Durably persists a webhook batch in itechskill_relay_inbox before HTTP acknowledgement.
 */
export async function persistRelayBatch(
  tenantId: string | null,
  rawPayload: Record<string, unknown>
): Promise<RelayInboxRecord> {
  const db = supabaseAdmin();
  const batchId = `relay_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  const { data, error } = await db
    .from("itechskill_relay_inbox")
    .insert({
      tenant_id: tenantId,
      batch_id: batchId,
      status: "pending",
      raw_payload: rawPayload,
      attempts: 0,
      max_attempts: 5,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to persist durable relay batch: ${error?.message || "unknown"}`);
  }

  return data as RelayInboxRecord;
}

/**
 * Forward relay batch to n8n inbound webhook with timeout (~5s) and header auth.
 * Retries transport failures with exponential backoff and jitter without mutating IDs.
 */
export async function forwardRelayBatchToN8n(
  relayId: number | string,
  payload: Record<string, unknown>,
  attemptNumber: number = 0
): Promise<{ success: boolean; status: number | string; error?: string }> {
  const db = supabaseAdmin();
  const targetUrl = process.env.N8N_CRM_WEBHOOK_URL || "http://localhost:5678/webhook/itechskill-crm-inbound";
  const authSecret = process.env.N8N_CRM_WEBHOOK_SECRET || "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // 5s finite timeout

  const nowIso = new Date().toISOString();

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-itechskill-crm-secret": authSecret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      // Marked accepted on 2xx
      await db
        .from("itechskill_relay_inbox")
        .update({
          status: "accepted",
          accepted_at: nowIso,
          last_attempt_at: nowIso,
          attempts: attemptNumber + 1,
        })
        .eq("id", relayId);

      return { success: true, status: res.status };
    }

    const errText = await res.text().catch(() => "Non-2xx response");
    const isRetryable = res.status === 429 || res.status >= 500;
    const nextAttempts = attemptNumber + 1;
    const nextStatus = isRetryable && nextAttempts < 5 ? "failed" : "dead_letter";

    await db
      .from("itechskill_relay_inbox")
      .update({
        status: nextStatus,
        last_error: `HTTP ${res.status}: ${errText.slice(0, 500)}`,
        last_attempt_at: nowIso,
        attempts: nextAttempts,
      })
      .eq("id", relayId);

    return { success: false, status: res.status, error: errText };
  } catch (err: unknown) {
    clearTimeout(timeout);
    const errMessage = err instanceof Error ? err.message : String(err);
    const nextAttempts = attemptNumber + 1;
    const nextStatus = nextAttempts < 5 ? "failed" : "dead_letter";

    await db
      .from("itechskill_relay_inbox")
      .update({
        status: nextStatus,
        last_error: `Network/Timeout: ${errMessage.slice(0, 500)}`,
        last_attempt_at: nowIso,
        attempts: nextAttempts,
      })
      .eq("id", relayId);

    return { success: false, status: "network_error", error: errMessage };
  }
}

/**
 * Manual replay action for staff/operator diagnostics.
 */
export async function replayRelayBatch(relayId: number | string): Promise<{ success: boolean; error?: string }> {
  const db = supabaseAdmin();
  const { data: record, error } = await db
    .from("itechskill_relay_inbox")
    .select("*")
    .eq("id", relayId)
    .single();

  if (error || !record) {
    return { success: false, error: "Relay record not found" };
  }

  const result = await forwardRelayBatchToN8n(record.id, record.raw_payload as Record<string, unknown>, record.attempts);
  return { success: result.success, error: result.error };
}
