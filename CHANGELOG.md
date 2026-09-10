# Changelog

## [v0.1.0] : 2026-09-10

- First release.
- Page with one URL field; the entered site renders in an iframe below it.
- `/proxy?url=…` Cloudflare Pages Function: fetches the target, strips `X-Frame-Options` and CSP so the iframe is allowed, rewrites `href/src/srcset/action/style`, inline `<style>` and `text/css` bodies back through the proxy.
- SSRF guard: http/https only; loopback, private, link-local, CGNAT and cloud-metadata addresses refused, re-checked after redirects.
- 15s upstream timeout. `Set-Cookie` and CSP headers dropped from responses.
- UI: Enter submits, Paste button, auto `https://` prefix, loading and error states, dark/light, reduced-motion respected.
- Build is `public/` → `dist/`; no bundler, no `wrangler.toml`, no runtime dependencies.
- Tests: `npm test` (`node --test`), 9 cases over URL validation and rewriting.
