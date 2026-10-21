import { describe, expect, it } from "vitest";
import { chromeMajor, matchAutomationGlobals, summarizeInput } from "../public/collect-tells.js";
import { scoreRemoteControlTells, scoreReport } from "../src/report-verdict.js";

function reasonsFor(client, options) {
  const reasons = [];
  scoreRemoteControlTells(client, options, (points, id, severity) => reasons.push({ id, severity, points }));
  return reasons.map((reason) => reason.id);
}

const cleanTells = {
  webdriver: { definedOn: "Navigator.prototype", getterNative: true },
  nativeFunctions: { functionToString: true, permissionsQuery: true },
  documentAutomationKeys: [],
  input: { count: 5, untrusted: 0, trustedWhileHidden: 0, trustedWithoutFocus: 0 }
};

const cleanBrowser = {
  permissions: { notifications: { state: "prompt", permission: "default" } },
  screen: { innerWidth: 1280, innerHeight: 720, outerWidth: 1280, outerHeight: 800 }
};

describe("automation global matching", () => {
  it("finds driver globals by prefix, once each, sorted", () => {
    expect(matchAutomationGlobals([
      "__playwright__binding__", "__pwInitScripts", "cdc_adoQpoasnfa76pfcZLmcfl_Array",
      "__puppeteer_utility_world__", "__chromiumoxide_x", "document", "__playwright__binding__", "chrome"
    ])).toEqual([
      "__chromiumoxide_x", "__playwright__binding__", "__puppeteer_utility_world__", "__pwInitScripts", "cdc_adoQpoasnfa76pfcZLmcfl_Array"
    ]);
  });

  it("leaves ordinary page globals alone", () => {
    expect(matchAutomationGlobals(["chrome", "onload", "__REACT_DEVTOOLS_GLOBAL_HOOK__", "dataLayer"])).toEqual([]);
  });
});

describe("input summary", () => {
  it("counts script-generated, hidden-page and unfocused input", () => {
    expect(summarizeInput([
      { type: "pointerdown", isTrusted: true, hidden: false, hasFocus: true },
      { type: "click", isTrusted: false, hidden: false, hasFocus: true },
      { type: "keydown", isTrusted: true, hidden: true, hasFocus: false },
      { type: "keydown", isTrusted: true, hidden: false, hasFocus: false },
      { type: "pointermove", isTrusted: false, hidden: true, hasFocus: false },
      { type: "scroll", x: 0, y: 10 }
    ])).toEqual({ count: 4, untrusted: 1, trustedWhileHidden: 1, trustedWithoutFocus: 2 });
  });
});

describe("Chrome major", () => {
  it("reads branded and headless user agents", () => {
    expect(chromeMajor("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36")).toBe(155);
    expect(chromeMajor("Mozilla/5.0 (X11) HeadlessChrome/126.0.0.0 Safari/537.36")).toBe(126);
    expect(chromeMajor("Mozilla/5.0 (X11; rv:128.0) Gecko/20100101 Firefox/128.0")).toBeNull();
  });
});

describe("remote-control tells scoring", () => {
  it("raises nothing for a plain browser", () => {
    expect(reasonsFor({ browser: cleanBrowser, tells: cleanTells })).toEqual([]);
  });

  it("raises nothing for an older client that sends no tells", () => {
    expect(reasonsFor({ browser: {} })).toEqual([]);
  });

  it("flags a webdriver hidden on the navigator object", () => {
    const tells = { ...cleanTells, webdriver: { definedOn: "navigator", getterNative: false } };
    expect(reasonsFor({ browser: cleanBrowser, tells })).toEqual(["webdriver_own_property"]);
  });

  it("flags a patched webdriver getter on the prototype", () => {
    const tells = { ...cleanTells, webdriver: { definedOn: "Navigator.prototype", getterNative: false } };
    expect(reasonsFor({ browser: cleanBrowser, tells })).toEqual(["webdriver_getter_patched"]);
  });

  it("flags replaced native functions and driver keys on document", () => {
    const tells = {
      ...cleanTells,
      nativeFunctions: { functionToString: false, permissionsQuery: true },
      documentAutomationKeys: ["$cdc_asdjflasutopfhvcZLmcfl_"]
    };
    expect(reasonsFor({ browser: cleanBrowser, tells })).toEqual(["native_function_patched", "document_automation_keys"]);
  });

  it("flags script-generated input and input into a hidden page", () => {
    const tells = { ...cleanTells, input: { count: 3, untrusted: 1, trustedWhileHidden: 2, trustedWithoutFocus: 2 } };
    expect(reasonsFor({ browser: cleanBrowser, tells })).toEqual(["synthetic_input", "input_while_hidden"]);
  });

  it("flags unfocused input on its own as medium", () => {
    const reasons = [];
    scoreRemoteControlTells(
      { browser: cleanBrowser, tells: { ...cleanTells, input: { count: 2, untrusted: 0, trustedWhileHidden: 0, trustedWithoutFocus: 1 } } },
      {},
      (points, id, severity) => reasons.push({ id, severity })
    );
    expect(reasons).toEqual([{ id: "input_without_focus", severity: "medium" }]);
  });

  it("flags the denied-but-prompt notification contradiction", () => {
    const browser = { ...cleanBrowser, permissions: { notifications: { state: "prompt", permission: "denied" } } };
    expect(reasonsFor({ browser, tells: cleanTells })).toEqual(["notification_permission_contradiction"]);
  });

  it("flags a zero-size desktop window but not a mobile one", () => {
    const browser = { ...cleanBrowser, screen: { innerWidth: 1280, innerHeight: 720, outerWidth: 0, outerHeight: 0 } };
    expect(reasonsFor({ browser, tells: cleanTells })).toEqual(["zero_size_window"]);
    expect(reasonsFor({ browser, tells: cleanTells }, { isMobileBrowser: true })).toEqual([]);
  });

  it("lowers the overall verdict through scoreReport", () => {
    const clean = scoreReport({ server: { userAgent: "Mozilla/5.0" }, client: { browser: cleanBrowser, tells: cleanTells } });
    const driven = scoreReport({
      server: { userAgent: "Mozilla/5.0" },
      client: {
        browser: cleanBrowser,
        tells: { ...cleanTells, input: { count: 3, untrusted: 3, trustedWhileHidden: 0, trustedWithoutFocus: 0 } }
      }
    });
    expect(driven.score).toBe(clean.score - 30);
    expect(driven.reasons.map((reason) => reason.id)).toContain("synthetic_input");
  });
});
