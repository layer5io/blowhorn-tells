const JSON_CONTENT_HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};

export const JSON_HEADERS = {
  ...JSON_CONTENT_HEADERS,
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export const REPORT_JSON_HEADERS = {
  ...JSON_CONTENT_HEADERS,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function reportCorsHeaders(request) {
  const origin = request.headers.get("origin");
  if (!origin) return REPORT_JSON_HEADERS;

  try {
    if (new URL(origin).origin === new URL(request.url).origin) {
      return {
        ...REPORT_JSON_HEADERS,
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin"
      };
    }
  } catch (_) {
    return REPORT_JSON_HEADERS;
  }

  return REPORT_JSON_HEADERS;
}

export async function readJsonBody(request, maxBytes) {
  const text = await readBodyText(request, maxBytes);
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function json(value, status = 200, headers = {}, baseHeaders = JSON_HEADERS) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { ...baseHeaders, ...headers }
  });
}

// Refuse oversized bodies before buffering them: trust a declared Content-Length,
// and otherwise stop reading the stream as soon as it passes the limit.
async function readBodyText(request, maxBytes) {
  const tooLarge = () => new HttpError(413, `Request body too large. Max ${maxBytes} bytes.`);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
