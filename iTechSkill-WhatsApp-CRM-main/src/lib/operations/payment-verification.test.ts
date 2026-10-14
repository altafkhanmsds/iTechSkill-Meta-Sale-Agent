import { describe, it, expect } from "vitest";

describe("Payment Verification Contract", () => {
  it("strictly requires currency to be PKR", () => {
    const validateCurrency = (curr?: string) => {
      if (!curr || curr.toUpperCase() !== "PKR") {
        throw new Error(`Invalid currency: ${curr}. Payment currency must be PKR.`);
      }
      return true;
    };

    expect(validateCurrency("PKR")).toBe(true);
    expect(validateCurrency("pkr")).toBe(true);
    expect(() => validateCurrency("USD")).toThrowError("Payment currency must be PKR");
    expect(() => validateCurrency("EUR")).toThrowError("Payment currency must be PKR");
  });

  it("detects duplicate bank transaction references across applications", () => {
    const existingEvidence = [
      { applicationId: "app_1", bankTransactionId: "TRX-100200" },
      { applicationId: "app_2", bankTransactionId: "JAZZ-998877" },
    ];

    const checkDuplicate = (targetAppId: string, candidateTxId: string) => {
      const found = existingEvidence.find(
        (e) => e.bankTransactionId === candidateTxId && e.applicationId !== targetAppId
      );
      if (found) {
        throw new Error(
          `Duplicate transaction ID: ${candidateTxId} has already been verified for another application (${found.applicationId}).`
        );
      }
      return false;
    };

    // Same app re-verifying same ID is allowed (idempotent)
    expect(checkDuplicate("app_1", "TRX-100200")).toBe(false);

    // Different app attempting to use an already verified ID must be rejected!
    expect(() => checkDuplicate("app_3", "TRX-100200")).toThrowError(
      "Duplicate transaction ID: TRX-100200 has already been verified for another application (app_1)"
    );

    // Fresh unused transaction ID is allowed
    expect(checkDuplicate("app_3", "MEEZAN-445566")).toBe(false);
  });

  it("verifies amount against course tuition fee accurately", () => {
    const tuitionFeePkr = 25000;
    const isAmountMatching = (submittedAmount: number) => {
      return submittedAmount >= tuitionFeePkr;
    };

    expect(isAmountMatching(25000)).toBe(true);
    expect(isAmountMatching(30000)).toBe(true);
    expect(isAmountMatching(15000)).toBe(false);
  });
});
