import crypto from "crypto";
import { supabaseAdmin } from "@/lib/flows/admin-client";

export interface CreateActivationTokenResult {
  rawToken: string;
  tokenHash: string;
  activationUrl: string;
  expiresAt: string;
}

export interface VerifyTokenResult {
  valid: boolean;
  record?: {
    id: string;
    phone: string;
    application_id?: string;
    account_id?: string;
    expires_at: string;
    used_at?: string | null;
  };
  error?: string;
}

/**
 * Computes SHA-256 hash of a raw token.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Generates a 24-hour cryptographically secure activation token,
 * stores the SHA-256 hash in itechskill_account_activation_tokens,
 * and formats the activation URL pointing to the configured LMS origin.
 */
export async function createActivationToken(params: {
  phone: string;
  applicationId?: string;
  accountId?: string;
}): Promise<CreateActivationTokenResult> {
  const db = supabaseAdmin();
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours window

  // Resolve LMS origin from itechskill_runtime_config
  let lmsOrigin = process.env.LMS_ORIGIN || "https://itechskill.com";
  try {
    const { data: runtimeConfig } = await db
      .from("itechskill_runtime_config")
      .select("lms_origin")
      .eq("id", true)
      .maybeSingle();

    if (runtimeConfig?.lms_origin) {
      lmsOrigin = String(runtimeConfig.lms_origin).trim().replace(/\/+$/, "");
    }
  } catch (err) {
    console.warn("[activation] could not read runtime_config lms_origin, using fallback:", err);
  }

  // Insert token hash into database
  const { error: insertErr } = await db
    .from("itechskill_account_activation_tokens")
    .insert({
      phone: params.phone,
      token_hash: tokenHash,
      application_id: params.applicationId || null,
      account_id: params.accountId || null,
      expires_at: expiresAt,
      created_at: now.toISOString(),
    });

  if (insertErr) {
    throw new Error(`Failed to store activation token hash: ${insertErr.message}`);
  }

  const activationUrl = `${lmsOrigin}/activate?token=${rawToken}&phone=${encodeURIComponent(params.phone)}`;

  // Also sync to existing itechskill_account_activation_v2 for n8n queue compatibility if present
  try {
    await db.from("itechskill_account_activation_v2").upsert(
      {
        phone: params.phone,
        application_id: params.applicationId || null,
        status: "pending",
        activation_url: activationUrl,
        created_at: now.toISOString(),
      },
      { onConflict: "application_id" }
    );
  } catch (syncErr) {
    console.warn("[activation] non-fatal sync to itechskill_account_activation_v2:", syncErr);
  }

  return {
    rawToken,
    tokenHash,
    activationUrl,
    expiresAt,
  };
}

/**
 * Verifies an activation token in constant time against stored SHA-256 hashes.
 */
export async function verifyActivationToken(rawToken: string): Promise<VerifyTokenResult> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim() === "") {
    return { valid: false, error: "Missing or invalid token" };
  }

  const db = supabaseAdmin();
  const suppliedHash = hashToken(rawToken.trim());

  const { data: record, error: fetchErr } = await db
    .from("itechskill_account_activation_tokens")
    .select("id, phone, token_hash, application_id, account_id, expires_at, used_at")
    .eq("token_hash", suppliedHash)
    .maybeSingle();

  if (fetchErr || !record) {
    return { valid: false, error: "Invalid activation token" };
  }

  // Constant-time comparison of token hashes to guard against timing side-channels
  const recordBuf = Buffer.from(record.token_hash, "hex");
  const suppliedBuf = Buffer.from(suppliedHash, "hex");
  if (recordBuf.length !== suppliedBuf.length || !crypto.timingSafeEqual(recordBuf, suppliedBuf)) {
    return { valid: false, error: "Invalid activation token" };
  }

  // Check if token has already been used
  if (record.used_at) {
    return { valid: false, error: "This activation token has already been used." };
  }

  // Check if token has expired
  const now = new Date();
  const expiresAt = new Date(record.expires_at);
  if (now > expiresAt) {
    return { valid: false, error: "This activation token has expired. Please request a new link." };
  }

  return {
    valid: true,
    record,
  };
}

/**
 * Consumes an activation token (single use) and marks student account active.
 */
export async function consumeActivationToken(params: {
  tokenId: string;
  passwordHash: string;
  applicationId?: string;
  phone?: string;
}): Promise<void> {
  const db = supabaseAdmin();
  const nowIso = new Date().toISOString();

  // 1. Mark token consumed
  const { error: updateTokenErr } = await db
    .from("itechskill_account_activation_tokens")
    .update({
      used_at: nowIso,
      redeemed_at: nowIso,
    })
    .eq("id", params.tokenId)
    .is("used_at", null);

  if (updateTokenErr) {
    throw new Error(`Failed to consume activation token: ${updateTokenErr.message}`);
  }

  // 2. If applicationId present, update enrollment application account_status to 'active'
  if (params.applicationId) {
    await db
      .from("itechskill_enrollment_applications")
      .update({
        account_status: "active",
        updated_at: nowIso,
      })
      .eq("application_id", params.applicationId);
  }

  // 3. Keep existing itechskill_account_activation_v2 in sync if present
  try {
    if (params.applicationId) {
      await db
        .from("itechskill_account_activation_v2")
        .update({
          status: "completed",
          updated_at: nowIso,
        })
        .eq("application_id", params.applicationId);
    } else if (params.phone) {
      await db
        .from("itechskill_account_activation_v2")
        .update({
          status: "completed",
          updated_at: nowIso,
        })
        .eq("phone", params.phone);
    }
  } catch (syncErr) {
    console.warn("[activation] non-fatal consume sync to itechskill_account_activation_v2:", syncErr);
  }
}
