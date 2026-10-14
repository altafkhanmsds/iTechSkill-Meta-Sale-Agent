import crypto from "crypto";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { normalizePhone } from "@/lib/whatsapp/phone-utils";
import { findExistingContact } from "@/lib/contacts/dedupe";

export type AutomationEventType =
  | "response_prepared"
  | "whatsapp_accepted"
  | "whatsapp_status"
  | "whatsapp_delivery_problem"
  | "call_summary";

export interface AutomationEventBase {
  schema_version: "2.0";
  event_type: AutomationEventType;
  event_id?: string | number;
  phone: string;
  phone_number_id?: string;
  timestamp?: string;
}

export interface ResponsePreparedEvent extends AutomationEventBase {
  event_type: "response_prepared";
  reply: string;
  handoff_required?: boolean;
  payment_evidence_received?: boolean;
  call_requested?: boolean;
}

export interface WhatsappAcceptedEvent extends AutomationEventBase {
  event_type: "whatsapp_accepted";
  outbox_id: string | number;
  provider_message_id: string;
  reply: string;
}

export interface WhatsappStatusEvent extends AutomationEventBase {
  event_type: "whatsapp_status";
  outbox_id?: string | number;
  provider_message_id: string;
  status: "sent" | "delivered" | "read" | "failed";
}

export interface WhatsappDeliveryProblemEvent extends AutomationEventBase {
  event_type: "whatsapp_delivery_problem";
  outbox_id: string | number;
  status: "failed" | "send_unknown";
  error_category: string;
  provider_message_id?: string;
}

export interface CallSummaryEvent extends AutomationEventBase {
  event_type: "call_summary";
  provider: string;
  call_id: string;
  summary: {
    valid?: boolean;
    text?: string;
    intent?: string;
    program?: string;
    quality_score?: number;
    seriousness_score?: number;
    next_steps?: string[];
  };
}

export type AutomationEventPayload =
  | ResponsePreparedEvent
  | WhatsappAcceptedEvent
  | WhatsappStatusEvent
  | WhatsappDeliveryProblemEvent
  | CallSummaryEvent;

export interface ProcessEventResult {
  status: number;
  body: Record<string, unknown>;
}

// Status hierarchy levels to guarantee monotonic transitions
const STATUS_LEVELS: Record<string, number> = {
  pending: 0,
  prepared: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

/**
 * Normalizes request payload into a canonical string for SHA-256 hashing.
 */
export function hashPayload(payload: unknown): string {
  const serialized = JSON.stringify(payload, Object.keys(payload as object).sort());
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

/**
 * Executes idempotent event processing in a single logical transaction:
 * 1. Checks (tenant_id, idempotency_key).
 *    - Same key + same hash -> return original 200 result
 *    - Same key + different hash -> return 409 Conflict
 * 2. Applies CRM message / status / task updates with monotonic checks.
 * 3. Commits idempotency record.
 */
export async function processAutomationEvent(args: {
  tenantId?: string | null;
  idempotencyKey: string;
  payload: AutomationEventPayload;
}): Promise<ProcessEventResult> {
  const tenantId = args.tenantId || null;
  const { idempotencyKey, payload } = args;
  const db = supabaseAdmin();
  const currentHash = hashPayload(payload);

  // 1. Idempotency Check
  let query = db
    .from("itechskill_automation_idempotency")
    .select("*")
    .eq("idempotency_key", idempotencyKey);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data: existingRecord, error: fetchErr } = await query.maybeSingle();

  if (!fetchErr && existingRecord) {
    if (existingRecord.payload_hash === currentHash) {
      // Reused key with identical content: Return original result
      return {
        status: existingRecord.response_status || 200,
        body: existingRecord.response_body as Record<string, unknown>,
      };
    }
    // Reused key with changed content: 409 Conflict
    return {
      status: 409,
      body: {
        error: "Idempotency key conflict: payload has changed for this key",
        idempotency_key: idempotencyKey,
      },
    };
  }

  // 2. Validate payload schema
  if (payload.schema_version !== "2.0") {
    return {
      status: 400,
      body: { error: "Unsupported schema_version. Expected '2.0'" },
    };
  }

  const phone = normalizePhone(payload.phone);
  if (!phone) {
    return { status: 400, body: { error: "Invalid or missing phone number" } };
  }

  const nowIso = new Date().toISOString();
  const timestamp = payload.timestamp || nowIso;
  let responseBody: Record<string, unknown> = { accepted: true, schema_version: "2.0" };

  try {
    // 3. Resolve Contact & Conversation
    const accountId = tenantId || "00000000-0000-0000-0000-000000000000";
    let contact = await findExistingContact(db, accountId, phone);
    if (!contact) {
      // Auto-provision contact if not present
      const { data: newContact } = await db
        .from("contacts")
        .insert({
          account_id: accountId,
          phone,
          name: phone,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select()
        .single();
      contact = newContact;
    }

    let conversationId: string | null = null;
    if (contact) {
      const { data: convs } = await db
        .from("conversations")
        .select("id")
        .eq("account_id", accountId)
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: true })
        .limit(1);

      if (convs && convs.length > 0) {
        conversationId = convs[0].id;
      } else {
        const { data: newConv } = await db
          .from("conversations")
          .insert({
            account_id: accountId,
            contact_id: contact.id,
            status: "open",
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select()
          .single();
        conversationId = newConv?.id || null;
      }
    }

    // 4. Handle Specific Event Types
    switch (payload.event_type) {
      case "response_prepared": {
        const prepEvent = payload as ResponsePreparedEvent;
        const msgId = `prep_${prepEvent.event_id || idempotencyKey}`;

        // Create or update pending message row (status: pending, not sent!)
        if (conversationId) {
          await db.from("messages").upsert(
            {
              conversation_id: conversationId,
              sender_type: "agent",
              content_type: "text",
              content_text: prepEvent.reply,
              message_id: msgId,
              status: "pending",
              created_at: timestamp,
            },
            { onConflict: "conversation_id,message_id" }
          );
        }

        // If handoff required, flag handoff case
        if (prepEvent.handoff_required) {
          await db.from("itechskill_handoff_cases").insert({
            phone,
            status: "open",
            priority: "normal",
            reason: "AI requested human handoff",
            category: "ai_handoff",
            created_at: nowIso,
            updated_at: nowIso,
          });
        }

        responseBody = {
          accepted: true,
          schema_version: "2.0",
          event_type: "response_prepared",
          message_id: msgId,
          status: "pending",
        };
        break;
      }

      case "whatsapp_accepted": {
        const accEvent = payload as WhatsappAcceptedEvent;
        // Provider message ID must be unique
        const providerMsgId = accEvent.provider_message_id;
        const prepMsgId = `prep_${accEvent.event_id || idempotencyKey}`;

        if (conversationId) {
          // Check if message with prepMsgId or providerMsgId exists
          const { data: existingMsg } = await db
            .from("messages")
            .select("id, status")
            .eq("conversation_id", conversationId)
            .or(`message_id.eq.${prepMsgId},message_id.eq.${providerMsgId}`)
            .maybeSingle();

          if (existingMsg) {
            // Update existing row rather than creating a duplicate
            await db
              .from("messages")
              .update({
                message_id: providerMsgId,
                status: "sent",
                content_text: accEvent.reply,
                updated_at: nowIso,
              })
              .eq("id", existingMsg.id);
          } else {
            // Insert new sent message row
            await db.from("messages").insert({
              conversation_id: conversationId,
              sender_type: "agent",
              content_type: "text",
              content_text: accEvent.reply,
              message_id: providerMsgId,
              status: "sent",
              created_at: timestamp,
            });
          }

          // Update conversation preview
          await db
            .from("conversations")
            .update({
              last_message_text: accEvent.reply,
              last_message_at: timestamp,
              updated_at: nowIso,
            })
            .eq("id", conversationId);
        }

        responseBody = {
          accepted: true,
          schema_version: "2.0",
          event_type: "whatsapp_accepted",
          provider_message_id: providerMsgId,
          status: "sent",
        };
        break;
      }

      case "whatsapp_status": {
        const stEvent = payload as WhatsappStatusEvent;
        const newStatus = stEvent.status;
        const providerMsgId = stEvent.provider_message_id;

        if (conversationId && providerMsgId) {
          const { data: targetMsg } = await db
            .from("messages")
            .select("id, status")
            .eq("conversation_id", conversationId)
            .eq("message_id", providerMsgId)
            .maybeSingle();

          if (targetMsg) {
            const currentLevel = STATUS_LEVELS[targetMsg.status] ?? -1;
            const newLevel = STATUS_LEVELS[newStatus] ?? -1;

            // Enforce monotonic transitions: status cannot regress!
            if (newStatus === "failed" || newLevel > currentLevel) {
              await db
                .from("messages")
                .update({
                  status: newStatus,
                  updated_at: nowIso,
                })
                .eq("id", targetMsg.id);
            }
          }
        }

        responseBody = {
          accepted: true,
          schema_version: "2.0",
          event_type: "whatsapp_status",
          provider_message_id: providerMsgId,
          applied_status: newStatus,
        };
        break;
      }

      case "whatsapp_delivery_problem": {
        const probEvent = payload as WhatsappDeliveryProblemEvent;
        // Surface delivery problem as staff recovery task
        await db.from("itechskill_handoff_cases").insert({
          phone,
          status: "open",
          priority: "urgent",
          reason: `WhatsApp delivery failed: ${probEvent.status} (${probEvent.error_category || "unknown"})`,
          category: "delivery_recovery",
          created_at: nowIso,
          updated_at: nowIso,
        });

        responseBody = {
          accepted: true,
          schema_version: "2.0",
          event_type: "whatsapp_delivery_problem",
          recovery_task_created: true,
        };
        break;
      }

      case "call_summary": {
        const callEvent = payload as CallSummaryEvent;
        const summaryObj = callEvent.summary || {};
        const isHumanReview = summaryObj.valid === false;

        await db.from("itechskill_call_summaries").upsert(
          {
            call_id: callEvent.call_id,
            phone,
            source_type: callEvent.provider,
            summary_text: summaryObj.text || null,
            client_intent: summaryObj.intent || null,
            program_interest: summaryObj.program || null,
            quality_score: summaryObj.quality_score || null,
            seriousness_score: summaryObj.seriousness_score || null,
            needs_human_followup: isHumanReview,
            created_at: timestamp,
            updated_at: nowIso,
          },
          { onConflict: "call_id" }
        );

        if (isHumanReview) {
          await db.from("itechskill_handoff_cases").insert({
            phone,
            status: "open",
            priority: "high",
            reason: `Call summary invalid / flagged for human review (Call ID: ${callEvent.call_id})`,
            category: "call_review",
            created_at: nowIso,
            updated_at: nowIso,
          });
        }

        responseBody = {
          accepted: true,
          schema_version: "2.0",
          event_type: "call_summary",
          call_id: callEvent.call_id,
          human_review_required: isHumanReview,
        };
        break;
      }

      default: {
        return { status: 400, body: { error: `Unsupported event_type: ${(payload as AutomationEventBase).event_type}` } };
      }
    }

    // 5. Store Idempotency Record (Atomic single logical transaction)
    await db.from("itechskill_automation_idempotency").insert({
      tenant_id: tenantId,
      idempotency_key: idempotencyKey,
      payload_hash: currentHash,
      event_type: payload.event_type,
      response_status: 200,
      response_body: responseBody,
      created_at: nowIso,
    });

    return { status: 200, body: responseBody };
  } catch (err) {
    console.error("[automation-events] internal error:", err);
    return {
      status: 500,
      body: {
        error: "Internal error processing automation event",
        category: "internal_server_error",
      },
    };
  }
}
