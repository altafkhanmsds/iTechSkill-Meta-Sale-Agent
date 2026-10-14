import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";

export async function GET() {
  try {
    await requireRole("agent");
    const db = supabaseAdmin();
    const fortyFiveSecondsAgo = new Date(Date.now() - 45 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [configRes, activeCallsRes, recentCallsRes, agentsRes] = await Promise.all([
      db.from("itechskill_operations_config").select("call_routing_enabled").limit(1).maybeSingle(),
      db
        .from("itechskill_call_handoffs_v2")
        .select("*")
        .in("status", [
          "in-progress",
          "in_progress",
          "ringing",
          "agent_ringing",
          "agent_reserved",
          "queued",
        ])
        .order("created_at", { ascending: false }),
      db
        .from("itechskill_call_handoffs_v2")
        .select("*")
        .gte("created_at", twentyFourHoursAgo)
        .order("created_at", { ascending: false })
        .limit(20),
      db.from("itechskill_agent_presence").select("*"),
    ]);

    const activeAgents = (agentsRes.data || []).filter(
      (a) => a.status === "available" && a.last_heartbeat_at >= fortyFiveSecondsAgo
    );

    return NextResponse.json({
      callRoutingEnabled: Boolean(configRes.data?.call_routing_enabled),
      activeCalls: activeCallsRes.data || [],
      recentCalls: recentCallsRes.data || [],
      agentsOnline: activeAgents.length,
      allAgents: agentsRes.data || [],
    });
  } catch (err) {
    console.error("[api/ops/calls] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error fetching call operations" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json().catch(() => ({}));
    const { action, enabled } = body;
    const db = supabaseAdmin();
    const nowIso = new Date().toISOString();

    if (action === "toggle_routing") {
      const nextEnabled = Boolean(enabled);
      await db
        .from("itechskill_operations_config")
        .update({
          call_routing_enabled: nextEnabled,
          updated_at: nowIso,
        })
        .eq("id", true);

      return NextResponse.json({
        success: true,
        callRoutingEnabled: nextEnabled,
      });
    }

    if (action === "takeover") {
      const targetRequestId = String(
        body.requestId || body.request_id || body.callId || body.call_id || ""
      ).trim();
      const targetPhone = String(body.phone || "").trim();

      if (!targetRequestId && !targetPhone) {
        return NextResponse.json(
          { error: "Missing requestId or phone" },
          { status: 400 }
        );
      }

      // 1. Mark call handoff in progress
      if (targetRequestId) {
        const { data: updated } = await db
          .from("itechskill_call_handoffs_v2")
          .update({
            status: "human_takeover",
            assigned_agent_id: ctx.userId,
            last_event_at: nowIso,
            updated_at: nowIso,
          })
          .eq("request_id", targetRequestId)
          .select("request_id");

        if (!updated || updated.length === 0) {
          await db
            .from("itechskill_call_handoffs_v2")
            .update({
              status: "human_takeover",
              assigned_agent_id: ctx.userId,
              last_event_at: nowIso,
              updated_at: nowIso,
            })
            .eq("provider_call_id", targetRequestId);
        }
      }

      // 2. Create urgent handoff case
      if (targetPhone) {
        await db.from("itechskill_handoff_cases").insert({
          phone: targetPhone,
          status: "open",
          priority: "urgent",
          reason: `Emergency voice call takeover triggered by agent (${ctx.userId})`,
          category: "voice_takeover",
          assigned_to: ctx.userId,
          created_at: nowIso,
          updated_at: nowIso,
        });

        // 3. Mark conversation guard human_active = true
        await db
          .from("itechskill_conversation_guard")
          .upsert(
            {
              phone: targetPhone,
              human_active: true,
              updated_at: nowIso,
            },
            { onConflict: "phone" }
          );
      }

      return NextResponse.json({
        success: true,
        message:
          "Call emergency takeover activated. Voice bot interrupted and routed to human agent.",
        assigned_agent_id: ctx.userId,
        request_id: targetRequestId,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[api/ops/calls POST] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Call mutation error" },
      { status: 500 }
    );
  }
}
