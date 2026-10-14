import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { normalizePhone } from "@/lib/whatsapp/phone-utils";

export async function POST(request: Request) {
  try {
    const db = supabaseAdmin();
    const body = await request.json().catch(() => ({}));

    const provider = String(body.provider || "meta").trim();
    const providerCallId =
      body.provider_call_id || body.call_id || body.id
        ? String(body.provider_call_id || body.call_id || body.id).trim()
        : null;
    const suppliedRequestId = body.request_id ? String(body.request_id).trim() : null;
    const phone = normalizePhone(String(body.phone || body.from || ""));
    const eventType = String(body.event || body.type || body.status || "update").toLowerCase();
    const assignedAgentId =
      body.assigned_agent_id || body.agent_id
        ? String(body.assigned_agent_id || body.agent_id).trim()
        : null;
    const durationSeconds =
      body.duration || body.duration_seconds !== undefined
        ? Number(body.duration || body.duration_seconds)
        : null;
    const nowIso = new Date().toISOString();

    let finalRequestId = suppliedRequestId;

    // 1. If no request_id provided, look up by provider + provider_call_id
    if (!finalRequestId && providerCallId) {
      const { data: existingByProviderCall } = await db
        .from("itechskill_call_handoffs_v2")
        .select("request_id")
        .eq("provider", provider)
        .eq("provider_call_id", providerCallId)
        .maybeSingle();

      if (existingByProviderCall?.request_id) {
        finalRequestId = existingByProviderCall.request_id;
      }
    }

    // 2. If still no request_id and phone provided, try finding recent active call for this phone
    if (!finalRequestId && phone) {
      const { data: existingByPhone } = await db
        .from("itechskill_call_handoffs_v2")
        .select("request_id")
        .eq("phone", phone)
        .in("status", [
          "queued",
          "agent_reserved",
          "agent_ringing",
          "in_progress",
          "in-progress",
          "ringing",
        ])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingByPhone?.request_id) {
        finalRequestId = existingByPhone.request_id;
      }
    }

    // 3. If record exists, update by request_id
    if (finalRequestId) {
      const updates: Record<string, unknown> = {
        status: eventType,
        last_event_at: nowIso,
        updated_at: nowIso,
      };

      if (assignedAgentId) updates.assigned_agent_id = assignedAgentId;
      if (providerCallId) updates.provider_call_id = providerCallId;
      if (durationSeconds !== null && !isNaN(durationSeconds)) {
        updates.duration_seconds = durationSeconds;
      }
      if (body) updates.metadata = body;

      if (["answered", "in_progress", "in-progress"].includes(eventType)) {
        updates.answered_at = body.answered_at || nowIso;
      }
      if (
        ["completed", "ended", "failed", "missed", "cancelled"].includes(
          eventType
        )
      ) {
        updates.ended_at = body.ended_at || nowIso;
      }

      await db
        .from("itechskill_call_handoffs_v2")
        .update(updates)
        .eq("request_id", finalRequestId);
    } else {
      // 4. Record did not exist yet: create new handoff with generated request_id
      finalRequestId = `req_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const insertPayload: Record<string, unknown> = {
        request_id: finalRequestId,
        phone: phone || "unknown",
        direction: String(body.direction || "inbound"),
        source: String(body.source || "whatsapp_call"),
        provider,
        provider_call_id: providerCallId,
        status: eventType,
        assigned_agent_id: assignedAgentId,
        requested_at: body.requested_at || nowIso,
        last_event_at: nowIso,
        duration_seconds: durationSeconds,
        metadata: body,
        created_at: nowIso,
        updated_at: nowIso,
      };

      if (["answered", "in_progress", "in-progress"].includes(eventType)) {
        insertPayload.answered_at = nowIso;
      }
      if (
        ["completed", "ended", "failed", "missed", "cancelled"].includes(
          eventType
        )
      ) {
        insertPayload.ended_at = nowIso;
      }

      await db.from("itechskill_call_handoffs_v2").insert(insertPayload);
    }

    return NextResponse.json({
      accepted: true,
      request_id: finalRequestId,
      provider_call_id: providerCallId,
      status: eventType,
      timestamp: nowIso,
    });
  } catch (err) {
    console.error("[webhook/itechskill-call-events-v2] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
