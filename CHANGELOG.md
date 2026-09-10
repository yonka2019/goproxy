# Changelog

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
