import { copyPlain, promiseWithTimeout, safeAsync, sha256 } from "./utils.js";

export async function collectFingerprints() {
  const [canvas, webgl, audio, fonts, cssMedia, webgpu] = await Promise.all([
    collectCanvasFingerprint(),
    collectWebglFingerprint(),
    collectAudioFingerprint(),
    collectFontFingerprint(),
    collectCssMediaFingerprint(),
    collectWebGpuFingerprint()
  ]);
  return { canvas, webgl, audio, fonts, cssMedia, webgpu };
}

async function collectCanvasFingerprint() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 420;
    canvas.height = 140;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { supported: false };

    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 420, 140);
    ctx.fillStyle = "#069";
    ctx.font = "18px Arial";
    ctx.fillText("Am I a Bot canvas 1.0", 18, 36);
    ctx.fillStyle = "rgba(102, 204, 0, 0.65)";
    ctx.font = "32px Georgia";
    ctx.fillText("Fingerprint", 18, 82);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgb(255,0,255)";
    ctx.beginPath();
    ctx.arc(320, 55, 45, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.fillStyle = "rgb(0,255,255)";
    ctx.beginPath();
    ctx.arc(355, 85, 45, 0, Math.PI * 2, true);
    ctx.fill();

    const dataUrl = canvas.toDataURL();
    return { supported: true, hash: await sha256(dataUrl), dataUrlLength: dataUrl.length };
  } catch (error) {
    return { supported: false, hashError: String(error && error.message ? error.message : error) };
  }
}

async function collectWebglFingerprint() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return { supported: false };

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const extensions = gl.getSupportedExtensions() || [];
    const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic") || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic") || gl.getExtension("MOZ_EXT_texture_filter_anisotropic");

    const params = {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxCubeMapTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
      maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      maxVertexTextureImageUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      aliasedLineWidthRange: Array.from(gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) || []),
      aliasedPointSizeRange: Array.from(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || []),
      maxAnisotropy: anisotropy ? gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : null
    };

    return {
      supported: true,
      webgl2: Boolean(document.createElement("canvas").getContext("webgl2")),
      params,
      extensions,
      extensionsHash: await sha256(extensions.join("|")),
      fingerprintHash: await sha256(JSON.stringify({ params, extensions }))
    };
  } catch (error) {
    return { supported: false, error: String(error && error.message ? error.message : error) };
  }
}

async function collectAudioFingerprint() {
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineCtx) return { supported: false };
  try {
    const context = new OfflineCtx(1, 5000, 44100);
    const oscillator = context.createOscillator();
    const compressor = context.createDynamicsCompressor();

    oscillator.type = "triangle";
    oscillator.frequency.value = 10000;
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;

    oscillator.connect(compressor);
    compressor.connect(context.destination);
    oscillator.start(0);

    const buffer = await promiseWithTimeout(context.startRendering(), 2000, "Audio render timeout");
    const samples = Array.from(buffer.getChannelData(0).slice(4500, 5000));
    const sum = samples.reduce((acc, value) => acc + Math.abs(value), 0);
    return {
      supported: true,
      sum,
      hash: await sha256(samples.map((value) => value.toFixed(8)).join(","))
    };
  } catch (error) {
    return { supported: false, error: String(error && error.message ? error.message : error) };
  }
}

async function collectFontFingerprint() {
  try {
    const testFonts = [
      "Arial", "Arial Black", "Calibri", "Cambria", "Candara", "Comic Sans MS", "Consolas", "Courier New",
      "Georgia", "Helvetica", "Impact", "Lucida Console", "Menlo", "Monaco", "Palatino", "Segoe UI",
      "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana", "Wingdings", "Roboto", "Noto Sans", "San Francisco"
    ];
    const baseFonts = ["monospace", "sans-serif", "serif"];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const text = "mmmmmmmmmmlliWW@@@12345";
    const size = "72px";
    const baseline = {};

    for (const base of baseFonts) {
      ctx.font = `${size} ${base}`;
      baseline[base] = ctx.measureText(text).width;
    }

    const detected = [];
    for (const font of testFonts) {
      const found = baseFonts.some((base) => {
        ctx.font = `${size} '${font}', ${base}`;
        return ctx.measureText(text).width !== baseline[base];
      });
      if (found) detected.push(font);
    }

    return { supported: true, detected, count: detected.length, hash: await sha256(detected.join("|")) };
  } catch (error) {
    return { supported: false, error: String(error && error.message ? error.message : error) };
  }
}

async function collectCssMediaFingerprint() {
  const queries = [
    "(prefers-color-scheme: dark)",
    "(prefers-color-scheme: light)",
    "(prefers-reduced-motion: reduce)",
    "(prefers-contrast: more)",
    "(forced-colors: active)",
    "(hover: hover)",
    "(pointer: fine)",
    "(pointer: coarse)",
    "(any-pointer: fine)",
    "(display-mode: browser)",
    "(dynamic-range: high)"
  ];
  const values = Object.fromEntries(queries.map((query) => [query, matchMedia(query).matches]));
  return { supported: true, values, hash: await sha256(JSON.stringify(values)) };
}

async function collectWebGpuFingerprint() {
  if (!navigator.gpu?.requestAdapter) return { supported: false };
  try {
    const adapter = await promiseWithTimeout(navigator.gpu.requestAdapter(), 1500, "WebGPU adapter timeout");
    if (!adapter) return { supported: true, adapter: null };
    const info = adapter.info ? copyPlain(adapter.info) : adapter.requestAdapterInfo ? await safeAsync(() => adapter.requestAdapterInfo()) : null;
    return {
      supported: true,
      adapterInfo: copyPlain(info),
      features: adapter.features ? Array.from(adapter.features) : [],
      limits: adapter.limits ? copyPlain(adapter.limits) : null
    };
  } catch (error) {
    return { supported: true, error: String(error && error.message ? error.message : error) };
  }
}
