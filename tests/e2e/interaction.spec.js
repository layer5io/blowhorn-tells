import { expect, test } from "@playwright/test";
import { INTERACTION_CHECK_IDS } from "../../public/interaction-checks.js";
import {
  cdpClick,
  createCdpDriver,
  createHumanDriver,
  createPlaywrightDriver,
  createSyntheticDriver,
  openDrill,
  TARGET
} from "./support/interaction-drivers.js";

// Tall enough that the Start, phrase and Submit controls are all on screen at once.
test.use({ viewport: { width: 1280, height: 900 } });

const SHORT = (id) => id.replace(/^int_/, "");
const CODE = { pass: "P", warn: "W", fail: "F", na: "-" };
// Each run prints its own line as it finishes, so one failing run does not hide the others.
let headerPrinted = false;

function printRow(row) {
  if (!headerPrinted) {
    headerPrinted = true;
    console.log(["", "Raw interaction statuses (P pass, W warn, F fail, - not judged)", ["run", ...INTERACTION_CHECK_IDS.map(SHORT)].join("  ")].join("\n"));
  }
  console.log([row.family, ...INTERACTION_CHECK_IDS.map((id) => CODE[row.statuses[id]] || "?")].join("  "));
  for (const click of row.interaction?.click?.clicks || []) {
    console.log(`    ${click.target}: trusted ${click.isTrusted}, pointer "${click.pointerType}", detail ${click.detail}, ` +
      `press ${click.pressMs ?? "-"} ms, premove ${click.premoveSamples ?? "-"} samples ${click.premovePathPx ?? "-"} px, ` +
      `coalesced ${click.coalescedMin ?? "-"}, off centre (${click.offsetFromCentre.dx}, ${click.offsetFromCentre.dy})`);
  }
}

// Opens the drill, arms the completion listener, runs the driver, and reads back what the page
// and the Worker saw. The Worker's response is the one that carries the completed report.
async function runFamily(page, family, drive) {
  await openDrill(page);
  const reported = page.waitForResponse((response) => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/report")) return false;
    return (response.request().postData() || "").includes('"completed":true');
  }, { timeout: 30_000 });

  await drive();

  const response = await reported;
  const body = await response.json();
  const interaction = await page.evaluate(() => window.__tellsInteraction);
  const statuses = Object.fromEntries((interaction?.checks || []).map((check) => [check.id, check.status]));
  const reasons = (body.verdict?.reasons || []).filter((reason) => reason.id.startsWith("int_"));
  const row = { family, statuses, reasons, interaction, score: body.verdict?.score };
  printRow(row);
  return row;
}

const failed = (row) => INTERACTION_CHECK_IDS.filter((id) => row.statuses[id] === "fail");

function expectWorkerAgreesWithPage(row) {
  const expected = [];
  for (const id of INTERACTION_CHECK_IDS) {
    const status = row.statuses[id];
    if (status === "fail") expected.push([id, "medium"]);
    if (status === "warn") expected.push([id, "low"]);
  }
  const actual = row.reasons.map((reason) => [reason.id, reason.severity]);
  expect(actual.sort()).toEqual(expected.sort());
  for (const reason of row.reasons) expect(reason.severity).not.toBe("high");
}

test("human-like input is not failed by any raw check", async ({ page }) => {
  test.setTimeout(90_000);
  const row = await runFamily(page, "a human-like", () => createHumanDriver(page).run());
  expect(row.interaction.task.completed).toBe(true);
  expect(failed(row)).toEqual([]);
  expectWorkerAgreesWithPage(row);
});

test("Playwright API clicks and fill are caught by the press, centre and key checks", async ({ page }) => {
  const row = await runFamily(page, "playwright api", () => createPlaywrightDriver(page).run());
  expect(row.interaction.task.completed).toBe(true);
  // Playwright aims at the exact centre, so every click is within 1 px: warn, or fail when within 0.5 px.
  expect(["warn", "fail"]).toContain(row.statuses.int_centre);
  expect(row.statuses.int_press).toBe("fail");
  expect(row.statuses.int_key_chain).toBe("fail");
  expectWorkerAgreesWithPage(row);
});

test("raw CDP mouse events (no moves) and insertText are caught", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  const row = await runFamily(page, "raw cdp", () => createCdpDriver(page, cdp).run());
  expect(row.interaction.task.completed).toBe(true);
  // Chromium synthesizes one pointer move to the press point, so the raw press has 1 sample, not 0: a warn.
  expect(["warn", "fail"]).toContain(row.statuses.int_premove);
  // Presses here last 10 to 30 ms (CDP round trips), the warn band; Playwright's own clicks are under 10 ms.
  expect(["warn", "fail"]).toContain(row.statuses.int_press);
  expect(row.statuses.int_key_chain).toBe("fail");
  expectWorkerAgreesWithPage(row);
});

test("a CDP press with clickCount 0 fires no click, so it starts nothing", async ({ page, context }) => {
  await openDrill(page);
  const cdp = await context.newCDPSession(page);
  await cdpClick(page, cdp, TARGET.start, 0);
  const state = await page.evaluate(() => ({
    status: document.querySelector("#challengeStatus").textContent,
    scored: window.__tellsInteraction === undefined
  }));
  expect(state).toEqual({ status: "Press Start to begin.", scored: true });
});

test("script-made clicks, keys and value assignment fail trust and value source", async ({ page }) => {
  const row = await runFamily(page, "synthetic", () => createSyntheticDriver(page).run());
  expect(row.interaction.task.completed).toBe(true);
  expect(row.statuses.int_trusted).toBe("fail");
  expect(row.statuses.int_value_source).toBe("fail");
  expect(row.statuses.int_click_chain).toBe("fail");
  expectWorkerAgreesWithPage(row);
});
