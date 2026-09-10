// Copies public/ -> dist/. That is the whole build; functions/ is compiled by
// Cloudflare Pages itself. No bundler, no dependencies.
import { cp, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await cp('public', 'dist', { recursive: true });
console.log('built -> dist/');
