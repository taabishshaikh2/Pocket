import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';
import { createApp } from './app.js';
import { User, Month } from './models.js';
const { MONGODB_URI, SESSION_SECRET, APP_ORIGIN, PORT = 3001, NODE_ENV, TRUST_PROXY, CROSS_SITE_COOKIES, SERVE_CLIENT } = process.env;
if (!MONGODB_URI || !APP_ORIGIN) { console.error('Set MONGODB_URI and APP_ORIGIN in .env. See .env.example.'); process.exit(1); }
try {
  const appOrigin = new URL(APP_ORIGIN).origin;
  if (appOrigin !== APP_ORIGIN) throw new Error('APP_ORIGIN must be an origin without a trailing slash.');
  const store = MongoStore.create({ mongoUrl: MONGODB_URI, collectionName: 'sessions' });
  store.on('error', () => console.error('Session storage is unavailable. Check MongoDB connectivity.'));
  const app = createApp({ store, secret: SESSION_SECRET, origin: appOrigin, production: NODE_ENV === 'production', trustProxy: TRUST_PROXY === '1', crossSiteCookies: CROSS_SITE_COOKIES === 'true', serveClient: SERVE_CLIENT !== 'false' });
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([User.init(), Month.init()]);
  const server = app.listen(Number(PORT), '0.0.0.0', () => console.log(`Pocket API: http://localhost:${PORT}`));
  const shutdown = () => server.close(async () => { await store.close(); await mongoose.disconnect(); process.exit(0); });
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch { console.error('Pocket could not start. Check environment settings, MongoDB access, and connectivity.'); process.exit(1); }
