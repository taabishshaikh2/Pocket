import express from 'express';
import helmet from 'helmet';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function cleanHeaders(original) {
  const headers = { ...original };
  const extra = String(headers.connection || '').split(',').map(s => s.trim().toLowerCase());
  for (const key of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', ...extra]) delete headers[key];
  return headers;
}
export function createGateway({ target, production = false, trustProxy = false, directory = fileURLToPath(new URL('../client/dist/', import.meta.url)) }) {
  const upstream = new URL(target);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.origin !== target) throw new Error('API_PROXY_TARGET must be an HTTP(S) origin without a path or trailing slash.');
  if (production && upstream.protocol !== 'https:') throw new Error('Production API_PROXY_TARGET must use HTTPS.');
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], 'font-src': ["'self'", 'https://fonts.gstatic.com'] } } }));
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  // Stream API requests without parsing the body; keep cookies HttpOnly and host-only.
  // The upstream is deployment configuration, never a client-supplied URL.
  app.use('/api', (req, res) => {
    const headers = cleanHeaders(req.headers);
    for (const key of Object.keys(headers)) if (key.startsWith('x-forwarded-')) delete headers[key];
    headers.host = upstream.host;
    headers['x-forwarded-for'] = req.ip;
    headers['x-forwarded-proto'] = req.secure ? 'https' : 'http';
    headers['x-forwarded-host'] = req.get('host');
    const transport = upstream.protocol === 'https:' ? https : http;
    const proxy = transport.request({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port || undefined, method: req.method, path: req.originalUrl, headers }, incoming => {
      const responseHeaders = cleanHeaders(incoming.headers);
      responseHeaders['cache-control'] = 'no-store';
      res.writeHead(incoming.statusCode || 502, responseHeaders);
      incoming.on('error', () => res.destroy());
      incoming.pipe(res);
    });
    proxy.setTimeout(120000, () => proxy.destroy());
    proxy.on('error', () => {
      if (!res.headersSent) res.status(502).set('Cache-Control', 'no-store').json({ error: 'Pocket is temporarily unavailable. Please try again shortly.' });
      else res.destroy();
    });
    req.on('aborted', () => proxy.destroy());
    res.on('close', () => { if (!res.writableEnded) proxy.destroy(); });
    req.pipe(proxy);
  });
  let warming = false, lastWarmup = -Infinity;
  function wakeBackend() {
    if (warming || Date.now() - lastWarmup < 30000) return;
    warming = true; lastWarmup = Date.now();
    const transport = upstream.protocol === 'https:' ? https : http;
    const warmup = transport.get(new URL('/api/health', upstream), { headers: { 'Cache-Control': 'no-cache' } }, response => {
      response.resume();
      response.on('end', () => { warming = false; });
      response.on('error', () => { warming = false; });
    });
    warmup.setTimeout(120000, () => warmup.destroy());
    warmup.on('error', () => { warming = false; });
  }
  // Start waking the API while serving the document; never delay the HTML.
  // No timer keeps the backend alive: this runs only on an actual page visit.
  app.use((req, _res, next) => { if (req.method === 'GET' && req.path === '/') wakeBackend(); next(); });
  app.use(express.static(directory));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(directory, 'index.html')));
  return app;
}
