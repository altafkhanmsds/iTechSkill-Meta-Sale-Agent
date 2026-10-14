import { describe, it, expect } from "vitest";
import { evaluateRoutingPrecedence } from "./routing-precedence";

describe("Routing Precedence & Multilingual Evaluation", () => {
  it("routes explicit human intent before catalog keywords in English", () => {
    const query = "I want to talk to a human advisor about the Python course fees";
    const result = evaluateRoutingPrecedence(query);

    expect(result.intent).toBe("human_advisor");
    expect(result.requiresHandoff).toBe(true);
    expect(result.detectedLanguage).toBe("en");
  });

  it("routes Roman Urdu human agent requests before course keywords", () => {
    const query1 = "mujhe kisi insaan ya representative se baat karni hai graphic design k baray me";
    const result1 = evaluateRoutingPrecedence(query1);

    expect(result1.intent).toBe("human_advisor");
    expect(result1.requiresHandoff).toBe(true);
    expect(result1.detectedLanguage).toBe("roman_urdu");

    const query2 = "kisi agent se connect karwa dain please";
    const result2 = evaluateRoutingPrecedence(query2);

    expect(result2.intent).toBe("human_advisor");
    expect(result2.requiresHandoff).toBe(true);
    expect(result2.detectedLanguage).toBe("roman_urdu");
  });

  it("routes Urdu script human agent requests accurately", () => {
    const query = "مجھے کسی نمائندے سے بات کرنی ہے کورس کی فیس کے بارے میں";
    const result = evaluateRoutingPrecedence(query);

    expect(result.intent).toBe("human_advisor");
    expect(result.requiresHandoff).toBe(true);
    expect(result.detectedLanguage).toBe("ur");
  });

  it("routes pure course inquiries to AI automated catalog advisor", () => {
    const queryEn = "What is the fee and duration for the AI diploma?";
    const resultEn = evaluateRoutingPrecedence(queryEn);

    expect(resultEn.intent).toBe("course_catalog");
    expect(resultEn.requiresHandoff).toBe(false);

    const queryRomanUrdu = "graphic designing diploma ki classes kab se shuru hain aur fee kitni hai?";
    const resultRomanUrdu = evaluateRoutingPrecedence(queryRomanUrdu);

    expect(resultRomanUrdu.intent).toBe("course_catalog");
    expect(resultRomanUrdu.requiresHandoff).toBe(false);
  });
});
