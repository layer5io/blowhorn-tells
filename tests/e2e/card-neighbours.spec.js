import { expect, test } from "@playwright/test";
import { stubSharedCards } from "./support/cards.js";

// No two cards that sit next to each other share a variant (the blowhorn.ai DESIGN.md, "Cards"). Neighbours come
// from the rendered layout, not the markup: a card's neighbour below is the nearest card under it
// that overlaps it horizontally, its neighbour to the right the nearest card beside it that
// overlaps it vertically. Cards nested in one another are not neighbours.

const PAGES = ["/checks/", "/checks/browser-data/", "/checks/interaction/", "/checks/platforms/", "/agents/"];
const WIDTHS = [320, 820, 1280];

test.beforeEach(async ({ page }) => stubSharedCards(page));

function cardNeighbours() {
  const VARIANTS = ["card-paper", "card-dispatch", "card-stamp", "card-field", "card-plain", "card-glass"];
  const cards = [...document.querySelectorAll(VARIANTS.map((variant) => `.${variant}`).join(","))]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")
    .map((el) => {
      const r = el.getBoundingClientRect();
      const name = el.id || el.querySelector("h1, h2, h3, summary span:not(.summary-icon), .label")?.textContent.trim() || el.className;
      return { el, name: name.slice(0, 40), variant: VARIANTS.find((variant) => el.classList.contains(variant)), top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right };
    });
  const related = (a, b) => a.el.contains(b.el) || b.el.contains(a.el);
  const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 1;
  const nearest = (from, candidates, distance) => {
    if (!candidates.length) return [];
    const best = Math.min(...candidates.map(distance));
    return candidates.filter((card) => distance(card) - best <= 1);
  };
  const pairs = [];
  for (const card of cards) {
    const others = cards.filter((other) => other !== card && !related(card, other));
    const below = others.filter((other) => other.top >= card.bottom - 1 && overlap(card.left, card.right, other.left, other.right));
    const right = others.filter((other) => other.left >= card.right - 1 && overlap(card.top, card.bottom, other.top, other.bottom));
    for (const other of nearest(card, below, (c) => c.top)) pairs.push({ side: "below", a: `${card.name} (${card.variant})`, b: `${other.name} (${other.variant})`, same: card.variant === other.variant });
    for (const other of nearest(card, right, (c) => c.left)) pairs.push({ side: "right", a: `${card.name} (${card.variant})`, b: `${other.name} (${other.variant})`, same: card.variant === other.variant });
  }
  return { cards: cards.length, pairs };
}

function expectNoSharedVariant({ cards, pairs }) {
  expect(cards).toBeGreaterThan(2);
  expect(pairs.length).toBeGreaterThan(0);
  expect(pairs.filter((pair) => pair.same).map((pair) => `${pair.a} has ${pair.b} ${pair.side} it`)).toEqual([]);
}

for (const colorScheme of ["dark", "light"]) {
  for (const width of WIDTHS) {
    test.describe(`card neighbours at ${width}px, ${colorScheme} theme`, () => {
      test.use({ viewport: { width, height: 900 }, colorScheme });

      test("result page after a run, as it loads and with every section open", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#verdictWord")).not.toHaveText("In progress", { timeout: 20_000 });
        await expect(page.locator("#checks .check-item").first()).toBeAttached();
        const loaded = await page.evaluate(cardNeighbours);
        expectNoSharedVariant(loaded);
        // Two columns above 900px: the panel grid must produce side-by-side pairs there.
        if (width > 900) expect(loaded.pairs.some((pair) => pair.side === "right" && pair.a.startsWith("panel-"))).toBe(true);
        await page.locator("#expandAllBtn").click();
        expectNoSharedVariant(await page.evaluate(cardNeighbours));
      });

      for (const path of PAGES) {
        test(`${path}`, async ({ page }) => {
          await page.goto(path);
          expectNoSharedVariant(await page.evaluate(cardNeighbours));
        });
      }
    });
  }
}
