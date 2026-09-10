// Copies public/ -> dist/. That is the whole build; functions/ is compiled by
// Cloudflare Pages itself. No bundler, no dependencies.
import { cp } from 'node:fs/promises';

// Copy over the top rather than removing dist/ first: on Windows a running
// `wrangler dev` holds the directory open and rmdir fails with EBUSY.
// ponytail: deleted files in public/ linger in dist/ until you remove it by hand.
await cp('public', 'dist', { recursive: true, force: true });
console.log('built -> dist/');
