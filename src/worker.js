// Cloudflare Worker entry.
//   /proxy/<absolute url>      -> fetch the target, strip frame-blocking headers,
//                                 rewrite links so it keeps navigating through here
//                                 (/proxy?url=... still works for the address bar)
//   everything else            -> static assets from dist/
//
// A Worker has one entry script, so routing is explicit; there is no functions/
// folder to scan the way Cloudflare Pages does.

import { validateTarget, proxify, proxifySrcset, rewriteCss, isInlineType, filenameFrom, targetFromRequestUrl, cookiesForHost, rewriteSetCookie } from './lib.js';

const TIMEOUT_MS = 15000;
const CSS_MAX_BYTES = 2 * 1024 * 1024;

const STRIP_HEADERS = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'set-cookie', // dropped, then re-added namespaced per target host
  'report-to',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'content-encoding',
  'content-length',
];

// Range and the conditional headers are what make video seeking and browser
// caching work; without them every seek refetches the whole file.
const FORWARD_HEADERS = [
  'user-agent',
  'accept',
  'accept-language',
  'range',
  'if-range',
  'if-none-match',
  'if-modified-since',
];

const SRC_TAGS = 'script[src], img[src], iframe[src], frame[src], source[src], video[src], audio[src], embed[src], input[src], track[src]';

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    const isProxy = url.pathname === '/proxy' || url.pathname.startsWith('/proxy/');
    if (!isProxy) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    return handleProxy(request, url);
  },
};

async function handleProxy(request, url) {
  const origin = url.origin;
  const raw = targetFromRequestUrl(request.url);

  const target = validateTarget(raw);
  if (target.error) return errorPage(target.error, 400);

  const forwarded = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  if (!forwarded.has('user-agent')) forwarded.set('user-agent', 'Mozilla/5.0');
  if (!forwarded.has('accept')) forwarded.set('accept', '*/*');

  // Cookies: without them a site sees every request as a brand-new visitor, so
  // Google answers "cookies are disabled" and no login or consent choice sticks.
  // Only the jar belonging to this host is handed over (see cookiesForHost).
  const jar = cookiesForHost(request.headers.get('cookie'), new URL(target.url).hostname);
  if (jar) forwarded.set('cookie', jar);

  let upstream;
  try {
    upstream = await fetch(target.url, {
      method: request.method,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: forwarded,
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
  for (const raw of upstream.headers.getSetCookie()) {
    const cookie = rewriteSetCookie(raw, new URL(base).hostname);
    if (cookie) headers.append('set-cookie', cookie);
  }
  const type = (headers.get('content-type') || '').toLowerCase();

  // Downloads: the browser would otherwise name the file after our own path and
  // save it as "proxy". Only touch types it would not have displayed anyway.
  if (!headers.has('content-disposition') && !isInlineType(type)) {
    const name = filenameFrom(base);
    if (name) headers.set('content-disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
  }

  // 204/304 and HEAD carry no body, and a partial response is a slice of bytes -
  // rewriting either would corrupt it.
  const bodyless = request.method === 'HEAD' || upstream.status === 204 || upstream.status === 304;
  const partial = upstream.status === 206;
  if (bodyless) return new Response(null, { status: upstream.status, headers });
  if (partial) return new Response(upstream.body, { status: 206, headers });

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
