import http from 'node:http';
import {readFile,rename,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
const root = path.resolve('dist'), cache = path.resolve('.test-cache');
await mkdir(cache,{recursive:true});
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.wasm':'application/wasm','.data':'application/octet-stream','.woff':'font/woff'};
const server = http.createServer(async (req,res) => {
  res.setHeader('Cross-Origin-Opener-Policy','same-origin'); res.setHeader('Cross-Origin-Embedder-Policy','require-corp'); res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (pathname.startsWith('/engine/')) {
      const match = pathname.match(/^\/engine\/(stable|next|ds)\/(.+)$/); if (!match || match[2].includes('..')) {res.writeHead(400).end();return;}
      const version = match[1] === 'stable' ? '4.2.3' : match[1] === 'ds' ? 'pilas' : 'nightly', relative = match[2];
      const upstream = version === 'pilas' ? `https://cdn.jsdelivr.net/gh/josepilas/pilas-melonds@7adc554ce1dc5318fef3797e8f00a6e9286dac3b/${relative}` : `https://cdn.emulatorjs.org/${version}/data/${relative}`;
      const filename = path.join(cache,version,relative); let data;
      try { data = await readFile(filename); } catch {
        await mkdir(path.dirname(filename),{recursive:true});
        try { await exec('curl',['-f','-sS','-L','--max-time','50',upstream,'-o',filename+'.partial'],{maxBuffer:1024*1024}); await rename(filename+'.partial',filename); data = await readFile(filename); }
        catch { await rm(filename+'.partial',{force:true}); res.writeHead(404).end('Missing engine asset'); return; }
      }
      res.setHeader('Content-Type',types[path.extname(filename)] || 'application/octet-stream'); res.end(data); return;
    }
    const filename = path.resolve(root,'.'+ (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
    res.setHeader('Content-Type',types[path.extname(filename)] || 'application/octet-stream'); res.end(await readFile(filename));
  } catch {res.writeHead(404).end('Not found');}
});
server.listen(Number(process.env.PORT || 4173),'0.0.0.0',() => console.log('RETRO development server on http://localhost:'+server.address().port));
