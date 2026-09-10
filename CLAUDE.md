# GoProxy — notes for Claude

URL-entry page that renders any site in an iframe via a server-side proxy.

## Stack

Plain JS + HTML on **Cloudflare Pages**. No framework, no bundler, no `wrangler.toml`
(deliberate — Pages compiles `functions/` automatically; config lives in the dashboard:
build `npm run build`, output `dist`).

## Why a server function exists

The browser cannot do this alone: sites send `X-Frame-Options` / `CSP frame-ancestors`
that block iframing, and CORS blocks reading their HTML. `functions/proxy.js` strips
those headers, so it is required — do not "simplify" it away.

## Files

- `public/index.html` — UI. Tailwind play CDN. Everything inline, one file.
- `functions/proxy.js` — `/proxy?url=…`. Uses `HTMLRewriter` (native Cloudflare API,
  not a library) to rewrite `href/src/srcset/action/style` back through the proxy.
- `src/lib.js` — pure helpers, no platform APIs, so `node --test` can run them.
- `test/lib.test.mjs` — `node --test`, plain `assert`, no framework.
- `build.mjs` — copies `public/` → `dist/`.

## Rules that hold here

- Keep `src/lib.js` free of Workers globals; that is what keeps it testable.
- Any rewriting change needs a case in `test/lib.test.mjs`.
- Rewritten URLs are **absolute** (worker origin). They must stay absolute: an injected
  `<base href>` points at the target site and would hijack root-relative ones.
- SSRF blocklist in `isBlockedHost` covers loopback/private/link-local/metadata IPs.
  Do not loosen it.
- Redirects are re-validated after `fetch` (`upstream.url`), not only up front.

## Verify

```
npm test
npm run dev
curl "http://127.0.0.1:8788/proxy?url=https%3A%2F%2Fgithub.com" -D - -o /dev/null   # no x-frame-options in output
```
