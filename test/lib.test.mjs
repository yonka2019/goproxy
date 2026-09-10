import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTarget, proxify, proxifySrcset, rewriteCss, isBlockedHost, isInlineType, filenameFrom, targetFromRequestUrl } from '../src/lib.js';

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
