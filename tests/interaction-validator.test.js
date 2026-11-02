import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildValidatorSource } from "../scripts/build-validators.mjs";
import { validateInteractionReport } from "../public/generated/validate-interaction-report.js";
import { buildInteractionReport } from "../public/collect-interaction.js";
import { humanLike, scriptedElementClick, cdpInsertText } from "./fixtures/interaction-events.js";

const committed = readFileSync(new URL("../public/generated/validate-interaction-report.js", import.meta.url), "utf8");
const validReport = () => buildInteractionReport(humanLike().events, humanLike().task);

describe("interaction report validator", () => {
  it("regenerates byte-identical output, so the committed validator is the schema's", () => {
    expect(buildValidatorSource()).toBe(committed);
  });

  it("accepts the reports the page produces", () => {
    for (const fixture of [humanLike(), scriptedElementClick(), cdpInsertText()]) {
      const report = buildInteractionReport(fixture.events, fixture.task);
      expect(validateInteractionReport(report), JSON.stringify(validateInteractionReport.errors)).toBe(true);
    }
  });

  it("rejects a raw event stream or any extra field, so key values and coordinates cannot ride along", () => {
    expect(validateInteractionReport({ ...validReport(), events: [] })).toBe(false);
    const withKey = validReport();
    withKey.click.clicks[0].key = "t";
    expect(validateInteractionReport(withKey)).toBe(false);
    const withCoordinates = validReport();
    withCoordinates.click.clicks[0].clientX = 120;
    expect(validateInteractionReport(withCoordinates)).toBe(false);
  });

  it("rejects an unknown check id, an unknown status, a negative duration and another schema version", () => {
    const badId = validReport();
    badId.checks[0].id = "trusted";
    expect(validateInteractionReport(badId)).toBe(false);

    const badStatus = validReport();
    badStatus.checks[0].status = "skip";
    expect(validateInteractionReport(badStatus)).toBe(false);

    const negative = validReport();
    negative.task.durationMs = -1;
    expect(validateInteractionReport(negative)).toBe(false);

    expect(validateInteractionReport({ ...validReport(), schemaVersion: 2 })).toBe(false);
  });

  it("rejects a missing section", () => {
    const { typing, ...rest } = validReport();
    expect(validateInteractionReport(rest)).toBe(false);
    expect(validateInteractionReport(null)).toBe(false);
  });
});
