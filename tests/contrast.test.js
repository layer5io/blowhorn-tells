import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Checks the colour tokens in public/styles.css against WCAG 2.1 AA, in both colour schemes.
// Text needs 4.5:1; icons and other graphics need 3:1. The surfaces are the backgrounds the
// text and icons actually sit on: the page, the raised panel, the tint of a field card.
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

function block(source, start) {
  const i = source.indexOf(start);
  if (i < 0) throw new Error(`no block ${start}`);
  const open = source.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === "{") depth++;
    if (source[j] === "}" && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`unclosed ${start}`);
}

function tokens(body) {
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

function resolve(name, table, seen = new Set()) {
  const value = table[name];
  if (value === undefined || seen.has(name)) return undefined;
  const ref = /^var\(--([a-z-]+)\)$/.exec(value);
  if (ref) return resolve(ref[1], table, new Set([...seen, name]));
  return value;
}

const dark = tokens(block(css, ":root {"));
const light = { ...dark, ...tokens(block(block(css, "@media (prefers-color-scheme: light)"), ":root {")) };

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = ["good", "warn-ink", "bad", "ink", "ink-soft", "ink-muted", "link"];
const GRAPHIC = ["good", "warn", "bad", "subtle"];
const SURFACES = ["surface", "surface-raised", "surface-deep", "surface-tint"];

for (const [scheme, table] of [["dark", dark], ["light", light]]) {
  describe(`${scheme} theme`, () => {
    it("keeps text at 4.5:1 or better on every surface", () => {
      for (const name of TEXT) {
        for (const surface of SURFACES) {
          const fg = resolve(name, table);
          const bg = resolve(surface, table);
          expect(ratio(fg, bg), `${name} ${fg} on ${surface} ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it("keeps status icons at 3:1 or better on every surface", () => {
      for (const name of GRAPHIC) {
        for (const surface of SURFACES) {
          const fg = resolve(name, table);
          const bg = resolve(surface, table);
          expect(ratio(fg, bg), `${name} ${fg} on ${surface} ${bg}`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  });
}

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
