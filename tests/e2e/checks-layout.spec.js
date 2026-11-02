import { expect, test } from "@playwright/test";

const STATUS_LABELS = ["Pass", "Warning", "Fail", "Not available"];
const GROUP_TITLES = ["Automation flags", "Behavior", "Fingerprint consistency"];

for (const colorScheme of ["dark", "light"]) {
  for (const width of [320, 375, 390, 1280]) {
    test.describe(`checks list at ${width}px, ${colorScheme} theme`, () => {
      test.use({ viewport: { width, height: 800 }, colorScheme });

      test("shows a status icon, a plain summary and an observed value for every check without overflowing", async ({ page }) => {
        await page.goto("/");
        const items = page.locator("#checks .check-item");
        await expect(items.first()).toBeAttached({ timeout: 20_000 });
        expect(await items.count()).toBeGreaterThanOrEqual(12);

        const list = await page.locator("#checks").evaluate((section) => {
          const viewport = document.documentElement.clientWidth;
          return {
            pageOverflow: document.documentElement.scrollWidth - viewport,
            outside: [...section.querySelectorAll("*")].filter((node) => node.getBoundingClientRect().right > viewport + 0.5).length,
            labels: [...section.querySelectorAll(".check-item .check-icon")].map((icon) => icon.getAttribute("aria-label")),
            summaries: [...section.querySelectorAll(".check-item .check-summary")].map((node) => node.textContent.trim()),
            observed: [...section.querySelectorAll(".check-item .check-detail code")].map((node) => node.textContent.trim()),
            groups: [...section.querySelectorAll(".check-group h3")].map((node) => node.textContent.trim()),
            groupCardVariants: [...section.querySelectorAll(".check-group")].map((node) => node.className)
          };
        });

        expect(list.pageOverflow).toBeLessThanOrEqual(0);
        expect(list.outside).toBe(0);
        expect(list.labels.length).toBe(await items.count());
        for (const label of list.labels) expect(STATUS_LABELS).toContain(label);
        for (const summary of list.summaries) expect(summary.length).toBeGreaterThan(0);
        expect(list.groups).toEqual(GROUP_TITLES);
        expect(list.observed.join(" ")).toMatch(/webdriver: (true|false|absent)/);
        // Adjacent group cards never share a variant.
        const variants = list.groupCardVariants.map((className) => className.match(/card-[a-z]+/)?.[0]);
        for (let i = 1; i < variants.length; i++) expect(variants[i]).not.toBe(variants[i - 1]);
      });

      test("hero verdict lines link to their group and read as 'Group: sentence'", async ({ page }) => {
        await page.goto("/");
        const lines = page.locator("#verdictGroups .verdict-line");
        await expect(lines).toHaveCount(3, { timeout: 20_000 });
        const texts = await lines.evaluateAll((links) => links.map((link) => link.querySelector(".verdict-line-text").textContent.replace(/\s+/g, " ").trim()));
        GROUP_TITLES.forEach((title, i) => expect(texts[i].startsWith(`${title}: `), texts[i]).toBe(true));
        for (const href of await lines.evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
          await expect(page.locator(href)).toBeAttached();
        }
      });

      test("the verdict word and score are visible, with one Verdict label", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#verdictWord")).not.toHaveText("In progress", { timeout: 20_000 });
        await expect(page.locator("#verdictScore")).toHaveText(/^\d+$/);
        await expect(page.locator(".eyebrow:text-is('Verdict')")).toHaveCount(0);
        await expect(page.locator(".label:text-is('Verdict')")).toHaveCount(1);
        await expect(page.locator("#status")).not.toContainText("Risk:");
      });
    });
  }
}
