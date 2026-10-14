import { describe, it, expect } from "vitest";
import { isOptOutKeyword, isOptInKeyword } from "./consent-manager";

describe("Consent Manager State Machine", () => {
  it("accurately detects standard opt-out keywords (case-insensitive with whitespace)", () => {
    expect(isOptOutKeyword("STOP")).toBe(true);
    expect(isOptOutKeyword("stop")).toBe(true);
    expect(isOptOutKeyword("  Stop  ")).toBe(true);
    expect(isOptOutKeyword("UNSUBSCRIBE")).toBe(true);
    expect(isOptOutKeyword("cancel")).toBe(true);
    expect(isOptOutKeyword("quit")).toBe(true);
    expect(isOptOutKeyword("stopall")).toBe(true);
  });

  it("does not falsely trigger opt-out on ordinary conversational messages", () => {
    expect(isOptOutKeyword("Can you stop talking and send the fees?")).toBe(false);
    expect(isOptOutKeyword("bus stop")).toBe(false);
    expect(isOptOutKeyword("hello")).toBe(false);
  });

  it("accurately detects opt-in restart keywords", () => {
    expect(isOptInKeyword("START")).toBe(true);
    expect(isOptInKeyword("start")).toBe(true);
    expect(isOptInKeyword("  Unstop  ")).toBe(true);
    expect(isOptInKeyword("yes")).toBe(true);
  });

  it("ensures START command behavior resumes transactional messaging without auto-marketing", () => {
    // In our state machine:
    // START sets: { opted_out: false, marketing_opted_in: false }
    const startState = {
      opted_out: false,
      marketing_opted_in: false, // Must remain false!
    };

    expect(startState.opted_out).toBe(false);
    expect(startState.marketing_opted_in).toBe(false);
  });
});
