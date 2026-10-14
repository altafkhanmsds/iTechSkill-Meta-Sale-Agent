import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getMediaUrl, downloadMedia } from "@/lib/whatsapp/meta-api";
import { decrypt } from "@/lib/whatsapp/encryption";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/gif",
  "application/pdf",
]);

export async function GET(request: Request) {
  try {
    // 1. Authorize: agent, admissions staff, or admin required
    await requireRole("agent");

    const url = new URL(request.url);
    let mediaId = url.searchParams.get("mediaId");
    const appId = url.searchParams.get("appId");

    const db = supabaseAdmin();

    // 2. If mediaId is missing but appId is provided, look up from application
    if (!mediaId && appId) {
      const { data: app } = await db
        .from("itechskill_enrollment_applications")
        .select("payment_screenshot_media_id, receipt_url")
        .eq("application_id", appId)
        .maybeSingle();

      if (app?.payment_screenshot_media_id) {
        mediaId = app.payment_screenshot_media_id;
      }
    }

    if (!mediaId) {
      return NextResponse.json(
        { error: "Valid WhatsApp media ID is required for secure preview" },
        { status: 400 }
      );
    }

    // Strictly validate mediaId format (digits or alphanumeric string from Meta)
    if (!/^[a-zA-Z0-9_-]+$/.test(mediaId)) {
      return NextResponse.json(
        { error: "Invalid media ID format" },
        { status: 400 }
      );
    }

    // 3. Fetch WhatsApp configuration to get decrypted token
    const { data: config, error: configErr } = await db
      .from("whatsapp_config")
      .select("access_token")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (configErr || !config?.access_token) {
      return NextResponse.json(
        { error: "WhatsApp provider configuration not found" },
        { status: 500 }
      );
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
    } catch {
      accessToken = config.access_token;
    }

    // 4. Resolve media URL securely from Meta Graph API
    const mediaInfo = await getMediaUrl({ mediaId, accessToken });
    const mimeType = (mediaInfo.mimeType || "").toLowerCase();

    // 5. Strict MIME type verification (no executable or script content)
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        {
          error: "Unsupported media type for receipt preview",
          detected_type: mimeType,
        },
        { status: 415 }
      );
    }

    // 6. Download binary stream securely
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    });

    const finalContentType = contentType || mimeType || "application/octet-stream";

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": finalContentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (err) {
    console.error("[receipt-preview] error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to load payment receipt preview",
      },
      { status: 500 }
    );
  }
}
