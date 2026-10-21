// Tells Blowhorn's own release checks look for: what a remote-controlled Chrome gives away
// that the generic fingerprint collectors do not read.

export const AUTOMATION_GLOBAL_PATTERN = /^(cdc_|\$cdc_|__playwright|__pw_|__pwInitScripts|__puppeteer|_selenium|callSelenium|__webdriver|__driver|__fxdriver|__nightmare|_phantom|__\$webdriverAsyncExecutor|__lastWatirAlert|__chromiumoxide|__rod|__headless)/i;

export function matchAutomationGlobals(names) {
  return [...new Set(names.filter((name) => AUTOMATION_GLOBAL_PATTERN.test(name)))].sort();
}

export function collectTells(state) {
  return {
    webdriver: collectWebdriverDescriptor(),
    nativeFunctions: {
      functionToString: isNative(Function.prototype.toString),
      permissionsQuery: navigator.permissions?.query ? isNative(navigator.permissions.query) : null
    },
    documentAutomationKeys: matchAutomationGlobals(Object.keys(document)),
    chromeMajor: chromeMajor(navigator.userAgent),
    input: summarizeInput(state?.events || [])
  };
}

function collectWebdriverDescriptor() {
  const own = Object.getOwnPropertyDescriptor(navigator, "webdriver");
  const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), "webdriver");
  const desc = own || proto;
  return {
    definedOn: own ? "navigator" : proto ? "Navigator.prototype" : "absent",
    getterNative: desc?.get ? isNative(desc.get) : null
  };
}

function isNative(fn) {
  try {
    return Function.prototype.toString.call(fn).includes("[native code]");
  } catch (_) {
    return null;
  }
}

export function chromeMajor(userAgent) {
  const match = /(?:Chrome|HeadlessChrome)\/(\d+)/.exec(String(userAgent || ""));
  return match ? Number(match[1]) : null;
}

const INPUT_TYPES = new Set(["pointerdown", "pointerup", "click", "keydown"]);

export function summarizeInput(events) {
  const input = events.filter((event) => INPUT_TYPES.has(event.type) && typeof event.isTrusted === "boolean");
  return {
    count: input.length,
    untrusted: input.filter((event) => event.isTrusted === false).length,
    trustedWhileHidden: input.filter((event) => event.isTrusted && event.hidden === true).length,
    trustedWithoutFocus: input.filter((event) => event.isTrusted && event.hasFocus === false).length
  };
}
