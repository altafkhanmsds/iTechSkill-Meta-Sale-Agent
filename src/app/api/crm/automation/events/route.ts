import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  processAutomationEvent,
  AutomationEventPayload,
} from "@/lib/automation/event-handler";

function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function verifySecret(request: Request): { valid: boolean; status?: number; error?: string } {
  const isTest = process.env.NODE_ENV === "test";
  const configuredSecrets = [
    process.env.AUTOMATION_SECRET,
    process.env.N8N_CRM_WEBHOOK_SECRET,
    process.env.CRM_API_SECRET,
    process.env.AUTOMATION_CRON_SECRET,
    process.env.CRON_SECRET,
  ].filter((s): s is string => Boolean(s && s.trim().length > 0));

  // Strict fail-closed policy: reject when secrets are missing
  if (configuredSecrets.length === 0) {
    return {
      valid: false,
      status: isTest ? 401 : 500,
      error: "Server configuration error: Required automation secret is not configured",
    };
  }

  const suppliedSecret = request.headers.get("x-itechskill-crm-secret") || "";
  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!suppliedSecret && !bearerToken) {
    return {
      valid: false,
      status: 401,
      error: "Unauthorized: Missing authentication secret or bearer token",
    };
  }

  for (const secret of configuredSecrets) {
    if (suppliedSecret && constantTimeEqual(suppliedSecret, secret)) {
      return { valid: true };
    }
    if (bearerToken && constantTimeEqual(bearerToken, secret)) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    status: 401,
    error: "Unauthorized: Invalid secret",
  };
}

async function resolveTenantId(
  request: Request,
  payloadPhoneNumberId?: string
): Promise<string | null> {
  const headerTenant =
    request.headers.get("x-itechskill-crm-tenant") ||
    request.headers.get("x-tenant-id");
  if (headerTenant) return headerTenant;

  const db = supabaseAdmin();
  const { data: configs } = await db
    .from("whatsapp_config")
    .select("account_id, phone_number_id");

  if (configs && configs.length > 0) {
    if (payloadPhoneNumberId) {
      const matched = configs.find(
        (c: { phone_number_id: string }) =>
          String(c.phone_number_id).trim() === String(payloadPhoneNumberId).trim()
      );
      if (matched) return matched.account_id;
    }
    return configs[0].account_id;
  }

  // Fallback to accounts table
  const { data: accounts } = await db.from("accounts").select("id").limit(1);
  if (accounts && accounts.length > 0) {
    return accounts[0].id;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    // 1. Authentication check (fail-closed)
    const authCheck = verifySecret(request);
    if (!authCheck.valid) {
      return NextResponse.json(
        { error: authCheck.error || "Unauthorized: Invalid or missing secret" },
        { status: authCheck.status || 401 }
      );
    }

    // 2. Parse request payload
    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return NextResponse.json(
        { error: "Bad Request: Could not read request body" },
        { status: 400 }
      );
    }

    if (!rawBody || rawBody.trim() === "") {
      return NextResponse.json(
        { error: "Bad Request: Empty request body" },
        { status: 400 }
      );
    }

    let payload: AutomationEventPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Bad Request: Invalid JSON body" },
        { status: 400 }
      );
    }

    // 3. Extract Idempotency Key
    const payloadRecord = payload as unknown as Record<string, unknown>;
    const idempotencyKey =
      request.headers.get("Idempotency-Key") ||
      request.headers.get("idempotency-key") ||
      request.headers.get("x-idempotency-key") ||
      (typeof payloadRecord.idempotency_key === "string" ? payloadRecord.idempotency_key : undefined) ||
      (typeof payloadRecord.event_id === "string" ? payloadRecord.event_id : undefined);

    if (!idempotencyKey || String(idempotencyKey).trim() === "") {
      return NextResponse.json(
        {
          error:
            "Missing required Idempotency-Key header or event_id in payload",
        },
        { status: 400 }
      );
    }

    // 4. Resolve tenant (optional in single-tenant deployments)
    const tenantId = await resolveTenantId(request, payload.phone_number_id);

    // 5. Process through idempotent event engine
    const result = await processAutomationEvent({
      tenantId: tenantId || undefined,
      idempotencyKey: String(idempotencyKey).trim(),
      payload,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[api/crm/automation/events] error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
