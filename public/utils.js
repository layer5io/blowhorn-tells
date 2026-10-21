export function parseIceCandidate(candidate) {
  const parts = candidate.trim().split(/\s+/);
  if (parts.length < 8) return null;
  const address = parts[4];
  const port = parts[5];
  const typeIndex = parts.indexOf("typ");
  const type = typeIndex >= 0 ? parts[typeIndex + 1] : null;
  return {
    foundation: parts[0].replace(/^candidate:/, ""),
    component: parts[1],
    protocol: parts[2],
    priority: parts[3],
    address,
    port,
    type,
    isMdns: /\.local$/i.test(address),
    isPrivate: isPrivateIp(address),
    isPublic: isPublicIp(address),
    raw: candidate
  };
}

export function isPrivateIp(address) {
  if (!address || /\.local$/i.test(address)) return false;
  if (address.includes(":")) {
    const lower = address.toLowerCase();
    return lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      isIpv6LinkLocal(lower);
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 ||
    parts[0] === 0 ||
    parts[0] === 127 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254);
}

export function isPublicIp(address) {
  if (!address || /\.local$/i.test(address)) return false;
  if (address.includes(":")) return isGlobalIpv6(address);
  const parts = parseIpv4(address);
  return Boolean(parts) && !isPrivateIp(address) && !isSpecialUseIpv4(parts);
}

function parseIpv4(address) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return null;
  const parts = address.split(".").map(Number);
  return parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

function isSpecialUseIpv4(parts) {
  const [a, b, c] = parts;
  return (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function isGlobalIpv6(address) {
  const lower = address.toLowerCase();
  if (isPrivateIp(lower)) return false;
  const first = firstIpv6Hextet(lower);
  if (first == null) return false;
  return first < 0xff00 &&
    !lower.startsWith("2001:db8:") &&
    lower !== "2001:db8::" &&
    !lower.startsWith("2002:") &&
    !lower.startsWith("64:ff9b:");
}

function isIpv6LinkLocal(address) {
  const first = firstIpv6Hextet(address);
  return first != null && first >= 0xfe80 && first <= 0xfebf;
}

function firstIpv6Hextet(address) {
  const stripped = address.replace(/^\[|\]$/g, "");
  const first = stripped.startsWith("::") ? "0" : stripped.split(":")[0];
  if (!/^[0-9a-f]{0,4}$/i.test(first)) return null;
  return parseInt(first || "0", 16);
}

export function guessUaOs(ua) {
  if (/Windows NT/i.test(ua)) return "windows";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  if (/CrOS/i.test(ua)) return "chromeos";
  return null;
}

export function guessPlatformOs(platform) {
  if (!platform) return null;
  if (/Win/i.test(platform)) return "windows";
  if (/iPhone|iPad|iPod/i.test(platform)) return "ios";
  if (/Mac/i.test(platform)) return "macos";
  if (/Android|Linux armv/i.test(platform)) return "android";
  if (/Linux|X11/i.test(platform)) return "linux";
  return null;
}

export function simplifyPerformanceEntry(entry) {
  const out = {};
  for (const key of ["type", "redirectCount", "domContentLoadedEventEnd", "loadEventEnd", "duration", "transferSize", "encodedBodySize", "decodedBodySize"]) {
    if (entry[key] !== undefined) out[key] = typeof entry[key] === "number" ? Math.round(entry[key] * 10) / 10 : entry[key];
  }
  return out;
}

export function standardDeviation(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (nums.length < 2) return 0;
  const mean = nums.reduce((acc, value) => acc + value, 0) / nums.length;
  const variance = nums.reduce((acc, value) => acc + (value - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function promiseWithTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label || "Timeout")), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function safeAsync(fn) {
  try {
    const value = await fn();
    return value === undefined ? null : value;
  } catch (error) {
    return { error: String(error && error.message ? error.message : error) };
  }
}

export function safe(fn) {
  try {
    const value = fn();
    return value === undefined ? null : value;
  } catch (error) {
    return { error: String(error && error.message ? error.message : error) };
  }
}

export async function sha256(text) {
  try {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch (_) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return `fallback-${Math.abs(hash)}`;
  }
}

export function copyPlain(value) {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));
}

export function bool(value) {
  return value === true ? "true" : value === false ? "false" : value == null ? "n/a" : String(value);
}

export function formatValue(value) {
  if (value == null) return "n/a";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function formatList(values, empty = "none") {
  return Array.isArray(values) && values.length ? values.join(", ") : empty;
}

export function formatMs(value) {
  if (value == null || value === "") return "n/a";
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))} ms` : "n/a";
}

export function formatBytes(value) {
  if (value == null || value === "") return "n/a";
  if (!Number.isFinite(Number(value))) return "n/a";
  const bytes = Number(value);
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const rounded = size >= 10 || unitIndex === 0 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
