import { expect, test } from "@playwright/test";

const STATUS_LABELS = ["Pass", "Warning", "Fail", "Not available"];
const GROUP_TITLES = ["Automation flags", "Behavior", "Fingerprint consistency"];
const RAW_API = /navigator\.|window\.|document\.|performance\.|Function\.|isTrusted|\.prototype|webdriver:/;

// The shared card variants load from blowhorn.ai. The suite stays hermetic: the request gets an
// empty stylesheet, and the one test that needs a variant's fill sets it itself.
test.beforeEach(async ({ page }) => {
  await page.route("https://blowhorn.ai/assets/brand/cards.css", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
});

// WCAG contrast of each element's text colour against the first opaque background behind it.
function contrastOf(selectors) {
  const parse = (color) => {
    const parts = color.match(/[\d.]+/g).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  };
  const lum = ({ r, g, b }) => [r, g, b]
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const background = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color.a > 0) layers.push(color);
      if (color.a >= 0.99) break;
    }
    return layers.reverse().reduce((under, top) => over(top, under), { r: 255, g: 255, b: 255, a: 1 });
  };
  return selectors.flatMap((selector) => [...document.querySelectorAll(selector)]
    .filter((el) => el.getClientRects().length)
    .map((el) => {
      const bg = background(el);
      const fg = over(parse(getComputedStyle(el).color), bg);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return { selector, text: el.textContent.trim().slice(0, 40), ratio: (hi + 0.05) / (lo + 0.05) };
    }));
}

for (const colorScheme of ["dark", "light"]) {
  for (const width of [320, 375, 390, 1280]) {
    test.describe(`checks list at ${width}px, ${colorScheme} theme`, () => {
      test.use({ viewport: { width, height: 800 }, colorScheme });

      test("shows a status icon and word, a plain summary and an observed value for every check without overflowing", async ({ page }) => {
        await page.goto("/");
        const items = page.locator("#checks .check-item");
        await expect(items.first()).toBeAttached({ timeout: 20_000 });
        expect(await items.count()).toBeGreaterThanOrEqual(12);

        const list = await page.locator("#checks").evaluate((section) => {
          const viewport = document.documentElement.clientWidth;
          return {
            pageOverflow: document.documentElement.scrollWidth - viewport,
            outside: [...section.querySelectorAll("*")].filter((node) => node.getBoundingClientRect().right > viewport + 0.5).length,
            icons: [...section.querySelectorAll(".check-item .check-icon")].map((icon) => icon.getAttribute("aria-hidden")),
            words: [...section.querySelectorAll(".check-item .check-state")].map((node) => node.textContent.trim()),
            summaries: [...section.querySelectorAll(".check-item .check-summary")].map((node) => node.textContent.trim()),
            observed: [...section.querySelectorAll(".check-item .check-detail code")].map((node) => node.textContent.trim()),
            groups: [...section.querySelectorAll(".check-group h3")].map((node) => node.textContent.trim()),
            groupCardVariants: [...section.querySelectorAll(".check-group")].map((node) => node.className),
            rowStyles: [...section.querySelectorAll(".check-item")].map((node) => {
              const style = getComputedStyle(node);
              return { className: node.className, background: style.backgroundColor, borders: [style.borderTopStyle, style.borderLeftStyle, style.borderRightStyle] };
            })
          };
        });

        expect(list.pageOverflow).toBeLessThanOrEqual(0);
        expect(list.outside).toBe(0);
        expect(list.icons.length).toBe(await items.count());
        expect(list.icons.every((hidden) => hidden === "true")).toBe(true);
        expect(list.words.length).toBe(await items.count());
        for (const word of list.words) expect(STATUS_LABELS).toContain(word);
        for (const summary of list.summaries) {
          expect(summary, summary).toMatch(/^[A-Z0-9]/);
          expect(summary, summary).not.toMatch(RAW_API);
        }
        expect(list.groups).toEqual(GROUP_TITLES);
        expect(list.observed.join(" ")).toMatch(/webdriver: (true|false|absent)/);
        // Rows are plain list rows: no status class, no fill, a hairline below and nothing else.
        for (const row of list.rowStyles) {
          expect(row.className).toBe("check-item");
          expect(row.background).toBe("rgba(0, 0, 0, 0)");
          expect(row.borders).toEqual(["none", "none", "none"]);
        }
        // Adjacent group cards never share a variant.
        const variants = list.groupCardVariants.map((className) => className.match(/card-[a-z]+/)?.[0]);
        for (let i = 1; i < variants.length; i++) expect(variants[i]).not.toBe(variants[i - 1]);
      });

      test("hero verdict lines link to their group and read as 'Group: plain sentence'", async ({ page }) => {
        await page.goto("/");
        const lines = page.locator("#verdictGroups .verdict-line");
        await expect(lines).toHaveCount(3, { timeout: 20_000 });
        const texts = await lines.evaluateAll((links) => links.map((link) => link.querySelector(".verdict-line-text").textContent.replace(/\s+/g, " ").trim()));
        GROUP_TITLES.forEach((title, i) => {
          expect(texts[i].startsWith(`${title}: `), texts[i]).toBe(true);
          expect(texts[i], texts[i]).not.toMatch(RAW_API);
        });
        for (const href of await lines.evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
          await expect(page.locator(href)).toBeAttached();
        }
      });

      test("the verdict word and score are visible, with one Verdict label and no risk line", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#verdictWord")).not.toHaveText("In progress", { timeout: 20_000 });
        await expect(page.locator("#verdictScore")).toHaveText(/^\d+$/);
        await expect(page.locator(".eyebrow:text-is('Verdict')")).toHaveCount(0);
        await expect(page.locator(".label:text-is('Verdict')")).toHaveCount(1);
        await expect(page.locator("main")).not.toContainText(/Risk:/i);
      });

      test("verdict, status words, icons and links meet WCAG AA", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#checks .check-item").first()).toBeAttached({ timeout: 20_000 });
        await expect(page.locator("#verdictWord")).not.toHaveText("In progress", { timeout: 20_000 });
        const text = await page.evaluate(contrastOf, ["#verdictWord", ".check-state", ".check-summary", ".verdict-line-sentence", ".status-link"]);
        const icons = await page.evaluate(contrastOf, [".check-icon"]);
        expect(text.length).toBeGreaterThan(20);
        for (const item of text) expect(item.ratio, `${item.selector} "${item.text}"`).toBeGreaterThanOrEqual(4.5);
        for (const item of icons) expect(item.ratio, `${item.selector} "${item.text}"`).toBeGreaterThanOrEqual(3);
      });

      test("every warn colour in use reads at AA, whatever the current verdict", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#verdictWord")).not.toHaveText("In progress", { timeout: 20_000 });
        // Force the medium-risk headline and a warn icon and word, so both themes check them on every run.
        await page.evaluate(() => {
          document.querySelector("#verdictWord").dataset.risk = "medium";
          for (const el of document.querySelectorAll("#checks .check-state, #checks .check-icon")) el.className = el.className.replace(/check-(pass|fail|na)\b/, "check-warn");
        });
        const text = await page.evaluate(contrastOf, ["#verdictWord", "#checks .check-state"]);
        for (const item of text) expect(item.ratio, `${item.selector} "${item.text}"`).toBeGreaterThanOrEqual(4.5);
      });

      test("text inside a dispatch card stays legible", async ({ page }) => {
        // cards.css paints .card-dispatch near-black with cream ink in both themes; stand in for
        // those two properties only (the rest of the card comes from the page's own tokens).
        await page.addInitScript(() => {
          document.addEventListener("DOMContentLoaded", () => {
            const style = document.createElement("style");
            style.textContent = ".card-dispatch { background: #1E2117; color: #FFF6E0; }";
            document.head.append(style);
          });
        });
        await page.goto("/");
        await expect(page.locator("#checks .check-item").first()).toBeAttached({ timeout: 20_000 });
        await page.evaluate(() => document.querySelectorAll(".card-dispatch details, details.card-dispatch").forEach((node) => { node.open = true; }));
        const text = await page.evaluate(contrastOf, [".card-dispatch summary span", ".card-dispatch summary small", ".card-dispatch .kv > div", ".card-dispatch label"]);
        expect(text.length).toBeGreaterThan(5);
        for (const item of text) expect(item.ratio, `${item.selector} "${item.text}"`).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
}
