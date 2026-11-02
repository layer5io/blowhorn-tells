// WCAG 2.1 contrast of the colour tokens in public/styles.css, in both colour schemes and inside
// the dispatch card (near-black in both themes, so it carries the dark tokens).
// tests/contrast.test.js asserts on these numbers; run `pnpm contrast` to print them.
//
// Text needs 4.5:1; icons and other graphics need 3:1. The surfaces are the backgrounds the text
// and icons actually sit on: the page, the raised panel, the tint of a field card, the yellow
// ambient wash behind the hero, and the dispatch card.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

export const STYLES = css;

export function block(source, start) {
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
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

export const DARK_SELECTOR = ":root,\n.card-dispatch {";
const dark = tokens(block(css, DARK_SELECTOR));
const light = { ...dark, ...tokens(block(block(css, "@media (prefers-color-scheme: light)"), ":root {")) };

export function resolve(name, table, seen = new Set()) {
  const value = table[name];
  if (value === undefined || seen.has(name)) throw new Error(`no token --${name}`);
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  if (ref) return resolve(ref[1], table, new Set([...seen, name]));
  return value;
}

function rgb(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), a: 1 };
  const fn = /^rgba?\(([^)]+)\)$/.exec(color);
  if (fn) {
    const [r, g, b, a = 1] = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  throw new Error(`not a colour: ${color}`);
}

const toHex = ({ r, g, b }) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

// A translucent colour composited over an opaque one.
function over(top, under) {
  const t = rgb(top);
  const u = rgb(under);
  return toHex({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a) });
}

const lum = (color) => {
  const { r, g, b } = rgb(color);
  const [lr, lg, lb] = [r, g, b].map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

export function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const TEXT = ["good", "warn-ink", "bad", "ink", "ink-soft", "ink-muted", "link"];
export const GRAPHIC = ["good", "warn", "warn-ink", "bad", "subtle"];
export const STATUS = ["good", "warn", "warn-ink", "bad"];

function surfaces(table) {
  return {
    surface: resolve("surface", table),
    "surface-raised": resolve("surface-raised", table),
    "surface-deep": resolve("surface-deep", table),
    "surface-tint": resolve("surface-tint", table),
    "warn wash": over(resolve("ambient-3", table), resolve("surface-deep", table))
  };
}

// The dispatch card's own fill comes from cards.css (--near-black in both themes).
const dispatch = { ...surfaces(dark), "card-dispatch": resolve("near-black", dark) };

export const SCHEMES = [
  { name: "dark", table: dark, surfaces: surfaces(dark) },
  { name: "light", table: light, surfaces: surfaces(light) },
  { name: "dispatch card (both themes)", table: dark, surfaces: { "card-dispatch": dispatch["card-dispatch"] } }
];

export function contrastTable(names) {
  return SCHEMES.flatMap(({ name: scheme, table, surfaces: backgrounds }) =>
    names.flatMap((token) => Object.entries(backgrounds).map(([surface, bg]) => {
      const fg = resolve(token, table);
      return { scheme, token, fg, surface, bg, ratio: ratio(fg, bg) };
    })));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const rows = contrastTable(STATUS);
  const verdict = (row) => (row.token === "warn" ? (row.ratio >= 3 ? "graphic only, 3:1 ok" : "FAIL 3:1") : row.ratio >= 4.5 ? "AA text ok" : row.ratio >= 3 ? "graphic only" : "FAIL");
  console.log("scheme".padEnd(28), "token".padEnd(9), "fg".padEnd(8), "surface".padEnd(15), "bg".padEnd(8), "ratio".padStart(6), " verdict");
  for (const row of rows) {
    console.log(row.scheme.padEnd(28), row.token.padEnd(9), row.fg.padEnd(8), row.surface.padEnd(15), row.bg.padEnd(8), `${row.ratio.toFixed(2)}:1`.padStart(7), "", verdict(row));
  }
}
