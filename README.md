# GoProxy

Type any link, the site opens inside the page.

## Run

```
npm install
npm run dev      # http://localhost:8788
npm test
```

## Deploy (Cloudflare Pages)

Build command `npm run build`, output directory `dist`. No config file needed — Pages compiles `functions/` on its own.

Or from the CLI: `npm run deploy`.

## Layout

| Path | Does |
|---|---|
| `public/index.html` | Whole UI. Tailwind via CDN, no build step. |
| `functions/proxy.js` | `/proxy?url=…` — fetches the site, strips frame-blocking headers, rewrites links back through itself. |
| `src/lib.js` | URL validation + rewriting helpers. Pure, tested. |
| `build.mjs` | Copies `public/` to `dist/`. |

## Limits

- ⚠ No auth. Anyone with the URL proxies anything through your Cloudflare account.
- ⚠ Proxied pages run on this origin, so their scripts share it with this page. Keep nothing sensitive here.
- Cookies from proxied sites are dropped — logins do not persist.
- JS-heavy apps that fetch at runtime partly break; static and content sites work.
- Requests time out at 15s.
