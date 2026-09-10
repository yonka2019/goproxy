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
| `src/worker.js` | Entry. `/proxy/<url>` fetches the site, strips frame-blocking headers, forwards `Range` for video and cookies, names downloads, rewrites links back through itself; everything else falls through to the assets. |
| `src/lib.js` | URL validation + rewriting helpers. Pure, tested. |
| `build.mjs` | Copies `public/` to `dist/` (what the Worker serves as assets). |
| `wrangler.jsonc` | Worker name, entry script, assets directory. |

## Notes

- The target rides in the path: `/proxy/https://example.com/page`. A GET form replaces the
  action's query string, so `?url=` would be wiped by any search box. `/proxy?url=…` still works.
- Video seeking, range requests and downloads with real filenames all work.
- Cookies work. Each one is stored as `<domain>~<name>` on this origin and sent only to hosts
  that domain covers, so one site cannot read another's session.

## Limits

- ⚠ No auth. Anyone with the URL proxies anything through your Cloudflare account.
- ⚠ Proxied pages run on this origin, so their scripts share it with this page. Keep nothing sensitive here.
- ⚠ Cookies are per-site upstream, but every proxied page shares this origin's `document.cookie`,
  so a proxied script can read another site's non-`HttpOnly` cookies. Do not log in to anything you care about.
- JS-heavy apps that fetch at runtime partly break; static and content sites work.
- Google search may still show its bot check: one IP for every visitor.
- Some sites block proxies outright (chatgpt.com, amazon.com, stackoverflow.com).
- Requests time out at 15s.
