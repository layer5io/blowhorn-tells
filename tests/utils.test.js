import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  formatBytes,
  formatList,
  formatMs,
  formatValue,
  guessPlatformOs,
  guessUaOs,
  isPrivateIp,
  isPublicIp,
  parseIceCandidate,
  standardDeviation,
  unique
} from "../public/utils.js";

describe("network utility helpers", () => {
  it("classifies private, public, and mDNS addresses", () => {
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("172.20.2.3")).toBe(true);
    expect(isPrivateIp("192.168.1.10")).toBe(true);
    expect(isPrivateIp("candidate.local")).toBe(false);

    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("192.168.1.10")).toBe(false);
    expect(isPublicIp("candidate.local")).toBe(false);
    expect(isPublicIp("100.64.0.1")).toBe(false);
    expect(isPublicIp("203.0.113.7")).toBe(false);
    expect(isPublicIp("224.0.0.1")).toBe(false);
    expect(isPublicIp("2001:db8::1")).toBe(false);
    expect(isPublicIp("ff02::1")).toBe(false);
    expect(isPublicIp("2001:4860:4860::8888")).toBe(true);
  });

  it("parses ICE candidates into structured address signals", () => {
    const parsed = parseIceCandidate("candidate:842163049 1 udp 1677729535 192.168.0.8 54400 typ srflx raddr 0.0.0.0 rport 0 generation 0");

    expect(parsed).toMatchObject({
      foundation: "842163049",
      component: "1",
      protocol: "udp",
      address: "192.168.0.8",
      port: "54400",
      type: "srflx",
      isPrivate: true,
      isPublic: false
    });
  });
});

describe("formatting and platform helpers", () => {
  it("escapes report values before HTML insertion", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">`)).toBe("&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt;");
  });

  it("normalises primitive display values", () => {
    expect(formatValue(null)).toBe("n/a");
    expect(formatValue(true)).toBe("true");
    expect(formatValue({ ok: true })).toBe('{"ok":true}');
  });

  it("formats list and millisecond display values", () => {
    expect(formatList(["a", "b"])).toBe("a, b");
    expect(formatList([])).toBe("none");
    expect(formatMs(26.4)).toBe("26 ms");
    expect(formatMs("50")).toBe("50 ms");
    expect(formatMs(null)).toBe("n/a");
    expect(formatMs("nope")).toBe("n/a");
    expect(formatBytes(4 * 1024 * 1024 * 1024)).toBe("4 GB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(null)).toBe("n/a");
  });

  it("guesses OS families from user agent and platform strings", () => {
    expect(guessUaOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macos");
    expect(guessUaOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(guessUaOs("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(guessPlatformOs("MacIntel")).toBe("macos");
    expect(guessPlatformOs("Linux x86_64")).toBe("linux");
    expect(guessPlatformOs("Linux armv8l")).toBe("android");
  });
});

describe("array and numeric helpers", () => {
  it("deduplicates truthy values while preserving order", () => {
    expect(unique(["a", "", "b", "a", null, "c"])).toEqual(["a", "b", "c"]);
  });

  it("computes population standard deviation for finite numbers", () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(standardDeviation([1, Number.NaN, 1])).toBe(0);
  });
});
