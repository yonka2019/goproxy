import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTarget, proxify, proxifySrcset, rewriteCss, isBlockedHost, isInlineType, filenameFrom, targetFromRequestUrl, cookieDomain, rewriteSetCookie, cookiesForHost, cookieShim, proxiedReferer, swapUnproxyable } from '../src/lib.js';

test('validateTarget adds https to a bare domain', () => {
  assert.equal(validateTarget('example.com').url, 'https://example.com/');
  assert.equal(validateTarget('  example.com/a?b=c ').url, 'https://example.com/a?b=c');
});

test('validateTarget keeps an explicit url intact', () => {
  assert.equal(validateTarget('http://example.com:8080/x').url, 'http://example.com:8080/x');
});

test('validateTarget rejects non-http schemes', () => {
  assert.match(validateTarget('file:///etc/passwd').error, /http/);
  assert.match(validateTarget('javascript:alert(1)').error, /http/);
  assert.match(validateTarget('data:text/html,hi').error, /http/);
});

test('validateTarget rejects internal addresses', () => {
  for (const bad of ['http://127.0.0.1:8788', 'http://localhost', 'https://10.0.0.5', 'http://169.254.169.254/latest/meta-data/', 'https://box.local']) {
    assert.ok(validateTarget(bad).error, `${bad} should be blocked`);
  }
  assert.equal(isBlockedHost('example.com'), false);
  assert.equal(isBlockedHost('172.32.0.1'), false); // just outside the private range
});

test('validateTarget rejects encoded and trailing-dot forms of internal hosts', () => {
  for (const bad of [
    'http://localhost.',            // trailing dot is still localhost
    'http://127.0.0.1./',
    'http://2130706433',            // decimal 127.0.0.1
    'http://0x7f000001',            // hex 127.0.0.1
    'http://0177.0.0.1',            // octal 127.0.0.1
    'http://0',                     // shorthand for 0.0.0.0
    'http://192.168.1.1.1',         // numeric but not a quad
  ]) {
    assert.ok(validateTarget(bad).error, `${bad} should be blocked`);
  }
  assert.equal(validateTarget('https://example.com.').url, 'https://example.com./');
});

test('validateTarget rejects empty input', () => {
  assert.ok(validateTarget('').error);
});

test('proxify resolves relative urls against the page', () => {
  assert.equal(proxify('/a.png', 'https://example.com/x/y', 'https://p.dev'), 'https://p.dev/proxy/https://example.com/a.png');
  assert.equal(proxify('b.png', 'https://example.com/x/y', ''), '/proxy/https://example.com/x/b.png');
  // commas would split a srcset, "#" would become a fragment
  assert.equal(proxify('/a,b.png', 'https://example.com/', ''), '/proxy/https://example.com/a%2Cb.png');
});

test('proxify leaves non-navigable values alone', () => {
  for (const v of ['#top', 'mailto:a@b.c', 'tel:+123', 'data:image/png;base64,AA', 'javascript:void 0']) {
    assert.equal(proxify(v, 'https://example.com/'), v);
  }
});

test('proxifySrcset keeps descriptors', () => {
  assert.equal(
    proxifySrcset('/a.png 1x, /b.png 2x', 'https://example.com/', ''),
    '/proxy/https://example.com/a.png 1x, /proxy/https://example.com/b.png 2x',
  );
});

test('rewriteCss rewrites url() and @import', () => {
  assert.equal(
    rewriteCss('a{background:url(/x.png)}', 'https://example.com/', ''),
    'a{background:url(/proxy/https://example.com/x.png)}',
  );
  assert.equal(
    rewriteCss('@import "theme.css";', 'https://example.com/css/', ''),
    '@import "/proxy/https://example.com/css/theme.css";',
  );
  assert.equal(rewriteCss('a{background:url(data:image/gif;base64,AA)}', 'https://example.com/', ''),
    'a{background:url(data:image/gif;base64,AA)}');
});

test('isInlineType keeps page assets inline and marks real files as downloads', () => {
  for (const t of ['text/html; charset=utf-8', 'image/png', 'application/javascript', 'application/pdf', 'font/woff2']) {
    assert.equal(isInlineType(t), true, t);
  }
  for (const t of ['application/zip', 'application/octet-stream', 'application/vnd.ms-excel', '']) {
    assert.equal(isInlineType(t), false, t);
  }
});

test('filenameFrom takes the last path segment', () => {
  assert.equal(filenameFrom('https://example.com/files/report%202024.zip?x=1'), 'report 2024.zip');
  assert.equal(filenameFrom('https://example.com/'), '');
  assert.equal(filenameFrom('not a url'), '');
});

test('targetFromRequestUrl survives a GET form appending its own query', () => {
  // The exact failure: a GET form replaces the action's query string, so ?url= is lost.
  assert.equal(
    targetFromRequestUrl('http://h/proxy/https://www.google.com/search?q=hello&hl=en'),
    'https://www.google.com/search?q=hello&hl=en',
  );
});

test('targetFromRequestUrl handles collapsed slashes and the legacy query form', () => {
  assert.equal(targetFromRequestUrl('http://h/proxy/https:/example.com/a'), 'https://example.com/a');
  assert.equal(targetFromRequestUrl('http://h/proxy?url=https%3A%2F%2Fexample.com'), 'https://example.com');
  assert.equal(targetFromRequestUrl('http://h/'), '');
  assert.equal(targetFromRequestUrl('nonsense'), '');
});

test('rewriteSetCookie namespaces by domain and takes over the path', () => {
  assert.equal(
    rewriteSetCookie('NID=abc; expires=Fri, 12-Mar-2027 13:04:49 GMT; path=/; domain=.google.com; Secure; HttpOnly; SameSite=none', 'www.google.com'),
    'google.com~NID=abc; Path=/; expires=Fri, 12-Mar-2027 13:04:49 GMT; Secure; HttpOnly; SameSite=none',
  );
  // No Domain= -> host-only, and a domain the host may not claim is ignored.
  assert.equal(rewriteSetCookie('a=1', 'shop.example.com'), 'shop.example.com~a=1; Path=/');
  assert.equal(rewriteSetCookie('a=1; domain=evil.com', 'example.com'), 'example.com~a=1; Path=/');
  assert.equal(cookieDomain('a=1; Domain=EXAMPLE.COM.', 'www.example.com'), 'example.com');
});

test('rewriteSetCookie refuses what it cannot parse', () => {
  for (const bad of ['', 'nonsense', '=1', 'a b=1', 'Secure; a=1']) {
    assert.equal(rewriteSetCookie(bad, 'example.com'), null, bad);
  }
});

test('cookiesForHost hands each site only its own cookies', () => {
  const jar = 'google.com~NID=abc; evil.com~SESSION=steal; example.com~a=1';
  assert.equal(cookiesForHost(jar, 'www.google.com'), 'NID=abc');
  assert.equal(cookiesForHost(jar, 'evil.com'), 'SESSION=steal');
  assert.equal(cookiesForHost(jar, 'notexample.com'), '');
  // Cookies without our namespace (or with an unusable one) never leave.
  assert.equal(cookiesForHost('plain=1; ~x=2', 'example.com'), '');
  assert.equal(cookiesForHost('', 'example.com'), '');
});

test('a cookie survives a round trip through our jar', () => {
  const stored = rewriteSetCookie('SEARCH_SAMESITE=CgQI4qEB; path=/; domain=.google.com; SameSite=strict', 'www.google.com');
  const name = stored.split(';')[0];
  assert.equal(cookiesForHost(name, 'accounts.google.com'), 'SEARCH_SAMESITE=CgQI4qEB');
});

// The shim runs in the page, so exercise it against a stub jar the way a browser would.
function runShim(host, stored = '') {
  let jar = stored;
  const document = {};
  const Document = { prototype: {} };
  Object.defineProperty(Document.prototype, 'cookie', {
    configurable: true,
    get: () => jar,
    set: (v) => { jar = jar ? `${jar}; ${v.split(';')[0]}` : v.split(';')[0]; },
  });
  Object.setPrototypeOf(document, Document.prototype);
  new Function('document', 'Document', cookieShim(host))(document, Document);
  return { document, raw: () => jar };
}

test('cookieShim gives a page its own cookie names back', () => {
  const { document } = runShim('www.google.com', 'google.com~NID=abc; evil.com~SESSION=steal; plain=1');
  assert.equal(document.cookie, 'NID=abc');
});

test('cookieShim namespaces what a page writes, so the server can forward it', () => {
  const { document, raw } = runShim('www.google.com');
  document.cookie = 'SG_SS=token; path=/x; domain=.google.com; SameSite=none';
  assert.equal(raw(), 'google.com~SG_SS=token');
  assert.equal(document.cookie, 'SG_SS=token');
  // The stored form is exactly what cookiesForHost hands back to the target.
  assert.equal(cookiesForHost(raw(), 'www.google.com'), 'SG_SS=token');
});

test('cookieShim refuses a domain the page may not claim, and junk writes', () => {
  const { document, raw } = runShim('example.com');
  document.cookie = 'a=1; domain=evil.com';
  assert.equal(raw(), 'example.com~a=1');
  document.cookie = 'nonsense';
  assert.equal(raw(), 'example.com~a=1');
});

test('proxiedReferer hands the target its own url, never ours', () => {
  assert.equal(
    proxiedReferer('http://127.0.0.1:20777/proxy/https://www.google.com/search?q=x'),
    'https://www.google.com/search?q=x',
  );
  // Our UI page, a bare origin and junk all leak nothing.
  assert.equal(proxiedReferer('http://127.0.0.1:20777/'), '');
  assert.equal(proxiedReferer(''), '');
  assert.equal(proxiedReferer('http://127.0.0.1:20777/proxy/http://127.0.0.1:20777/'), '');
});

test('swapUnproxyable sends a Google search to Bing, and leaves the rest alone', () => {
  assert.equal(
    swapUnproxyable('https://www.google.com/search?q=prediction+markets&hl=en'),
    'https://www.bing.com/search?q=prediction%20markets',
  );
  assert.equal(swapUnproxyable('https://google.co.il/search?q=%D7%9E%D7%96%D7%92'), 'https://www.bing.com/search?q=%D7%9E%D7%96%D7%92');
  // Only /search with a query; the rest of Google proxies fine on its own.
  for (const keep of [
    'https://www.google.com/',
    'https://www.google.com/search',
    'https://news.google.com/topics/x',
    'https://googleusercontent.com/search?q=x',
    'https://www.google.com.evil.test/search?q=x',
    'https://mail.google.com/mail/u/0',
    'not a url',
  ]) {
    assert.equal(swapUnproxyable(keep), keep, keep);
  }
});
