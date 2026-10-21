# GoProxy

Type any link, the site opens inside the page.

## Run

```
npm install
npm run dev      # http://127.0.0.1:8787
npm test
```

## Deploy (Cloudflare Worker)

```
npx wrangler login   # once
npm run deploy
```

Or connect the repo in the dashboard: Workers & Pages -> your Worker -> Settings -> Build,
with build command `npm run build`.

`wrangler.jsonc` is required — a Worker runs exactly one entry script and `main` names it.

## Layout

| Path | Does |
|---|---|
| `public/index.html` | Whole UI. Tailwind via CDN, no build step. |
| `src/worker.js` | Entry. `/proxy/<url>` fetches the site (any method), strips frame-blocking headers, forwards `Range` for video and cookies, names downloads, rewrites links back through itself; everything else falls through to the assets. |
| `src/lib.js` | URL validation + rewriting helpers. Pure, tested. |
| `build.mjs` | Copies `public/` to `dist/` (what the Worker serves as assets). |
| `wrangler.jsonc` | Worker name, entry script, assets directory, log persistence. |

## Notes

- The target rides in the path: `/proxy/https://example.com/page`. A GET form replaces the
  action's query string, so `?url=` would be wiped by any search box. `/proxy?url=…` still works.
- Video seeking, range requests and downloads with real filenames all work.
- Cookies work. Each one is stored as `<domain>~<name>` on this origin and sent only to hosts
  that domain covers, so one site cannot read another's session. A shim makes `document.cookie`
  inside a proxied page read and write the target's own names.
- The browser's headers go upstream almost untouched, with `Referer` and `Origin` rewritten to
  the target's real URL and `Sec-Fetch-Dest: iframe` sent as `document`.
- Logins work: POST/PUT/PATCH/DELETE pass through, redirects return to the browser so their
  cookies stick, and a page's `fetch`/`XHR`/forms are routed through the proxy.
- `history.pushState` is shimmed so single-page routers do not throw on our path and stop
  hydrating - that is what kept video players from mounting.
- Clicks stay inside the page. `target="_blank"`/`_top`/`_parent` become `_self`, `window.open`
  navigates the frame (and is refused with no click behind it), `#anchor` scrolls instead of
  leaving, and links a site's JS built after load are proxied on click. A proxied page opened in
  a tab of its own reopens at `/?u=<target>`, back inside the UI.

## Limits

- ⚠ No auth. Anyone with the URL proxies anything through your Cloudflare account.
- ⚠ Proxied pages run on this origin, so their scripts share it with this page. Keep nothing sensitive here.
- ⚠ Cookies are per-site upstream, but every proxied page shares this origin's `document.cookie`,
  so a proxied script can read another site's non-`HttpOnly` cookies. Do not log in to anything you care about.
- WebSockets are not proxied. Media on a CORS-open CDN plays; a locked-down one does not.
- "Sign in with Google" and similar may refuse embedded/proxied browsers.
- Google search is answered by Bing. Google's own script checks the page's hostname, does not
  find `google.com`, and the reload it fires answers 429 - so `google.*/search?q=` is sent to
  Bing instead. The rest of Google proxies normally.
- Cloudflare adds `Cf-Worker:` to every outgoing fetch and a Worker cannot remove it, so
  bot-checking sites can tell the request came from a Worker.
- Some sites block proxies outright (chatgpt.com, amazon.com, stackoverflow.com).
- Requests time out at 15s.
