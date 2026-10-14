import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { normalizePhone } from "@/lib/whatsapp/phone-utils";

export async function POST(request: Request) {
  try {
    const db = supabaseAdmin();
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhone(String(body.phone || body.from || ""));
    const requestId = String(
      body.request_id || `req_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
    ).trim();
    const provider = String(body.provider || "meta").trim();
    const providerCallId = body.provider_call_id
      ? String(body.provider_call_id).trim()
      : null;
    const nowIso = new Date().toISOString();

    // 1. Check if call routing is enabled globally (safe default: OFF)
    const { data: config } = await db
      .from("itechskill_operations_config")
      .select("call_routing_enabled")
      .limit(1)
      .maybeSingle();

    const isRoutingEnabled = Boolean(config?.call_routing_enabled);
    if (!isRoutingEnabled) {
      if (phone) {
        try {
          await db.from("itechskill_call_handoffs_v2").insert({
            request_id: requestId,
            phone,
            direction: String(body.direction || "inbound"),
            source: String(body.source || "whatsapp_call"),
            provider,
            provider_call_id: providerCallId,
            status: "provider_disabled",
            failure_category: "routing_disabled",
            requested_at: nowIso,
            last_event_at: nowIso,
            created_at: nowIso,
            updated_at: nowIso,
          });
        } catch {
          // Non-blocking log insert
        }
      }

      return NextResponse.json({
        route: "voicemail",
        reason: "Call routing disabled by administrator",
        fallback_action: "record_voicemail",
        request_id: requestId,
        provider_call_id: providerCallId,
      });
    }

    // 2. Check for actively present agents (heartbeat in last 45s)
    const fortyFiveSecondsAgo = new Date(Date.now() - 45 * 1000).toISOString();
    const { data: activeAgents } = await db
      .from("itechskill_agent_presence")
      .select("user_id, status, last_heartbeat_at")
      .eq("status", "available")
      .gte("last_heartbeat_at", fortyFiveSecondsAgo)
      .order("last_heartbeat_at", { ascending: false });

    if (!activeAgents || activeAgents.length === 0) {
      if (phone) {
        try {
          await db.from("itechskill_call_handoffs_v2").insert({
            request_id: requestId,
            phone,
            direction: String(body.direction || "inbound"),
            source: String(body.source || "whatsapp_call"),
            provider,
            provider_call_id: providerCallId,
            status: "queued",
            failure_category: "no_agents_available",
            requested_at: nowIso,
            queued_at: nowIso,
            last_event_at: nowIso,
            created_at: nowIso,
            updated_at: nowIso,
          });
        } catch {
          // Non-blocking log insert
        }
      }

      return NextResponse.json({
        route: "voicemail",
        reason: "No agents currently available",
        fallback_action: "record_voicemail",
        request_id: requestId,
        provider_call_id: providerCallId,
      });
    }

    // 3. Route to the most recently active agent
    const assignedAgent = activeAgents[0];

    if (phone) {
      try {
        await db.from("itechskill_call_handoffs_v2").insert({
          request_id: requestId,
          phone,
          direction: String(body.direction || "inbound"),
          source: String(body.source || "whatsapp_call"),
          provider,
          provider_call_id: providerCallId,
          status: "agent_reserved",
          assigned_agent_id: assignedAgent.user_id,
          requested_at: nowIso,
          reserved_at: nowIso,
          last_event_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        });
      } catch {
        // Non-blocking log insert
      }
    }

    return NextResponse.json({
      route: "agent",
      assigned_agent_id: assignedAgent.user_id,
      agent_id: assignedAgent.user_id, // alias for legacy callers
      request_id: requestId,
      provider_call_id: providerCallId,
      phone,
      allocated_at: nowIso,
    });
  } catch (err) {
    console.error("[webhook/itechskill-call-route-v2] error:", err);
    return NextResponse.json(
      {
        route: "voicemail",
        reason: "Internal error in call routing adapter",
        error: err instanceof Error ? err.message : "Routing error",
      },
      { status: 500 }
    );
  }
}
