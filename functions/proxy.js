// Cloudflare Pages Function -> route: /proxy?url=<absolute url>
// Fetches the target, strips frame-blocking headers, rewrites links so the
// proxied page keeps navigating through here.

import { validateTarget, proxify, proxifySrcset, rewriteCss } from '../src/lib.js';

const TIMEOUT_MS = 15000;
const CSS_MAX_BYTES = 2 * 1024 * 1024;

const STRIP_HEADERS = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'set-cookie',
  'report-to',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'content-encoding',
  'content-length',
];

const SRC_TAGS = 'script[src], img[src], iframe[src], frame[src], source[src], video[src], audio[src], embed[src], input[src], track[src]';

export async function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;
  const raw = new URL(request.url).searchParams.get('url');

  const target = validateTarget(raw);
  if (target.error) return errorPage(target.error, 400);

  let upstream;
  try {
    upstream = await fetch(target.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': request.headers.get('user-agent') || 'Mozilla/5.0',
        accept: request.headers.get('accept') || '*/*',
        'accept-language': request.headers.get('accept-language') || 'en-US,en;q=0.9',
      },
    });
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? 'Timed out after 15s.' : `Could not reach it: ${err?.message || err}`;
    return errorPage(msg, 502);
  }

  // A redirect can land somewhere we would have refused up front.
  const base = upstream.url || target.url;
  if (validateTarget(base).error) return errorPage('Redirected to a blocked address.', 400);

  const headers = new Headers(upstream.headers);
  for (const h of STRIP_HEADERS) headers.delete(h);
  const type = (headers.get('content-type') || '').toLowerCase();

  if (type.includes('text/html')) {
    return rewriteHtml(new Response(upstream.body, { status: upstream.status, headers }), base, origin);
  }

  if (type.includes('text/css')) {
    const len = Number(upstream.headers.get('content-length') || 0);
    if (len > CSS_MAX_BYTES) return new Response(upstream.body, { status: upstream.status, headers });
    const css = rewriteCss(await upstream.text(), base, origin);
    return new Response(css, { status: upstream.status, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

function rewriteHtml(response, base, origin) {
  const attr = (names) => ({
    element(el) {
      for (const name of names) {
        const v = el.getAttribute(name);
        if (v !== null) el.setAttribute(name, proxify(v, base, origin));
      }
    },
  });

  return new HTMLRewriter()
    .on('a[href], area[href], link[href]', attr(['href']))
    .on(SRC_TAGS, attr(['src']))
    .on('form[action]', attr(['action']))
    .on('object[data]', attr(['data']))
    .on('video[poster]', attr(['poster']))
    .on('img[srcset], source[srcset]', {
      element(el) {
        el.setAttribute('srcset', proxifySrcset(el.getAttribute('srcset'), base, origin));
      },
    })
    // SRI hashes and CSP nonces no longer match once we rewrite and drop CSP.
    .on('script, link', {
      element(el) {
        el.removeAttribute('integrity');
        el.removeAttribute('nonce');
      },
    })
    .on('meta[http-equiv]', {
      element(el) {
        if ((el.getAttribute('http-equiv') || '').toLowerCase() === 'content-security-policy') el.remove();
      },
    })
    .on('style', new StyleText(base, origin))
    .on('[style]', {
      element(el) {
        el.setAttribute('style', rewriteCss(el.getAttribute('style'), base, origin));
      },
    })
    // Safety net: anything we missed resolves against the real site instead of us.
    // Our own rewrites are absolute, so <base> cannot hijack them.
    .on('head', {
      element(el) {
        el.prepend(`<base href="${escapeAttr(base)}">`, { html: true });
      },
    })
    .transform(response);
}

/** <style> text arrives in chunks; rewrite once the whole node is in hand. */
class StyleText {
  constructor(base, origin) {
    this.base = base;
    this.origin = origin;
    this.buf = '';
  }
  text(chunk) {
    this.buf += chunk.text;
    if (chunk.lastInTextNode) {
      chunk.replace(rewriteCss(this.buf, this.base, this.origin), { html: true });
      this.buf = '';
    } else {
      chunk.remove();
    }
  }
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Rendered inside the iframe, so it has to read like a page, not JSON. */
function errorPage(message, status) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cannot load</title>
<style>:root{color-scheme:light dark}body{margin:0;display:grid;place-items:center;min-height:100vh;font:15px/1.5 system-ui,sans-serif;padding:24px;text-align:center}p{max-width:40ch;color:#888}</style>
<div><h1 style="font-size:17px;margin:0 0 8px">Cannot load this link</h1><p>${escapeAttr(message)}</p></div>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
