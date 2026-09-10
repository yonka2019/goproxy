# GoProxy — notes for Claude

URL-entry page that renders any site in an iframe via a server-side proxy.

## Stack

Plain JS + HTML on a **Cloudflare Worker**. No framework, no bundler, one dev dependency
(wrangler). `wrangler.jsonc` is not optional: a Worker loads exactly the one script `main`
names.

This started as a Pages project with `functions/proxy.js`. That folder is a Pages-only
convention — a Worker never scans it, so `/proxy` returned 404 while the static page loaded
fine. The dashboard no longer offers Pages projects, so the code moved into a single Worker
entry instead. Do not reintroduce `functions/`.

## Why a server function exists

The browser cannot do this alone: sites send `X-Frame-Options` / `CSP frame-ancestors`
that block iframing, and CORS blocks reading their HTML. `src/worker.js` strips
those headers, so it is required — do not "simplify" it away.

## Files

- `public/index.html` — UI. Tailwind play CDN. Everything inline, one file.
- `src/worker.js` — entry. Routes `/proxy/<url>` itself, everything else to `env.ASSETS`. Carries
  cookies both ways (namespaced, see below). Uses
  `HTMLRewriter` (native Cloudflare API, not a library) to rewrite
  `href/src/srcset/action/style` back through the proxy.
- `src/lib.js` — pure helpers, no platform APIs, so `node --test` can run them.
- `test/lib.test.mjs` — `node --test`, plain `assert`, no framework.
- `build.mjs` — copies `public/` → `dist/`.

## Rules that hold here

- Keep `src/lib.js` free of Workers globals; that is what keeps it testable.
- Any rewriting change needs a case in `test/lib.test.mjs`.
- Rewritten URLs are **absolute** (worker origin). They must stay absolute: an injected
  `<base href>` points at the target site and would hijack root-relative ones.
- The target goes in the **path**, never back into a query parameter. A GET form replaces its
  action's entire query string, which silently deleted `?url=` and broke every search box.
- `Range` and the conditional headers must keep reaching upstream, and `206`/`304`/`204`/
  `HEAD` must skip rewriting — otherwise video seeking refetches whole files or corrupts.
- Cookies are namespaced `<domain>~<name>` on our origin and filtered per target host
  (`rewriteSetCookie` / `cookiesForHost`). Never pass them through raw: every site shares
  this one origin, so a raw jar hands site B the session cookies of site A.
- `cookieShim` is the page-side half and has to stay first in `<head>`: without it a site's
  own JS writes cookies the server then drops, and reads back names it never wrote.
- `cookieShim` is built with `String.raw`. A plain template literal eats `\s` and `\.`,
  which silently turns the shim's regexes into garbage that still parses.
- Request headers are a **blocklist** (`DROP_HEADERS`), not an allowlist. A request claiming
  to be Chrome with no `sec-ch-ua` / `sec-fetch-*` is a bot signal. `Referer` is rewritten by
  `proxiedReferer`, never forwarded raw - it would name this proxy.
- Google search is out of reach: its script reads the page hostname, does not find
  `google.com`, and the reload it fires gets a 429. Not a bug to fix, so `swapUnproxyable`
  answers `google.*/search?q=` with Bing. Only that path - the rest of Google proxies fine.
- SSRF blocklist in `isBlockedHost` covers loopback/private/link-local/metadata IPs plus
  encoded forms (`2130706433`, `0x7f000001`, `0177.0.0.1`, trailing-dot hosts). Do not loosen it.
- Redirects are re-validated after `fetch` (`upstream.url`), not only up front.

## Verify

```
npm test
npm run dev   # http://127.0.0.1:8787
curl "http://127.0.0.1:8787/proxy/https://github.com" -D - -o /dev/null   # no x-frame-options in output
curl "http://127.0.0.1:8787/proxy/https://www.google.com" -D - -o /dev/null   # set-cookie: google.com~...
```
