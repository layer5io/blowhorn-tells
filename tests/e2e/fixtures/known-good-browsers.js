export const knownGoodBrowserReports = [
  buildBrowserReport({
    name: "Chrome on macOS",
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-GB,en;q=0.9",
      "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    },
    browser: {
      platform: "MacIntel",
      vendor: "Google Inc.",
      language: "en-GB",
      languages: ["en-GB", "en"],
      hardwareConcurrency: 10,
      deviceMemory: 8,
      plugins: chromePlugins(),
      screen: desktopScreen(1440, 900)
    },
    worker: {
      platform: "MacIntel",
      language: "en-GB",
      hardwareConcurrency: 10,
      deviceMemory: 8
    }
  }),
  buildBrowserReport({
    name: "Edge on Windows",
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "sec-ch-ua": '"Chromium";v="126", "Microsoft Edge";v="126", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"
    },
    browser: {
      platform: "Win32",
      vendor: "Google Inc.",
      language: "en-US",
      languages: ["en-US", "en"],
      hardwareConcurrency: 12,
      deviceMemory: 16,
      plugins: chromePlugins(),
      screen: desktopScreen(1920, 1080)
    },
    worker: {
      platform: "Win32",
      language: "en-US",
      hardwareConcurrency: 12,
      deviceMemory: 16
    }
  }),
  buildBrowserReport({
    name: "Firefox on Linux",
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-GB,en;q=0.7",
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0"
    },
    browser: {
      platform: "Linux x86_64",
      vendor: "",
      language: "en-GB",
      languages: ["en-GB", "en"],
      hardwareConcurrency: 8,
      deviceMemory: null,
      plugins: [],
      screen: desktopScreen(1366, 768)
    },
    worker: {
      platform: "Linux x86_64",
      language: "en-GB",
      hardwareConcurrency: 8,
      deviceMemory: null
    }
  }),
  buildBrowserReport({
    name: "Safari on iPhone",
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-GB,en;q=0.9",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
    },
    browser: {
      platform: "iPhone",
      vendor: "Apple Computer, Inc.",
      language: "en-GB",
      languages: ["en-GB", "en"],
      hardwareConcurrency: 6,
      deviceMemory: null,
      maxTouchPoints: 5,
      plugins: [],
      screen: mobileScreen(390, 844)
    },
    worker: {
      platform: "iPhone",
      language: "en-GB",
      hardwareConcurrency: 6,
      deviceMemory: null
    }
  }),
  buildBrowserReport({
    name: "Chrome on Android",
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-GB,en;q=0.9",
      "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
    },
    browser: {
      platform: "Linux armv8l",
      vendor: "Google Inc.",
      language: "en-GB",
      languages: ["en-GB", "en"],
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 5,
      plugins: [],
      screen: mobileScreen(412, 915)
    },
    worker: {
      platform: "Linux armv8l",
      language: "en-GB",
      hardwareConcurrency: 8,
      deviceMemory: 8
    }
  })
];

export const disallowedKnownGoodReasonIds = [
  "automation_globals",
  "automation_user_agent",
  "client_headless_user_agent",
  "empty_plugins_chromium",
  "managed_bot_score_low",
  "navigator_webdriver",
  "prototype_getter_not_native",
  "screen_viewport_impossible",
  "ua_platform_mismatch",
  "worker_platform_mismatch"
];

export const automationControlReport = {
  headers: {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-GB,en;q=0.9",
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36"
  },
  client: {
    ...knownGoodBrowserReports[0].client,
    browser: {
      ...knownGoodBrowserReports[0].client.browser,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
      platform: "Linux x86_64",
      webdriver: true
    },
    automation: {
      present: ["__webdriver_script_fn"],
      webdriver: true,
      cdpSerializationSignal: true
    },
    behavior: {
      score: 0.03,
      summary: { elapsedMs: 5000, counts: {} }
    }
  }
};

function buildBrowserReport({ name, headers, browser, worker }) {
  const workerProfile = {
    userAgent: headers["user-agent"],
    platform: worker.platform,
    language: worker.language,
    languages: browser.languages,
    hardwareConcurrency: worker.hardwareConcurrency,
    deviceMemory: worker.deviceMemory,
    webdriver: false
  };

  return {
    name,
    headers,
    client: {
      page: {
        url: "http://127.0.0.1:8788/",
        origin: "http://127.0.0.1:8788",
        referrer: null,
        title: "Am I a Bot?",
        visibilityState: "visible",
        isSecureContext: true,
        crossOriginIsolated: false,
        elapsedMs: 5600
      },
      browser: {
        userAgent: headers["user-agent"],
        platform: browser.platform,
        vendor: browser.vendor,
        language: browser.language,
        languages: browser.languages,
        webdriver: false,
        hardwareConcurrency: browser.hardwareConcurrency,
        deviceMemory: browser.deviceMemory,
        maxTouchPoints: browser.maxTouchPoints || 0,
        cookieEnabled: true,
        doNotTrack: null,
        timezone: "Europe/London",
        locale: browser.language,
        plugins: browser.plugins,
        mimeTypes: browser.plugins.length ? [{ type: "application/pdf", suffixes: "pdf" }] : [],
        permissions: {
          notifications: { state: "prompt", permission: "default" }
        },
        screen: browser.screen,
        prototypeChecks: { nativeGetterFailures: [] },
        pluginsConsistency: {
          referenceMismatch: false,
          itemOverflowMatchesFirst: true
        }
      },
      automation: {
        present: [],
        webdriver: false,
        cdpSerializationSignal: false
      },
      workers: {
        webWorker: workerProfile,
        iframe: workerProfile,
        serviceWorker: workerProfile
      },
      fingerprints: {
        canvas: { hash: "known-good-canvas-hash" },
        webgl: {
          supported: true,
          vendor: "WebKit",
          renderer: "ANGLE"
        }
      },
      surfaces: {
        performance: {
          samples: [performanceMemorySample()]
        }
      },
      network: {
        webrtc: {
          candidates: [],
          publicIps: []
        },
        ping: {
          medianMs: 24,
          memorySamples: [performanceMemorySample()]
        }
      },
      consistency: {},
      behavior: {
        score: 0.96,
        summary: {
          elapsedMs: 5600,
          counts: { pointermove: 9, pointerdown: 1, click: 1, keydown: 2, scroll: 1 }
        }
      },
      challenge: {
        completed: true,
        formSubmitted: true,
        confirmed: true,
        tableCompleted: true
      }
    }
  };
}

function chromePlugins() {
  return [
    { name: "PDF Viewer", filename: "internal-pdf-viewer" },
    { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer" },
    { name: "Chromium PDF Viewer", filename: "internal-pdf-viewer" }
  ];
}

function desktopScreen(width, height) {
  return {
    width,
    height,
    availWidth: width,
    availHeight: height - 40,
    innerWidth: width - 160,
    innerHeight: height - 180,
    devicePixelRatio: 2
  };
}

function mobileScreen(width, height) {
  return {
    width,
    height,
    availWidth: width,
    availHeight: height,
    innerWidth: width,
    innerHeight: height - 120,
    devicePixelRatio: 3
  };
}

function performanceMemorySample() {
  return {
    t: 5000,
    usedJSHeapSize: 18_000_000,
    totalJSHeapSize: 34_000_000,
    jsHeapSizeLimit: 4_294_967_296,
    usedRatio: 0.005
  };
}
