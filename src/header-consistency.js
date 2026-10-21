const CLIENT_HINT_HIGH_ENTROPY_FIELDS = [
  { field: "architecture", header: "sec-ch-ua-arch", type: "token" },
  { field: "bitness", header: "sec-ch-ua-bitness", type: "token" },
  { field: "model", header: "sec-ch-ua-model", type: "token" },
  { field: "platformVersion", header: "sec-ch-ua-platform-version", type: "token" },
  { field: "wow64", header: "sec-ch-ua-wow64", type: "boolean" }
];

const USER_AGENT_DATA_HIGH_ENTROPY_FIELDS = [
  "architecture",
  "bitness",
  "model",
  "platformVersion",
  "uaFullVersion",
  "wow64"
];

export function parseAcceptLanguage(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim().split(";")[0])
    .filter(Boolean)
    .map(normalizeLanguageTag);
}

export function normalizeBrowserLanguages(languages) {
  if (!Array.isArray(languages)) return [];
  return languages.filter(Boolean).map(normalizeLanguageTag);
}

export function languageListsOverlap(requestLanguages, browserLanguages) {
  return requestLanguages.some((requestLanguage) => {
    const requestBase = requestLanguage.split("-")[0];
    return browserLanguages.some((browserLanguage) => {
      const browserBase = browserLanguage.split("-")[0];
      return requestLanguage === browserLanguage || requestBase === browserBase;
    });
  });
}

export function parseClientHintToken(value) {
  if (!value) return null;
  return String(value).trim().replace(/^"|"$/g, "") || null;
}

export function parseClientHintBoolean(value) {
  const token = parseClientHintToken(value);
  if (token === "?1") return true;
  if (token === "?0") return false;
  return null;
}

export function normalizePlatformLabel(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function collectClientHintHighEntropyMismatches(headers = {}, browserHighEntropy = {}) {
  const mismatches = [];
  if (!browserHighEntropy || typeof browserHighEntropy !== "object") return mismatches;

  for (const item of CLIENT_HINT_HIGH_ENTROPY_FIELDS) {
    const requestValue = item.type === "boolean"
      ? parseClientHintBoolean(headers[item.header])
      : parseClientHintToken(headers[item.header]);
    const browserValue = browserHighEntropy[item.field];
    if (!hasComparableValue(requestValue) || !hasComparableValue(browserValue)) continue;
    if (!sameHighEntropyValue(requestValue, browserValue)) {
      mismatches.push({
        field: item.field,
        requestValue,
        browserValue
      });
    }
  }

  return mismatches;
}

export function collectUserAgentDataHighEntropyMismatches(contexts = {}) {
  const contextEntries = Object.entries(contexts)
    .map(([name, context]) => [name, context?.userAgentData?.highEntropy])
    .filter(([, highEntropy]) => highEntropy && typeof highEntropy === "object");
  if (contextEntries.length < 2) return null;

  const preferredReference = contextEntries.find(([name]) => name === "Window") || contextEntries[0];
  const [reference, referenceHighEntropy] = preferredReference;
  const mismatches = [];

  for (const field of USER_AGENT_DATA_HIGH_ENTROPY_FIELDS) {
    const referenceValue = referenceHighEntropy[field];
    if (!hasComparableValue(referenceValue)) continue;
    for (const [context, highEntropy] of contextEntries) {
      if (context === reference) continue;
      const contextValue = highEntropy[field];
      if (!hasComparableValue(contextValue)) continue;
      if (!sameHighEntropyValue(referenceValue, contextValue)) {
        mismatches.push({
          field,
          context,
          referenceValue,
          contextValue
        });
      }
    }
  }

  return mismatches.length ? { reference, mismatches } : null;
}

function normalizeLanguageTag(value) {
  return String(value).toLowerCase();
}

function hasComparableValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function sameHighEntropyValue(left, right) {
  return normalizeHighEntropyValue(left) === normalizeHighEntropyValue(right);
}

function normalizeHighEntropyValue(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value).trim().toLowerCase();
}
