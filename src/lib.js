// Pure helpers. No platform APIs here so they run under `node --test`.

const EXPLICIT_SCHEME = /^(mailto|data|javascript|tel|blob|about|file):/i;
const HAS_SCHEME_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//i;
const SKIP = /^(#|\/\/#|mailto:|tel:|data:|javascript:|blob:|about:)/i;

/** Hosts we refuse to fetch: loopback, private, link-local, internal TLDs. */
export function isBlockedHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7 unique-local
  if (/^fe80:/.test(h)) return true;             // link-local
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
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

/** Absolute URL -> a link back through this proxy. Left alone for non-navigable schemes. */
export function proxify(raw, base, origin = '') {
  if (raw == null) return raw;
  const v = String(raw).trim();
  if (!v || SKIP.test(v)) return raw;
  try {
    return `${origin}/proxy?url=${encodeURIComponent(new URL(v, base).href)}`;
  } catch {
    return raw;
  }
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
