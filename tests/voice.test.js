import { describe, expect, it } from "vitest";
import { failureVoice, verdictVoice } from "../public/voice.js";

describe("verdict voice", () => {
  it("gives every server classification its own order and label", () => {
    const voices = ["likely_human", "suspicious", "likely_bot"].map(verdictVoice);

    expect(new Set(voices.map((voice) => voice.label)).size).toBe(3);
    for (const voice of voices) {
      expect(voice.title).toMatch(/\.$/);
      expect(voice.figure.src).toMatch(/^\/assets\/brand\//);
      expect(voice.figure.alt.length).toBeGreaterThan(0);
    }
  });

  it("shows the bot figure only for a bot verdict", () => {
    expect(verdictVoice("likely_bot").figure.src).toContain("robo-recruit");
    expect(verdictVoice("likely_human").figure.src).not.toContain("robo-recruit");
    expect(verdictVoice("suspicious").figure.src).not.toContain("robo-recruit");
  });

  it("falls back to the pending order for an unknown classification", () => {
    expect(verdictVoice(undefined)).toEqual(verdictVoice("pending"));
    expect(verdictVoice("something_new").label).toBe("Inspecting");
  });

  it("turns a failure into an order to act", () => {
    const voice = failureVoice("Network error.");

    expect(voice.label).toBe("Failed");
    expect(voice.line).toBe("Network error. Run the inspection again.");
  });

  it("never uses an em dash", () => {
    const all = ["pending", "likely_human", "suspicious", "likely_bot"].map(verdictVoice);
    for (const voice of [...all, failureVoice("x")]) {
      expect(`${voice.title} ${voice.line} ${voice.figure.alt}`).not.toContain("\u2014");
    }
  });
});
