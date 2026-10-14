import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";

export const CANONICAL_PHONE_NUMBER_ID = "1167458436461085";
export const LEGACY_PHONE_NUMBER_ID = "993172873887528";

export async function GET() {
  try {
    await requireRole("agent");
    const db = supabaseAdmin();

    const [waConfigRes, runtimeConfigRes] = await Promise.all([
      db.from("whatsapp_config").select("phone_number_id, phone_number, account_id").maybeSingle(),
      db.from("itechskill_runtime_config").select("allowed_sender_ids, ai_enabled").eq("id", true).maybeSingle(),
    ]);

    const activeDbSender = waConfigRes.data?.phone_number_id || CANONICAL_PHONE_NUMBER_ID;
    const allowedSenders: string[] = runtimeConfigRes.data?.allowed_sender_ids || [];

    // All components must agree strictly on the canonical sender ID and legacy ID must not be active
    const isReconciled =
      activeDbSender === CANONICAL_PHONE_NUMBER_ID &&
      allowedSenders.includes(CANONICAL_PHONE_NUMBER_ID) &&
      !allowedSenders.includes(LEGACY_PHONE_NUMBER_ID);

    return NextResponse.json({
      canonicalSenderId: CANONICAL_PHONE_NUMBER_ID,
      legacySenderId: LEGACY_PHONE_NUMBER_ID,
      activeDbSender,
      allowedSenders,
      isReconciled,
      aiEnabled: Boolean(runtimeConfigRes.data?.ai_enabled),
      verifiedPhoneNumber: waConfigRes.data?.phone_number || "+92 300 1234567",
      blockingReason: !isReconciled
        ? "Outbound automations are blocked until sender IDs are reconciled to the single verified Phone Number ID (1167458436461085)."
        : null,
    });
  } catch (err) {
    console.error("[sender-reconciliation GET] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireRole("admin");
    const db = supabaseAdmin();
    const nowIso = new Date().toISOString();

    // 1. Update runtime config to lock allowed_sender_ids strictly to canonical ID
    await db
      .from("itechskill_runtime_config")
      .update({
        allowed_sender_ids: [CANONICAL_PHONE_NUMBER_ID],
        updated_at: nowIso,
      })
      .eq("id", true);

    // 2. Ensure whatsapp_config has canonical phone_number_id
    await db
      .from("whatsapp_config")
      .update({
        phone_number_id: CANONICAL_PHONE_NUMBER_ID,
        updated_at: nowIso,
      })
      .neq("phone_number_id", CANONICAL_PHONE_NUMBER_ID);

    return NextResponse.json({
      success: true,
      message: `Sender successfully reconciled and locked to verified ID: ${CANONICAL_PHONE_NUMBER_ID}`,
      reconciledSenderId: CANONICAL_PHONE_NUMBER_ID,
      deprecatedSenderId: LEGACY_PHONE_NUMBER_ID,
      timestamp: nowIso,
    });
  } catch (err) {
    console.error("[sender-reconciliation POST] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
