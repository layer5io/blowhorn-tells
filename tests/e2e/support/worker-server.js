import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../../../src/worker.js";

const port = Number(process.env.E2E_PORT || 8788);
const host = "127.0.0.1";
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const publicRoot = join(repoRoot, "public");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (nodeRequest, nodeResponse) => {
  try {
    const body = await readNodeRequestBody(nodeRequest);
    const request = new Request(`http://${host}:${port}${nodeRequest.url}`, {
      method: nodeRequest.method,
      headers: normalizeNodeHeaders(nodeRequest.headers),
      body
    });
    const response = await worker.fetch(request, createWorkerEnv(), {});
    await sendResponse(nodeResponse, response);
  } catch (error) {
    nodeResponse.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    nodeResponse.end(String(error?.stack || error));
  }
});

server.listen(port, host, () => {
  console.log(`Amiabot test Worker listening on http://${host}:${port}`);
});

function createWorkerEnv() {
  return {
    IP_INTEL_PROVIDER: "none",
    API_RATE_LIMITER: {
      async limit() {
        return { success: true };
      }
    },
    ASSETS: {
      fetch: serveAsset
    }
  };
}

async function serveAsset(request) {
  const url = new URL(request.url);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const decoded = decodeURIComponent(pathname);
  const filePath = normalize(join(publicRoot, decoded));
  const relativePath = relative(publicRoot, filePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const content = await readFile(filePath);
    return new Response(content, {
      headers: {
        "content-type": CONTENT_TYPES[extname(filePath)] || "application/octet-stream"
      }
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function normalizeNodeHeaders(headers) {
  const out = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) out.append(name, item);
    } else if (value != null) {
      out.set(name, value);
    }
  }
  return out;
}

async function readNodeRequestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function sendResponse(nodeResponse, response) {
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, name) => {
    nodeResponse.setHeader(name, value);
  });

  if (!response.body) {
    nodeResponse.end();
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  nodeResponse.end(buffer);
}
