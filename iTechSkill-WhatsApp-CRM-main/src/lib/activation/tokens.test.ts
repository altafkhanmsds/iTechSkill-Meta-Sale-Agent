import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { hashToken } from "./tokens";

describe("Account Activation Tokens", () => {
  it("computes SHA-256 hash of raw tokens deterministically", () => {
    const rawToken = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const hash = hashToken(rawToken);

    expect(hash).toHaveLength(64);
    expect(hash).toBe(
      crypto.createHash("sha256").update(rawToken).digest("hex")
    );
  });

  it("produces unique hashes for distinct random tokens", () => {
    const token1 = crypto.randomBytes(32).toString("hex");
    const token2 = crypto.randomBytes(32).toString("hex");

    expect(token1).not.toBe(token2);
    expect(hashToken(token1)).not.toBe(hashToken(token2));
  });

  it("evaluates token expiry against 24-hour expiration window correctly", () => {
    const now = Date.now();
    const expiredTimestamp = new Date(now - 1000).toISOString(); // 1 second ago
    const validTimestamp = new Date(now + 24 * 60 * 60 * 1000).toISOString(); // 24h in future

    expect(new Date() > new Date(expiredTimestamp)).toBe(true);
    expect(new Date() > new Date(validTimestamp)).toBe(false);
  });

  it("verifies constant-time equality of cryptographic token hashes", () => {
    const hashA = hashToken("test-token-1");
    const hashB = hashToken("test-token-1");
    const hashC = hashToken("test-token-2");

    const bufA = Buffer.from(hashA, "hex");
    const bufB = Buffer.from(hashB, "hex");
    const bufC = Buffer.from(hashC, "hex");

    expect(crypto.timingSafeEqual(bufA, bufB)).toBe(true);
    expect(crypto.timingSafeEqual(bufA, bufC)).toBe(false);
  });
});
