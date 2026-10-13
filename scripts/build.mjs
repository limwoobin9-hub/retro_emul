import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await cp('public', 'dist', { recursive: true });
await mkdir('dist/vendor', { recursive: true });
await cp('node_modules/fflate/esm/browser.js', 'dist/vendor/fflate.js');
console.log('Built static app → dist');
