import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";

export async function GET() {
  try {
    const db = supabaseAdmin();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [callsRes, summariesRes, presenceRes] = await Promise.all([
      db
        .from("itechskill_call_handoffs_v2")
        .select("status, created_at")
        .gte("created_at", twentyFourHoursAgo),
      db
        .from("itechskill_call_summaries")
        .select("quality_score, seriousness_score, needs_human_followup")
        .gte("created_at", twentyFourHoursAgo),
      db
        .from("itechskill_agent_presence")
        .select("user_id, status, last_heartbeat_at"),
    ]);

    const calls = callsRes.data || [];
    const summaries = summariesRes.data || [];
    const agents = presenceRes.data || [];

    const totalCalls = calls.length;
    const answeredCalls = calls.filter((c) =>
      ["answered", "completed", "in-progress"].includes(c.status)
    ).length;
    const missedCalls = calls.filter((c) =>
      ["missed", "failed", "busy", "no-answer"].includes(c.status)
    ).length;

    const fortyFiveSecondsAgo = new Date(Date.now() - 45 * 1000).toISOString();
    const onlineAgents = agents.filter(
      (a) => a.status === "available" && a.last_heartbeat_at >= fortyFiveSecondsAgo
    ).length;

    const answeredRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 100;

    return NextResponse.json({
      period: "last_24h",
      calls: {
        total: totalCalls,
        answered: answeredCalls,
        missed: missedCalls,
        answered_rate_percent: Math.round(answeredRate * 10) / 10,
      },
      quality: {
        analyzed_calls: summaries.length,
        requires_human_followup: summaries.filter((s) => s.needs_human_followup).length,
      },
      agents: {
        total_registered: agents.length,
        currently_available: onlineAgents,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[webhook/itechskill-automation-metrics-v2] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
