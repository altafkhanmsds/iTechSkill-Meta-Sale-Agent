import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { replayRelayBatch } from "@/lib/whatsapp/relay-service";

export async function POST(request: Request) {
  try {
    await requireRole("admin");
    const body = await request.json().catch(() => ({}));
    const { relayId, allDeadLetter } = body;

    const db = supabaseAdmin();

    if (relayId) {
      const result = await replayRelayBatch(relayId);
      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Replay failed" },
          { status: 500 }
        );
      }
      return NextResponse.json({
        success: true,
        message: `Relay item ${relayId} successfully replayed to n8n`,
      });
    }

    if (allDeadLetter) {
      const { data: deadItems, error } = await db
        .from("itechskill_relay_inbox")
        .select("id")
        .in("status", ["dead_letter", "failed"])
        .limit(50);

      if (error) {
        return NextResponse.json(
          { error: `Failed to query dead letter queue: ${error.message}` },
          { status: 500 }
        );
      }

      let succeeded = 0;
      let failed = 0;

      for (const item of deadItems || []) {
        const res = await replayRelayBatch(item.id);
        if (res.success) succeeded++;
        else failed++;
      }

      return NextResponse.json({
        success: true,
        totalReplayed: (deadItems || []).length,
        succeeded,
        failed,
      });
    }

    return NextResponse.json(
      { error: "Provide either relayId or allDeadLetter: true" },
      { status: 400 }
    );
  } catch (err) {
    console.error("[api/ops/relay/replay] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await requireRole("agent");
    const db = supabaseAdmin();

    const [dlqRes, summaryRes] = await Promise.all([
      db
        .from("itechskill_relay_inbox")
        .select("*")
        .in("status", ["dead_letter", "failed"])
        .order("created_at", { ascending: false })
        .limit(25),
      db
        .from("itechskill_relay_inbox")
        .select("status, created_at, last_attempt_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const recent = summaryRes.data || [];
    const acceptedCount = recent.filter((r) => r.status === "accepted").length;
    const failedCount = recent.filter((r) => r.status === "failed" || r.status === "dead_letter").length;

    return NextResponse.json({
      dlqItems: dlqRes.data || [],
      stats: {
        totalRecent: recent.length,
        acceptedCount,
        failedCount,
        lastAttemptAt: recent[0]?.last_attempt_at || recent[0]?.created_at || null,
      },
    });
  } catch (err) {
    console.error("[api/ops/relay/replay GET] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
