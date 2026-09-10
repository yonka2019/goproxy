// Pure helpers. No platform APIs here so they run under `node --test`.

const EXPLICIT_SCHEME = /^(mailto|data|javascript|tel|blob|about|file):/i;
const HAS_SCHEME_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//i;
const SKIP = /^(#|\/\/#|mailto:|tel:|data:|javascript:|blob:|about:)/i;
const DOTTED_QUAD = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Hosts we refuse to fetch: loopback, private, link-local, internal TLDs. */
export function isBlockedHost(hostname) {
  // A trailing dot is a valid FQDN ("localhost.") and would slip past the name checks.
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // Numeric hosts that are not a plain decimal dotted quad still resolve to IPv4
  // (2130706433, 0x7f000001, 0177.0.0.1). Refuse them instead of decoding each form.
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+))*$/.test(h) && !DOTTED_QUAD.test(h)) return true;
  if (DOTTED_QUAD.test(h) && /(^|\.)0\d/.test(h)) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7 unique-local
  if (/^fe80:/.test(h)) return true;             // link-local
  const m = h.match(DOTTED_QUAD);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true;      // AWS/GCP metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                    // multicast + reserved
  }
  return false;
}

/** Normalize user input into a fetchable http(s) URL, or explain why not. */
export function validateTarget(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { error: 'Enter a link.' };
  const candidate = HAS_SCHEME_SLASHES.test(s) || EXPLICIT_SCHEME.test(s) ? s : 'https://' + s;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { error: 'Not a valid link.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: `Only http and https links work here (got "${url.protocol}").` };
  }
  if (isBlockedHost(url.hostname)) {
    return { error: `Blocked address: ${url.hostname}` };
  }
  return { url: url.href };
}

// The target rides in the path, not the query string: a GET form replaces the
// action's whole query with its own fields, which would wipe out ?url=... and
// break every search box on every site.
// Only characters that would change how the URL parses are escaped; "/", ":",
// "?", "&" and "=" stay literal so form parameters can append cleanly.
const UNSAFE_IN_PATH = /[ "'<>`{}|\^,#]/g;

export function encodeTarget(absolute) {
  return absolute.replace(UNSAFE_IN_PATH, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

/** Absolute URL -> a link back through this proxy. Left alone for non-navigable schemes. */
export function proxify(raw, base, origin = '') {
  if (raw == null) return raw;
  const v = String(raw).trim();
  if (!v || SKIP.test(v)) return raw;
  try {
    return `${origin}/proxy/${encodeTarget(new URL(v, base).href)}`;
  } catch {
    return raw;
  }
}

/**
 * Pull the target out of a proxy request URL. Accepts the path form
 * (/proxy/https://site/x?a=1, what rewritten pages use) and the legacy
 * query form (/proxy?url=...), which the address bar still produces.
 */
export function targetFromRequestUrl(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return '';
  }
  if (url.pathname === '/proxy' || url.pathname === '/proxy/') return url.searchParams.get('url') || '';
  if (!url.pathname.startsWith('/proxy/')) return '';

  // Servers and browsers collapse the "//" after the scheme; put it back.
  const rest = decodeURIComponent(url.pathname.slice('/proxy/'.length)).replace(/^(https?:)\/*/i, '$1//');
  return rest + url.search;
}

/** srcset is "url 1x, url 2x" - proxy each URL, keep each descriptor. */
export function proxifySrcset(value, base, origin = '') {
  return String(value)
    .split(',')
    .map((part) => {
      const t = part.trim();
      if (!t) return '';
      const i = t.search(/\s/);
      return i === -1 ? proxify(t, base, origin) : proxify(t.slice(0, i), base, origin) + t.slice(i);
    })
    .filter(Boolean)
    .join(', ');
}

// ponytail: regex CSS rewrite - misses url() inside strings/comments. Swap for a
// tokenizer only if a real site visibly breaks.
export function rewriteCss(text, base, origin = '') {
  return String(text)
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, q, u) => `url(${q}${proxify(u, base, origin)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (_m, q, u) => `@import ${q}${proxify(u, base, origin)}${q}`);
}

// Content types a browser is expected to display rather than save.
const INLINE_TYPES = /^(text\/|image\/|video\/|audio\/|font\/|application\/(javascript|ecmascript|json|xml|xhtml\+xml|pdf|manifest\+json|wasm))/;

export function isInlineType(contentType) {
  return INLINE_TYPES.test(String(contentType || '').toLowerCase().split(';')[0].trim());
}

/** Last path segment of a URL, for naming a download. "" when there is none. */
export function filenameFrom(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    return /[\/:*?"<>|]/.test(name) ? '' : name;
  } catch {
    return '';
  }
}
