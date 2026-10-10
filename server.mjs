// Static server for dist/ + a tiny endpoint that stores play-session logs in ./logs
//   POST /api/log        body = session JSON  → logs/<id>.json
//   GET  /api/log/<id>   → that session (used by ?replay=<id>)
//   GET  /api/logs       → list of sessions
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve('dist'), LOGS = path.resolve('logs'), PORT = +process.env.PORT || 4181;
fs.mkdirSync(LOGS, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.webm': 'video/webm', '.webmanifest': 'application/manifest+json' };
const safeId = id => /^[a-z0-9-]{4,64}$/i.test(id) ? id : null;
const isSession = f => /^s[a-z0-9]+\.json$/i.test(f);

function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/log') {
    let body = ''; req.on('data', d => { body += d; if (body.length > 20e6) req.destroy(); });
    req.on('end', () => {
      try { const s = JSON.parse(body), id = safeId(s.id); if (!id) throw 0; fs.writeFileSync(path.join(LOGS, id + '.json'), JSON.stringify(s)); res.writeHead(204).end(); }
      catch { res.writeHead(400).end(); }
    });
    return;
  }
  if (url.pathname === '/api/logs') {
    const list = [];
    for (const f of fs.readdirSync(LOGS)) {
      if (!isSession(f)) continue;
      try { const s = JSON.parse(fs.readFileSync(path.join(LOGS, f))); list.push({ id: s.id, kind: s.kind, level: s.level, startedAt: s.startedAt, actions: s.actions?.length ?? 0, end: s.end?.type }); } catch {}
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list)); return;
  }
  if (url.pathname.startsWith('/api/log/')) {
    const id = safeId(url.pathname.slice(9)); const f = id && path.join(LOGS, id + '.json');
    if (!f || !fs.existsSync(f)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(fs.readFileSync(f)); return;
  }
  let p = path.join(ROOT, decodeURIComponent(url.pathname)); if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(p).pipe(res);
}

http.createServer((req, res) => {
  try { handle(req, res); } catch (e) { console.error(e); try { res.writeHead(500).end(); } catch {} }
}).listen(PORT, () => console.log(`DEWPOP on http://localhost:${PORT}`));
