// Three ways to drive the interaction test, used only by tests/e2e/interaction.spec.js.
// ghost-cursor is a test-only dependency: it supplies human-like mouse paths and is never
// imported by public/ or src/.

import { expect } from "@playwright/test";
import { path as humanPath } from "ghost-cursor";
import { INTERACTION_PHRASE as PHRASE } from "../../../public/collect-interaction.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (min, max) => min + Math.random() * (max - min);

export const TARGET = {
  start: '[data-tells-target="start"]',
  phrase: '[data-tells-target="phrase"]',
  submit: '[data-tells-target="submit"]'
};

// The first report renders a checks table above the drill. Wait for it to finish, so the
// drill's positions do not move under a driver that is already aiming at them.
export async function openDrill(page) {
  const firstReport = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/report"));
  await page.goto("/");
  await firstReport;
  await expect(page.locator("#runBtn")).toBeEnabled();
  await page.locator("#panel-challenge > summary").click();
  await page.locator(TARGET.start).waitFor({ state: "visible" });
}

// A: human-like. ghost-cursor paths with overshoot and a random point inside each button,
// then a press held for a human length, then keys with jittered dwell and interval.
export function createHumanDriver(page) {
  let cursor = { x: 40, y: 40 };

  async function moveAndPress(selector) {
    // A hand scrolls to a control before reaching for it; the box is read after that scroll.
    await page.locator(selector).scrollIntoViewIfNeeded();
    const box = await page.locator(selector).boundingBox();
    const target = {
      x: box.x + between(0.2, 0.8) * box.width,
      y: box.y + between(0.2, 0.8) * box.height
    };
    const size = { width: box.width, height: box.height };
    // Overshoot past the target, then correct back onto it, as a hand does.
    const direction = Math.random() < 0.5 ? 1 : -1;
    const overshoot = { x: target.x + direction * between(18, 36), y: target.y + between(-8, 8) };
    await walk(cursor, { ...overshoot, ...size });
    await walk(overshoot, { ...target, ...size });
    await page.mouse.down();
    await sleep(between(70, 130));
    await page.mouse.up();
  }

  async function walk(from, to) {
    const points = humanPath(from, to);
    for (const point of points) {
      await page.mouse.move(point.x, point.y);
      await sleep(between(6, 14));
    }
    cursor = { x: to.x, y: to.y };
  }

  async function typePhrase(text) {
    for (const char of text) {
      const key = char === " " ? "Space" : char;
      await page.keyboard.down(key);
      await sleep(between(60, 140));
      await page.keyboard.up(key);
      await sleep(between(60, 260));
    }
  }

  return {
    async run() {
      await moveAndPress(TARGET.start);
      await moveAndPress(TARGET.phrase);
      await typePhrase(PHRASE);
      await moveAndPress(TARGET.submit);
    }
  };
}

// B: raw automation through Playwright's own API (click, fill) and a plain CDP session
// (mouse events with no moves and clickCount 0, insertText).
export function createPlaywrightDriver(page) {
  return {
    async run() {
      await page.click(TARGET.start);
      await page.fill(TARGET.phrase, PHRASE);
      await page.click(TARGET.submit);
    }
  };
}

// Presses at the exact centre with no mouseMoved first, as a raw CDP tool sends them.
// clickCount is 1: Chromium fires no click event at all for clickCount 0 (see the
// clickCount test in interaction.spec.js), so a clickCount 0 run cannot complete the task.
export function createCdpDriver(page, cdp) {
  return {
    async run() {
      await cdpClick(page, cdp, TARGET.start);
      await cdpClick(page, cdp, TARGET.phrase);
      await cdp.send("Input.insertText", { text: PHRASE });
      await cdpClick(page, cdp, TARGET.submit);
    }
  };
}

export async function cdpClick(page, cdp, selector, clickCount = 1) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = await page.locator(selector).boundingBox();
  const base = { x: box.x + box.width / 2, y: box.y + box.height / 2, button: "left", clickCount };
  await cdp.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
  await cdp.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
}

// C: synthetic. Script-made clicks, key events and a value assignment.
export function createSyntheticDriver(page) {
  return {
    async run() {
      await page.evaluate((phrase) => {
        const start = document.querySelector('[data-tells-target="start"]');
        const field = document.querySelector('[data-tells-target="phrase"]');
        const submit = document.querySelector('[data-tells-target="submit"]');
        start.click();
        for (const char of phrase) {
          field.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
          field.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
        }
        field.value = phrase;
        submit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
      }, PHRASE);
    }
  };
}
