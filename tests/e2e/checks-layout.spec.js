import { expect, test } from "@playwright/test";

const STATUS_LABELS = ["Pass", "Warning", "Fail", "Not available"];

for (const width of [320, 375, 390, 1280]) {
  test.describe(`checks table at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, colorScheme: "dark" });

    test("shows a status symbol and an observed result for every check without overflowing", async ({ page }) => {
      await page.goto("/");
      const rows = page.locator("#coverageTable tbody tr");
      await expect(rows.first()).toBeVisible({ timeout: 20_000 });
      expect(await rows.count()).toBeGreaterThanOrEqual(12);

      const table = await page.locator("#checks").evaluate((section) => {
        const viewport = document.documentElement.clientWidth;
        return {
          pageOverflow: document.documentElement.scrollWidth - viewport,
          wrapOverflow: section.querySelector(".table-wrap").scrollWidth - section.querySelector(".table-wrap").clientWidth,
          outside: [...section.querySelectorAll("*")].filter((node) => node.getBoundingClientRect().right > viewport + 0.5).length,
          labels: [...section.querySelectorAll("tbody .check-icon")].map((icon) => icon.getAttribute("aria-label")),
          results: [...section.querySelectorAll("tbody .check-observed")].map((node) => node.textContent.trim()),
          text: section.querySelector("tbody").textContent
        };
      });

      expect(table.pageOverflow).toBeLessThanOrEqual(0);
      expect(table.wrapOverflow).toBeLessThanOrEqual(0);
      expect(table.outside).toBe(0);
      expect(table.labels.length).toBe(await rows.count());
      for (const label of table.labels) expect(STATUS_LABELS).toContain(label);
      for (const result of table.results) expect(result.length).toBeGreaterThan(0);
      expect(table.text).not.toMatch(/\bchecked\b/i);
      expect(table.results.join(" ")).toMatch(/webdriver: (true|false|absent)/);
    });
  });
}
