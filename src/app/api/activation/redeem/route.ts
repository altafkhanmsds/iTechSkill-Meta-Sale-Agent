import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  verifyActivationToken,
  consumeActivationToken,
} from "@/lib/activation/tokens";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    const password = String(body.password || "").trim();

    if (!token) {
      return NextResponse.json(
        { error: "Activation token is required" },
        { status: 400 }
      );
    }

    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 }
      );
    }

    // 1. Verify token validity (24h window, single use, constant time hash check)
    const verification = await verifyActivationToken(token);
    if (!verification.valid || !verification.record) {
      return NextResponse.json(
        { error: verification.error || "Invalid or expired activation link" },
        { status: 400 }
      );
    }

    // 2. Hash password securely (SHA-256 salted hash)
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;

    // 3. Mark token consumed (atomic single-use guard)
    await consumeActivationToken({
      tokenId: verification.record.id,
      passwordHash,
      applicationId: verification.record.application_id,
      phone: verification.record.phone,
    });

    return NextResponse.json({
      success: true,
      message: "Account successfully activated! You can now log in to the LMS portal.",
      phone: verification.record.phone,
    });
  } catch (err) {
    console.error("[activation/redeem] error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to activate account",
      },
      { status: 500 }
    );
  }
}
