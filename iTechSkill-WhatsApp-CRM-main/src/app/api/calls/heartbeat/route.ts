import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const userId = user?.id || "anonymous_agent";
    const body = await request.json().catch(() => ({}));
    const status = body.status || "available"; // available, busy, away
    const nowIso = new Date().toISOString();

    const db = supabaseAdmin();

    // 1. Upsert agent presence in database
    await db.from("itechskill_agent_presence").upsert(
      {
        user_id: userId,
        status,
        last_heartbeat_at: nowIso,
        metadata: body.metadata || {},
      },
      { onConflict: "user_id" }
    );

    // 2. Forward to n8n webhook asynchronously with 5s timeout (fail-open)
    const n8nBaseUrl = process.env.N8N_WEBHOOK_URL;
    if (n8nBaseUrl) {
      const targetUrl = `${n8nBaseUrl.replace(/\/+$/, "")}/webhook/itechskill-crm-agent-presence-v2`;
      const secret = process.env.N8N_CRM_WEBHOOK_SECRET;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(secret ? { "x-itechskill-crm-secret": secret } : {}),
          },
          body: JSON.stringify({
            user_id: userId,
            status,
            heartbeat_at: nowIso,
            source: "crm_browser_agent",
          }),
          signal: controller.signal,
        }).catch((err) => {
          console.warn("[heartbeat] n8n forward failed (non-blocking):", err.message);
        });

        clearTimeout(timeoutId);
      } catch {
        // Suppress forward error to keep CRM client heartbeat healthy
      }
    }

    return NextResponse.json({
      ok: true,
      user_id: userId,
      status,
      timestamp: nowIso,
    });
  } catch (err) {
    console.error("[api/calls/heartbeat] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Heartbeat error" },
      { status: 500 }
    );
  }
}
