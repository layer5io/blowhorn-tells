import { describe, expect, it } from "vitest";
import { block, contrastTable, DARK_SELECTOR, GRAPHIC, STYLES as css, TEXT } from "../scripts/contrast.mjs";

// Checks the colour tokens in public/styles.css against WCAG 2.1 AA, in both colour schemes and
// inside the dispatch card. The ratios and surfaces come from scripts/contrast.mjs, which
// `pnpm contrast` prints as a table.

describe("token contrast", () => {
  it("keeps text at 4.5:1 or better on every surface", () => {
    for (const row of contrastTable(TEXT)) {
      expect(row.ratio, `${row.scheme}: ${row.token} ${row.fg} on ${row.surface} ${row.bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps status icons and borders at 3:1 or better on every surface", () => {
    for (const row of contrastTable(GRAPHIC)) {
      expect(row.ratio, `${row.scheme}: ${row.token} ${row.fg} on ${row.surface} ${row.bg}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("warn as text", () => {
  it("colours every warn text and icon with --warn-ink, never --warn", () => {
    const uses = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /(^|[\s;])color:\s*var\(--warn\)/.test(body))
      .map(([, selector]) => selector.trim());
    expect(uses).toEqual([]);
  });
});

describe("dispatch card", () => {
  it("carries the dark token set in both themes", () => {
    expect(css).toContain(DARK_SELECTOR);
    // The light override targets :root alone, so a dispatch card keeps its dark tokens.
    expect(block(block(css, "@media (prefers-color-scheme: light)"), ":root {")).not.toContain("card-dispatch");
    expect(css).toMatch(/\.card-dispatch \{ color-scheme: dark; \}/);
  });
});

describe("status link", () => {
  it("takes its colours from the theme tokens, not fixed greys", () => {
    const rule = block(css, ".status-link {");
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(rule).toMatch(/background: var\(--surface-raised\)/);
    expect(rule).toMatch(/color: var\(--ink-soft\)/);
  });
});

describe("selector lists", () => {
  it("never repeat an item inside one selector list", () => {
    const lists = [...css.matchAll(/^([^{}@/\n][^{}]*)\{/gm)].map((match) => match[1].split(",").map((part) => part.trim()));
    const repeated = lists.filter((items) => new Set(items).size !== items.length).map((items) => items.join(", "));
    expect(repeated).toEqual([]);
  });
});

describe("check rows", () => {
  it("carry no per-status fill, border or text colour", () => {
    const rowRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selector, body]) => ({ selector: selector.trim(), body }))
      .filter(({ selector }) => /\.check-item/.test(selector));
    for (const { selector, body } of rowRules) {
      expect(selector, selector).not.toMatch(/\.check-(pass|warn|fail|na)/);
      expect(body, selector).not.toMatch(/dashed|var\(--(good|warn|warn-ink|bad)\)/);
    }
    expect(css).not.toMatch(/\.check-finding-/);
  });
});
