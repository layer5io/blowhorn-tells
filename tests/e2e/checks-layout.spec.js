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

test.describe("independent panel controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  const diagnosticPanels = [
    "#panel-top-signals",
    "#panel-runtime",
    "#panel-server-ip",
    "#panel-browser",
    "#panel-behaviour",
    "#panel-webrtc",
    "#panel-consistency",
    "#panel-network",
    "#panel-surfaces",
    "#panel-media",
    "#panel-memory",
    "#panel-sensors",
    "#panel-resources",
    "#panel-extensions",
    "#panel-voices"
  ];

  test("Interaction Test toggles independently", async ({ page }) => {
    const challenge = page.locator("#panel-challenge");

    // Capture the initial states of all diagnostic panels.
    const initialStates = await Promise.all(
      diagnosticPanels.map((selector) =>
        page.locator(selector).evaluate((panel) => panel.open)
      )
    );

    // Interaction Test starts collapsed.
    await expect(challenge).not.toHaveAttribute("open", "");

    // Open Interaction Test.
    await challenge.locator("summary").click();
    await expect(challenge).toHaveAttribute("open", "");

    // Diagnostic panels should retain their initial states.
    const statesAfterOpening = await Promise.all(
      diagnosticPanels.map((selector) =>
        page.locator(selector).evaluate((panel) => panel.open)
      )
    );

    expect(statesAfterOpening).toEqual(initialStates);

    // Close Interaction Test.
    await challenge.locator("summary").click();
    await expect(challenge).not.toHaveAttribute("open", "");

    // Diagnostic panels should still retain their initial states.
    const statesAfterClosing = await Promise.all(
      diagnosticPanels.map((selector) =>
        page.locator(selector).evaluate((panel) => panel.open)
      )
    );

    expect(statesAfterClosing).toEqual(initialStates);
  });

  test("Expand all and Collapse all affect only diagnostic panels", async ({ page }) => {
    const challenge = page.locator("#panel-challenge");

    // Open Interaction Test first.
    await challenge.locator("summary").click();
    await expect(challenge).toHaveAttribute("open", "");

    // Collapse all diagnostic panels.
    await page.locator("#collapseAllBtn").click();

    for (const selector of diagnosticPanels) {
      await expect(page.locator(selector)).not.toHaveAttribute("open", "");
    }

    // Interaction Test should remain open.
    await expect(challenge).toHaveAttribute("open", "");

    // Expand all diagnostic panels.
    await page.locator("#expandAllBtn").click();

    for (const selector of diagnosticPanels) {
      await expect(page.locator(selector)).toHaveAttribute("open", "");
    }

    // Interaction Test should still remain open.
    await expect(challenge).toHaveAttribute("open", "");
  });

  test("bulk buttons reflect diagnostic panel states", async ({ page }) => {
    const expandAll = page.locator("#expandAllBtn");
    const collapseAll = page.locator("#collapseAllBtn");

    // Initial state: some diagnostic panels are open and others are closed.
    await expect(expandAll).toBeEnabled();
    await expect(collapseAll).toBeEnabled();

    // Collapse all diagnostic panels.
    await collapseAll.click();

    await expect(collapseAll).toBeDisabled();
    await expect(expandAll).toBeEnabled();

    // Manually open one diagnostic panel.
    await page.locator("#panel-runtime summary").click();

    // Both buttons should now be enabled.
    await expect(expandAll).toBeEnabled();
    await expect(collapseAll).toBeEnabled();

    // Expand all diagnostic panels.
    await expandAll.click();

    await expect(expandAll).toBeDisabled();
    await expect(collapseAll).toBeEnabled();
  });
});
