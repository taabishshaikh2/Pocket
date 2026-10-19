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
  app.use(express.static(directory));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(directory, 'index.html')));
  return app;
}
