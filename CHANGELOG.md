# Changelog

## [v0.6.0] : 2026-09-10

- Single-page apps hydrate again. A site's router calls `history.pushState` with its own origin
  plus `location.pathname`, which here reads `/proxy/https://site/page`; the browser refuses a
  state URL on another origin and the throw lands inside the router, so rendering stops. On
  13tv that is why the video player never mounted and nothing played. `historyShim` maps
  whatever the site passes onto a `/proxy/` URL of ours, which is same-origin and allowed.
- Worker logs are on and persisted, so requests can be queried in the dashboard under
  Workers & Pages -> goproxy -> Logs. ⚠ A logged request URL carries the whole proxied
  target, so the log records every site each visitor opened.

## [v0.5.0] : 2026-09-10

- `document.cookie` inside a proxied page now reads and writes the target's own cookie names.
  The v0.4.0 namespacing had broken it both ways: a site's own script wrote cookies the server
  then dropped, and read back names wearing a `<domain>~` prefix. Google's bot check was the
  visible casualty - its script stores SG_SS, reloads with `?sg_ss=<token>`, and the cookie
  never arrived.
- Request headers are forwarded by blocklist instead of an allowlist of seven. A request
  claiming to be Chrome while sending none of Chrome's client hints or `sec-fetch-*` reads as
  a bot. `Referer` is rewritten to the target's real URL; `Sec-Fetch-Dest: iframe` goes out as
  `document` so sites do not refuse the embed at the header level.
- A Google search now quietly returns Bing results. Google's search cannot be proxied at all:
  its script compares the page's hostname against `google.com`, does not find it, and the
  reload it fires answers 429 - same browser, same IP, direct to Google: 200. Only
  `google.*/search?q=` is swapped; the rest of Google proxies normally. The address bar keeps
  the Google URL, the results are Bing's.

## [v0.4.0] : 2026-09-10

- Cookies now work. They used to be dropped in both directions - `set-cookie` was stripped
  with the frame-blocking headers and `cookie` was never forwarded - so every request looked
  like a first visit, no login survived a click and Google answered "cookies are disabled".
- Each cookie is stored on our own origin as `<domain>~<name>` and handed only to hosts that
  domain covers. A raw pass-through would have given one site another site's session, because
  every proxied page shares this single origin. Parent-domain cookies still reach subdomains.
- ⚠ Still shared: `document.cookie`. A proxied script can read another site's non-`HttpOnly`
  cookies. Per-site isolation needs per-site subdomains; do not log in to anything you value.
- Cookies set on a redirect hop are still lost - `fetch` uses `redirect: 'follow'`, which
  returns only the final response's headers.
- Docs: dev URL is `http://127.0.0.1:8787` (wrangler's default; both README and CLAUDE.md said
  8788), and CLAUDE.md no longer points at the removed `functions/proxy.js`.

## [v0.3.0] : 2026-09-10

- The target now travels in the path (`/proxy/https://site/page`) instead of `?url=`. A GET
  form replaces its action's whole query string, so `?url=` was wiped the moment anyone used
  a search box - every search on every proxied site returned "Cannot load this link".
  `/proxy?url=...` still works, so the address bar and older links keep working.
- Forward `Range`, `If-Range`, `If-None-Match` and `If-Modified-Since` upstream, and pass
  `206`/`304`/`204` and `HEAD` through untouched. Without this every video seek refetched the
  whole file; seeking now works.
- Downloads keep their real filename: when upstream sends no `Content-Disposition` and the
  type is not one browsers display, one is added from the URL. Files used to save as "proxy".
- The loading overlay now lifts when the document is parsed, not on the iframe `load` event.
  Sites that hold a connection open (Google) never fire `load`, so the page sat behind a white
  veil that looked like broken images.
- Replaced the Paste button with Back and Forward. History is rebuilt from the iframe's own
  location, so links clicked inside a proxied page are tracked too.
- Fixed the build deleting `dist/` before copying, which threw `EBUSY` on Windows whenever a
  dev server held the folder - the build failed and the server silently never started.

## [v0.2.0] : 2026-09-10

- Deploy target changed from Cloudflare Pages to a Cloudflare Worker. The dashboard no longer
  offers Pages projects, and `functions/` is a Pages-only convention: deployed as a Worker the
  static page loaded but every `/proxy` request returned 404.
- `functions/proxy.js` is now `src/worker.js`, a single entry that routes `/proxy` itself and
  passes everything else to the assets binding.
- Added `wrangler.jsonc`. A Worker loads exactly the one script `main` names, so this file is
  required — Pages was the only configless option.
- `npm run dev` / `npm run deploy` now use `wrangler dev` / `wrangler deploy`.
- SSRF blocklist hardened: rejects trailing-dot hosts (`localhost.`), decimal, hex and octal
  IPv4 encodings (`2130706433`, `0x7f000001`, `0177.0.0.1`, `0`) and numeric hosts that are not
  a dotted quad.
- Removed the recent-links list; nothing is written to `localStorage` any more.
- README and CLAUDE.md document the Pages-vs-Workers trap.

## [v0.1.0] : 2026-09-10

- First release.
- Page with one URL field; the entered site renders in an iframe below it.
- `/proxy?url=…` Cloudflare Pages Function: fetches the target, strips `X-Frame-Options` and CSP so the iframe is allowed, rewrites `href/src/srcset/action/style`, inline `<style>` and `text/css` bodies back through the proxy.
- SSRF guard: http/https only; loopback, private, link-local, CGNAT and cloud-metadata addresses refused, re-checked after redirects.
- 15s upstream timeout. `Set-Cookie` and CSP headers dropped from responses.
- UI: Enter submits, Paste button, auto `https://` prefix, loading and error states, dark/light, reduced-motion respected.
- Build is `public/` → `dist/`; no bundler, no `wrangler.toml`, no runtime dependencies.
- Tests: `npm test` (`node --test`), 9 cases over URL validation and rewriting.
