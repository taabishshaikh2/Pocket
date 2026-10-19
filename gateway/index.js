import { createGateway } from './app.js';
try {
  const { API_PROXY_TARGET, PORT = 3000, NODE_ENV, TRUST_PROXY } = process.env;
  if (!API_PROXY_TARGET) throw new Error('Set API_PROXY_TARGET to the backend HTTPS origin.');
  const port = Number(PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  const app = createGateway({ target: API_PROXY_TARGET, production: NODE_ENV === 'production', trustProxy: TRUST_PROXY === '1' });
  const server = app.listen(port, '0.0.0.0', () => console.log(`Pocket frontend gateway listening on port ${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
} catch { console.error('Frontend gateway could not start. Check API_PROXY_TARGET (HTTPS origin only), PORT, and runtime settings.'); process.exit(1); }
