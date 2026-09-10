# GoProxy

Type any link, the site opens inside the page.

## Run

```
npm install
npm run dev      # http://localhost:8788
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
| `src/worker.js` | Entry. `/proxy?url=…` fetches the site, strips frame-blocking headers, rewrites links back through itself; everything else falls through to the assets. |
| `src/lib.js` | URL validation + rewriting helpers. Pure, tested. |
| `build.mjs` | Copies `public/` to `dist/` (what the Worker serves as assets). |
| `wrangler.jsonc` | Worker name, entry script, assets directory. |

## Limits

- ⚠ No auth. Anyone with the URL proxies anything through your Cloudflare account.
- ⚠ Proxied pages run on this origin, so their scripts share it with this page. Keep nothing sensitive here.
- Cookies from proxied sites are dropped — logins do not persist.
- JS-heavy apps that fetch at runtime partly break; static and content sites work.
- Requests time out at 15s.
