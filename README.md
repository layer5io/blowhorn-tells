# Blowhorn Tells

**Am I a Bot?** A free check of what websites can see about your browser: the bot-detection and fingerprinting signals a site can read, explained in plain words.

It runs at [tells.blowhorn.ai](https://tells.blowhorn.ai) as one Cloudflare Worker with static assets. Use it to test your own browser, or point your Playwright, Puppeteer, Selenium or extension script at it and read the JSON result.

## What it checks

**Server.** Request headers (sensitive values redacted), client IP and Cloudflare connection data (country, colo, ASN, protocol, RTT), proxy-style headers (`Forwarded`, `Via`, `X-Forwarded-*` and similar), a datacenter ASN heuristic, optional IP intelligence for proxy, VPN, Tor and datacenter addresses, and managed bot fields when enabled.

**Browser.** `navigator` facts and client hints, permissions, storage, screen and viewport, locale and timezone, automation globals and headless markers, prototype and getter checks, plugin consistency, canvas, WebGL, audio, font and CSS media fingerprints, WebGPU, `performance.memory`, Resource Timing, DRM, speech voices, Permissions Policy, sensors, media constraints, known extension probes, WebRTC candidates and browser-to-edge latency.

**Cross-context consistency.** The same facts read in the window, a Web Worker, a Service Worker and a same-origin iframe must agree, and the request headers must agree with what the browser reports.

**Behavior.** A transparent score from pointer, key, scroll, focus and frame timing, plus an optional interaction challenge.

## API for scripts

Server-only quick check, useful from Node or curl:

```bash
curl https://tells.blowhorn.ai/api/check
```

| Route | Method | Returns |
|---|---|---|
| `/api/check` | GET | Server-side signals and a verdict |
| `/api/ping` | GET | Latency sample (the page calls it while it collects) |
| `/api/report` | POST | Full verdict for a client report the page collected |

API routes are rate limited at the Worker edge by route and client IP (30 calls a minute by default).

## Develop

Node 24 and corepack.

```bash
make setup   # corepack enable && pnpm install --frozen-lockfile
make dev     # wrangler dev
make test    # syntax check, unit tests, Worker end-to-end tests
```

Service Worker checks need a secure context; `localhost` counts as one in current browsers.

## Deploy

`master` deploys through `.github/workflows/deploy.yml` when the repository has `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. Without them the workflow says so and deploys nothing. The Worker serves the `tells.blowhorn.ai` custom domain (`wrangler.json`).

## IP intelligence providers

The default provider is `ipapi.is`, called from the Worker. Anonymous use covers light traffic; for more, set a Worker secret:

```bash
pnpm wrangler secret put IPAPI_IS_KEY
```

| `IP_INTEL_PROVIDER` | Secret | Notes |
|---|---|---|
| `ipapi` | optional `IPAPI_IS_KEY` | Default. Returns `is_datacenter`, `is_proxy`, `is_vpn`, `is_tor` |
| `ipinfo` | `IPINFO_TOKEN` | IPinfo privacy endpoint |
| `ipqs` | `IPQUALITYSCORE_KEY` | IPQualityScore proxy and VPN API |
| `none` | none | No external IP intelligence |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Derived from [Am I a Bot?](https://github.com/nicholasgriffintn/amiabot.app).
