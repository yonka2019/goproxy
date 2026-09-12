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

// Same escape table as encodeTarget, as a snippet the page-side shims share.
const ENC_JS = String.raw`function enc(u){return u.replace(/[ "'<>` + '`' + String.raw`{}|\^,#]/g,function(c){return "%"+c.charCodeAt(0).toString(16).toUpperCase()})}`;

// Some SDKs refuse to run unless they are served from their own domain. Google's
// IMA/PAL throws "IMA SDK is either not loaded from a google domain or is not a
// supported version" and the throw takes the whole React tree with it - 13tv shows
// Next's "Application error" instead of the article. Leave those pointing at the
// real host; a <script> needs no CORS, so it still loads.
const DIRECT_HOSTS = /(^|\.)(imasdk\.googleapis\.com|pagead2\.googlesyndication\.com|securepubads\.g\.doubleclick\.net)$/;

/** Absolute URL -> a link back through this proxy. Left alone for non-navigable schemes. */
export function proxify(raw, base, origin = '') {
  if (raw == null) return raw;
  const v = String(raw).trim();
  if (!v || SKIP.test(v)) return raw;
  try {
    const u = new URL(v, base);
    if (DIRECT_HOSTS.test(u.hostname)) return u.href;
    return `${origin}/proxy/${encodeTarget(u.href)}`;
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

// Cookies. Every proxied site shares this one origin, so a raw pass-through would
// hand site B the session cookies of site A. Each cookie is stored under the
// domain that set it - "<domain>~<name>" - and only handed back to hosts that
// domain would have matched. "~" is a legal cookie-name character and never
// appears in a hostname, so the first one is always the separator.
const NS = '~';
const COOKIE_NAME = /^[\w!#$%&'*+.^`|~-]+$/;
const COOKIE_DOMAIN = /^[a-z0-9.-]+$/;

const domainMatches = (host, domain) => host === domain || host.endsWith('.' + domain);

/** The domain a Set-Cookie applies to: its own Domain= if it may claim it, else the host. */
export function cookieDomain(setCookie, host) {
  const m = /;\s*domain\s*=\s*\.?([^;]*)/i.exec(setCookie);
  const d = m && m[1].trim().toLowerCase().replace(/\.+$/, '');
  return d && COOKIE_DOMAIN.test(d) && domainMatches(host, d) ? d : host;
}

/**
 * One upstream Set-Cookie -> one for our own origin. Domain and Path are dropped:
 * the target's paths live under /proxy/... here, so the cookie has to cover "/".
 * Returns null for anything unparseable rather than storing a broken cookie.
 */
export function rewriteSetCookie(setCookie, host) {
  const s = String(setCookie);
  const eq = s.indexOf('=');
  const semi = s.indexOf(';');
  if (eq < 1 || (semi !== -1 && semi < eq)) return null;
  const name = s.slice(0, eq).trim();
  if (!COOKIE_NAME.test(name)) return null;
  const parts = s.slice(eq + 1).split(';');
  const value = parts.shift().trim();
  const attrs = parts.map((p) => p.trim()).filter((p) => p && !/^(domain|path)\s*=/i.test(p));
  return [`${cookieDomain(s, host)}${NS}${name}=${value}`, 'Path=/', ...attrs].join('; ');
}

/** Our namespaced jar -> the Cookie header this host is allowed to see. */
export function cookiesForHost(cookieHeader, host) {
  const h = String(host).toLowerCase();
  return String(cookieHeader || '')
    .split(';')
    .map((pair) => {
      const c = pair.trim();
      const eq = c.indexOf('=');
      if (eq < 1) return null;
      const key = c.slice(0, eq);
      const i = key.indexOf(NS);
      if (i < 1) return null;
      const domain = key.slice(0, i).toLowerCase();
      const name = key.slice(i + 1);
      if (!name || !COOKIE_DOMAIN.test(domain) || !domainMatches(h, domain)) return null;
      return `${name}=${c.slice(eq + 1)}`;
    })
    .filter(Boolean)
    .join('; ');
}

/**
 * Page-side half of the cookie work. Everything a proxied page writes with
 * `document.cookie` lands on our origin unnamespaced, so the server drops it -
 * and reads come back wearing the "<domain>~" prefix, which is not the name the
 * site wrote. Google's bot check is the visible casualty: its script stores
 * SG_SS, reloads with ?sg_ss=<token>, and the cookie never arrives, so the
 * reload answers 429. This shim makes document.cookie behave like the target's
 * own jar - same names in, same names out - and must run before any site script.
 */
export function cookieShim(host) {
  const h = JSON.stringify(String(host).toLowerCase());
  const ns = JSON.stringify(NS);
  return String.raw`(function(){
var H=${h},NS=${ns};
function ok(d){return H===d||H.endsWith("."+d)}
var D=Object.getOwnPropertyDescriptor(Document.prototype,"cookie");
if(!D||!D.get||!D.set)return;
Object.defineProperty(document,"cookie",{configurable:true,
get:function(){return String(D.get.call(document)).split(/;\s*/).map(function(c){
var i=c.indexOf(NS),e=c.indexOf("=");
if(i<1||e===-1||i>e)return null;
return ok(c.slice(0,i).toLowerCase())?c.slice(i+NS.length):null}).filter(Boolean).join("; ")},
set:function(v){var s=String(v),parts=s.split(";"),head=parts.shift(),e=head.indexOf("=");
if(e<1)return;
var m=/;\s*domain\s*=\s*\.?([^;]*)/i.exec(s),d=m&&m[1].trim().toLowerCase().replace(/\.+$/,"");
var attrs=parts.filter(function(p){return !/^\s*(domain|path)\s*=/i.test(p)});
D.set.call(document,[((d&&ok(d))?d:H)+NS+head.trim(),"Path=/"].concat(attrs).join("; "))}});
})()`;
}

/**
 * Our own /proxy/ referer translated back to the target URL it stands for. Sites
 * use Referer for hotlink protection and CSRF checks, and Google's bot check
 * fails on a token-bearing request that arrives without one. "" when the referer
 * is not a proxy URL (our own UI, say), so nothing about us leaks.
 */
export function proxiedReferer(value) {
  if (!value) return '';
  const target = validateTarget(targetFromRequestUrl(value));
  return target.error ? '' : target.url;
}

// Google search cannot be proxied at all: its own script compares the page's
// hostname against google.com, does not find it, and the reload it fires answers
// 429. Bing survives the same treatment, so a Google search is sent there instead.
// Only /search with a q= is touched - the rest of google.com proxies fine.
const GOOGLE_HOST = /(^|\.)google(\.[a-z]{2,3}){1,2}$/;

export function swapUnproxyable(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return href;
  }
  if (!GOOGLE_HOST.test(u.hostname) || u.pathname !== '/search') return href;
  const q = u.searchParams.get('q');
  return q ? 'https://www.bing.com/search?q=' + encodeURIComponent(q) : href;
}

/**
 * A single-page app under a path-carrying proxy calls history.pushState with a
 * URL built from its own origin plus location.pathname - which here reads
 * "/proxy/https://site/page". The browser refuses a state URL on another origin,
 * the throw lands inside the router, and hydration stops: on 13tv the video
 * player never mounts, so nothing plays. The shim maps whatever the site passes
 * back onto a /proxy/ URL of ours, which is same-origin and therefore allowed.
 */
export function historyShim(base, origin) {
  const t = JSON.stringify(new URL(base).origin);
  const o = JSON.stringify(origin);
  return String.raw`(function(){
var T=${t},O=${o},P="/proxy/";
${ENC_JS}
function map(u){
if(u===null||u===undefined||u==="")return u;
var r;try{r=new URL(String(u),location.href)}catch(e){return u}
if(r.origin===O)return r.pathname.indexOf(P)===0?r.href:O+P+enc(T+r.pathname+r.search+r.hash);
if(r.pathname.indexOf(P)===0)return O+r.pathname+r.search+r.hash;
return O+P+enc(r.href)}
["pushState","replaceState"].forEach(function(name){
var f=History.prototype[name];
if(!f)return;
History.prototype[name]=function(state,title,url){
return arguments.length<3?f.call(this,state,title):f.call(this,state,title,map(url))}});
})()`;
}

/**
 * Keeps navigation inside the frame. Three ways a click escaped it:
 * `target="_blank"` opened a bare proxied page in a new browser tab, outside our
 * UI; `_top`/`_parent` replaced the whole shell; and an anchor a site's own JS
 * built after load never went through HTMLRewriter at all, so it still pointed at
 * the real site. A named frame target is left alone - a frameset needs it.
 *
 * The first line is the other half: a proxied page that did reach a tab of its
 * own (a middle-click, a popup we could not catch) sends itself back into the
 * shell, so there is no way to end up looking at a page without the address bar.
 */
export function linkShim(base, origin) {
  const b = JSON.stringify(base);
  const t = JSON.stringify(new URL(base).origin);
  const o = JSON.stringify(origin);
  return String.raw`(function(){
var B=${b},T=${t},O=${o},P="/proxy/";
if(window.top===window.self){location.replace(O+"/?u="+encodeURIComponent(B));return}
${ENC_JS}
// Relative hrefs resolve against the injected <base>, which points at the target -
// the same value the browser itself would use for the click.
function abs(u){try{return new URL(String(u),document.baseURI||location.href)}catch(e){return null}}
function map(u){var r=abs(u);
if(!r||(r.protocol!=="http:"&&r.protocol!=="https:"))return null;
if(r.origin===O)return r.pathname.indexOf(P)===0?r.href:O+P+enc(T+r.pathname+r.search+r.hash);
return O+P+enc(r.href)}
function out(t){return t==="_blank"||t==="_top"||t==="_parent"}
addEventListener("click",function(e){
if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
var p=e.composedPath?e.composedPath():[e.target],a=null,i;
for(i=0;i<p.length;i++){var n=p[i];
if(n&&n.getAttribute&&String(n.tagName).toLowerCase()==="a"&&n.getAttribute("href")!==null){a=n;break}}
if(!a)return;
var raw=a.getAttribute("href"),r;
// The injected <base> would send a bare "#x" to the real site; keep it in the page.
if(raw.charAt(0)==="#"){e.preventDefault();location.hash=raw;return}
var m=map(raw);
if(!m||!(r=abs(raw)))return;
if(r.href!==m)a.setAttribute("href",m);
if(out((a.getAttribute("target")||"").toLowerCase())){e.preventDefault();location.href=m}},true);
addEventListener("submit",function(e){
var f=e.target;
if(f&&f.getAttribute&&out((f.getAttribute("target")||"").toLowerCase()))f.setAttribute("target","_self")},true);
var W=window.open;
window.open=function(u,n,f){
var act=navigator.userActivation;
if(act&&!act.isActive)return null;
var m=u?map(u):null;
if(m){location.href=m;return window}
return W?W.call(window,u,n,f):null};
})()`;
}
