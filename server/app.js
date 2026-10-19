import express from 'express';
import cors from 'cors';
import session from 'express-session';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { User, Month, Trip, Category, Settings, Audit } from './models.js';
import { seedCategories, resolveCategory, validateImportCategories, categoryNameTaken, fail } from './catalog.js';
import { categoryCreateSchema, categoryUpdateSchema, accountUpdateSchema, settingsSchema, monthSchema, salarySchema, entrySchema, credentialsSchema, importSchema, assertMonthDate, summarize, tripSchema, contributionSchema, cents } from './validation.js';

const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
const persist = req => new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
const emptyMonth = month => ({ month, salary: 0, received: '', entries: [] });
export function createApp({ store, secret, origin, production = false, trustProxy = false, crossSiteCookies = false, serveClient = true }) {
  if (!secret || secret.length < 32 || secret.startsWith('replace-')) throw new Error('Set SESSION_SECRET to a random value of at least 32 characters.');
  const parsedOrigin = new URL(origin);
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) throw new Error('APP_ORIGIN must be an HTTP(S) origin without a trailing slash.');
  if (production && parsedOrigin.protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS.');
  if (crossSiteCookies && !production) throw new Error('Cross-site cookies require production HTTPS.');
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: {
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
  } } }));
  // Handle credentialed preflights before sessions and keep the write Origin check.
  app.use('/api', cors({
    origin: (requestOrigin, callback) => callback(null, requestOrigin === origin ? origin : false),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  }));
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== origin) return res.status(403).json({ error: 'Request origin is not allowed.' });
    next();
  });
  const cookie = { httpOnly: true, secure: production, sameSite: crossSiteCookies ? 'none' : 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 };
  app.use(session({ name: 'pocket.sid', secret, store, resave: false, saveUninitialized: false, cookie }));
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again later.' } });
  async function authenticate(req, res) {
    const values = credentialsSchema.parse(req.body);
    let user;
    if (req.path === '/register') {
      const settings = await Settings.findById('global').lean();
      if (settings?.registrationOpen === false) return res.status(403).json({ error: 'New account registration is currently paused.' });
      const hash = await bcrypt.hash(values.password, 12);
      user = await User.create({ email: values.email, passwordHash: hash });
    } else {
      user = await User.findOne({ email: values.email });
      const valid = await bcrypt.compare(values.password, user?.passwordHash || '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxlTLzqgVZJmZhUZVWOGQZLZB8e');
      if (!user || !valid || user.disabled) return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    await regenerate(req); req.session.userId = user.id; await persist(req);
    res.status(req.path === '/register' ? 201 : 200).json({ email: user.email, role: user.role || 'user' });
  }
  const auth = express.Router();
  auth.post('/register', authLimiter, authenticate);
  auth.post('/login', authLimiter, authenticate);
  auth.get('/me', async (req, res) => {
    const user = req.session.userId ? await User.findById(req.session.userId) : null;
    res.json({ user: user && !user.disabled ? { email: user.email, role: user.role || 'user' } : null });
  });
  auth.post('/logout', (req, res, next) => req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('pocket.sid', { httpOnly: true, secure: production, sameSite: cookie.sameSite, path: '/' }); res.sendStatus(204);
  }));
  app.use('/api/auth', auth);
  app.use('/api', async (req, res, next) => {
    const user = req.session.userId ? await User.findById(req.session.userId).select('email role disabled').lean() : null;
    if (!user || user.disabled) return res.status(401).json({ error: 'Please sign in to continue.' });
    req.user = user; next();
  });
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 200, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Please wait a minute.' } }));
  let catalogReady;
  async function ensureCatalog() {
    if (!catalogReady) catalogReady = seedCategories().catch(error => { catalogReady = null; throw error; });
    await catalogReady;
  }
  app.get('/api/categories', async (_req, res) => {
    await ensureCatalog(); res.json(await Category.find().sort({ type: 1, order: 1, label: 1 }).lean());
  });
  app.use('/api/admin', (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Administrator access required.' }));
  const audit = (req, action, target) => Audit.create({ actorId: req.user._id, action, target });
  app.post('/api/admin/categories', async (req, res) => {
    await ensureCatalog(); const values = categoryCreateSchema.parse(req.body);
    const conflict = await categoryNameTaken(values.type, values.label);
    if (conflict) fail('That category name is already used or retained in history.');
    const category = await Category.create({ _id: randomUUID(), ...values, labelKey: values.label.toLowerCase() });
    await audit(req, 'category.create', category.id); res.status(201).json(category);
  });
  app.put('/api/admin/categories/:id', async (req, res) => {
    await ensureCatalog(); const values = categoryUpdateSchema.parse(req.body), category = await Category.findById(req.params.id);
    if (!category) fail('Category not found.', 404);
    const conflict = await categoryNameTaken(category.type, values.label, category.id);
    if (conflict) fail('That category name is already used or retained in history.');
    if (category.isOther && (values.label !== 'Other' || !values.active)) fail('Other must remain available with its original name.');
    const update = { $set: { ...values, labelKey: values.label.toLowerCase() } };
    if (category.label !== values.label) update.$addToSet = { previousLabels: category.label };
    const result = await Category.findByIdAndUpdate(category.id, update, { new: true, runValidators: true });
    await audit(req, 'category.update', category.id); res.json(result);
  });
  app.get('/api/admin/settings', async (_req, res) => {
    const settings = await Settings.findById('global').lean(); res.json({ registrationOpen: settings?.registrationOpen !== false });
  });
  app.put('/api/admin/settings', async (req, res) => {
    const values = settingsSchema.parse(req.body);
    await Settings.updateOne({ _id: 'global' }, { $set: values }, { upsert: true });
    await audit(req, 'settings.registration', String(values.registrationOpen)); res.json(values);
  });
  app.get('/api/admin/users', async (_req, res) => {
    const users = await User.find().select('email role disabled createdAt').sort({ createdAt: -1 }).limit(200).lean();
    res.json(users.map(u => ({ id: String(u._id), email: u.email, role: u.role || 'user', disabled: !!u.disabled })));
  });
  app.put('/api/admin/users/:id', async (req, res) => {
    const values = accountUpdateSchema.parse(req.body);
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) fail('Account not found.', 404);
    const result = await User.findOneAndUpdate({ _id: req.params.id, role: { $ne: 'admin' } }, { $set: values }, { new: true });
    if (!result) fail('Administrator accounts cannot be disabled here.', 400);
    await audit(req, 'account.access', result.id); res.json({ id: result.id, disabled: !!result.disabled });
  });
  app.get('/api/admin/audit', async (_req, res) => {
    const rows = await Audit.find().sort({ createdAt: -1 }).limit(30).lean();
    res.json(rows.map(row => ({ id: String(row._id), action: row.action, target: row.target, createdAt: row.createdAt })));
  });
  app.get('/api/months/:month', async (req, res) => {
    const month = monthSchema.parse(req.params.month);
    const record = await Month.findOne({ userId: req.session.userId, month }).lean() || emptyMonth(month);
    res.json({ month, salary: record.salary, received: record.received, entries: record.entries, totals: summarize(record) });
  });
  app.put('/api/months/:month/salary', async (req, res) => {
    const month = monthSchema.parse(req.params.month), values = salarySchema.parse(req.body); assertMonthDate(month, values.received);
    await Month.updateOne({ userId: req.session.userId, month }, { $set: values }, { upsert: true, runValidators: true }); res.sendStatus(204);
  });
  app.post('/api/months/:month/entries', async (req, res) => {
    const month = monthSchema.parse(req.params.month), values = entrySchema.parse(req.body); assertMonthDate(month, values.date);
    await ensureCatalog(); const resolved = await resolveCategory(values);
    const entry = { id: randomUUID(), ...resolved };
    await Month.updateOne({ userId: req.session.userId, month }, { $push: { entries: entry } }, { upsert: true, runValidators: true }); res.status(201).json(entry);
  });
  app.put('/api/months/:month/entries/:id', async (req, res) => {
    const month = monthSchema.parse(req.params.month), values = entrySchema.parse(req.body); assertMonthDate(month, values.date);
    await ensureCatalog();
    const record = await Month.findOne({ userId: req.session.userId, month, 'entries.id': req.params.id }).lean();
    const previous = record?.entries.find(e => e.id === req.params.id);
    if (!previous) fail('Transaction not found.', 404);
    const resolved = await resolveCategory(values, previous);
    const result = await Month.updateOne({ userId: req.session.userId, month, 'entries.id': req.params.id }, { $set: { 'entries.$': { id: req.params.id, ...resolved } } }, { runValidators: true });
    if (!result.matchedCount) return res.status(404).json({ error: 'Transaction not found.' }); res.sendStatus(204);
  });
  app.delete('/api/months/:month/entries/:id', async (req, res) => {
    const month = monthSchema.parse(req.params.month);
    const result = await Month.updateOne({ userId: req.session.userId, month, 'entries.id': req.params.id }, { $pull: { entries: { id: req.params.id } } });
    if (!result.matchedCount) return res.status(404).json({ error: 'Transaction not found.' }); res.sendStatus(204);
  });
  app.post('/api/import', async (req, res) => {
    const data = importSchema.parse(req.body); await ensureCatalog(); await validateImportCategories(data); let imported = 0, skipped = 0;
    // Import only missing months: repeated requests cannot duplicate or overwrite cloud data.
    for (const [month, values] of Object.entries(data)) {
      try {
        const result = await Month.updateOne({ userId: req.session.userId, month }, { $setOnInsert: values }, { upsert: true, runValidators: true });
        if (result.upsertedCount) imported++; else skipped++;
      } catch (error) { if (error.code === 11000) skipped++; else throw error; }
    }
    res.json({ imported, skipped });
  });
  const tripJSON = trip => ({ id: String(trip._id), name: trip.name, budget: trip.budgetCents / 100, saved: trip.savedCents / 100, targetDate: trip.targetDate });
  const tripValues = values => ({ name: values.name, budgetCents: cents(values.budget), savedCents: cents(values.saved), targetDate: values.targetDate });
  app.get('/api/trips', async (req, res) => {
    const trips = await Trip.find({ userId: req.session.userId }).sort({ createdAt: -1 }).lean();
    res.json(trips.map(tripJSON));
  });
  app.post('/api/trips', async (req, res) => {
    const values = tripSchema.parse(req.body);
    const trip = await Trip.create({ userId: req.session.userId, ...tripValues(values) });
    res.status(201).json(tripJSON(trip));
  });
  app.param('tripId', (req, res, next, id) => /^[a-f\d]{24}$/i.test(id) ? next() : res.status(404).json({ error: 'Trip not found.' }));
  app.put('/api/trips/:tripId', async (req, res) => {
    const values = tripSchema.parse(req.body);
    const trip = await Trip.findOneAndUpdate({ _id: req.params.tripId, userId: req.session.userId }, { $set: tripValues(values) }, { new: true, runValidators: true });
    if (!trip) return res.status(404).json({ error: 'Trip not found.' });
    res.json(tripJSON(trip));
  });
  app.post('/api/trips/:tripId/savings', async (req, res) => {
    const values = contributionSchema.parse(req.body), addition = cents(values.amount);
    const trip = await Trip.findOneAndUpdate({ _id: req.params.tripId, userId: req.session.userId, savedCents: { $lte: cents(1_000_000_000) - addition } }, { $inc: { savedCents: addition } }, { new: true, runValidators: true });
    if (!trip) {
      const exists = await Trip.exists({ _id: req.params.tripId, userId: req.session.userId });
      return res.status(exists ? 400 : 404).json({ error: exists ? 'Saved amount exceeds the supported limit.' : 'Trip not found.' });
    }
    res.json(tripJSON(trip));
  });
  app.delete('/api/trips/:tripId', async (req, res) => {
    const result = await Trip.deleteOne({ _id: req.params.tripId, userId: req.session.userId });
    if (!result.deletedCount) return res.status(404).json({ error: 'Trip not found.' });
    res.sendStatus(204);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  if (production && serveClient) {
    const directory = fileURLToPath(new URL('../client/dist/', import.meta.url));
    app.use(express.static(directory));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(directory, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    if (error.name === 'ZodError') return res.status(400).json({ error: error.issues[0]?.message || 'Invalid input.' });
    if (error.code === 11000) return res.status(409).json({ error: 'This email, category, or month already exists. Refresh and try again.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Import is too large. Maximum size is 2 MB.' });
    const status = [400, 404].includes(error.status) ? error.status : 500;
    res.status(status).json({ error: status !== 500 ? error.message : 'Unable to complete the request. Please try again.' });
  });
  return app;
}
