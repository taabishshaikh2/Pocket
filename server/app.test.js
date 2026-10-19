import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from './app.js';
import { User, Month } from './models.js';
import { summarize } from './validation.js';

let mongo, store, app;
const origin = 'http://localhost:5173';
const password = 'a-long-test-password-2026';
before(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('pocket-tests');
  await mongoose.connect(uri);
  await Promise.all([User.init(), Month.init()]);
  store = MongoStore.create({ mongoUrl: uri });
  app = createApp({ store, secret: 'test-secret-with-more-than-32-characters', origin });
});
after(async () => { if(store)await store.close(); await mongoose.disconnect(); if(mongo)await mongo.stop(); });
const send = (agent, method, url, body) => agent[method](url).set('Origin', origin).send(body);
async function account(email) {
  const agent = request.agent(app);
  await send(agent,'post','/api/auth/register',{ email,password }).expect(201);
  return agent;
}
test('protects writes, authenticates users, and revokes logout sessions', async () => {
  const agent = await account('auth@example.com');
  await request(app).get('/api/months/2026-10').expect(401);
  await agent.put('/api/months/2026-10/salary').set('Origin','https://evil.example').send({salary:10,received:'2026-10-01'}).expect(403);
  await send(agent,'post','/api/auth/logout',{}).expect(204);
  await agent.get('/api/months/2026-10').expect(401);
  await send(agent,'post','/api/auth/login',{email:'auth@example.com',password:'incorrect-password'}).expect(401);
  const result = await send(agent,'post','/api/auth/login',{email:'AUTH@example.com',password}).expect(200);
  assert.match(result.headers['set-cookie'][0],/HttpOnly/);
  assert.match(result.headers['set-cookie'][0],/SameSite=Lax/);
  const user = await User.findOne({email:'auth@example.com'});
  assert.notEqual(user.passwordHash,password);
});
test('CRUD persists across sessions and isolates accounts and months', async () => {
  const a = await account('owner@example.com'), b = await account('other@example.com');
  await send(a,'put','/api/months/2026-10/salary',{salary:50000,received:'2026-10-01'}).expect(204);
  const entry = {name:'Rent',type:'expense',category:'Rent & home',date:'2026-10-02',amount:15000};
  const created = await send(a,'post','/api/months/2026-10/entries',entry).expect(201);
  await send(a,'post','/api/months/2026-10/entries',{name:'SIP',type:'investment',category:'Mutual funds',date:'2026-10-03',amount:10000}).expect(201);
  const result = await a.get('/api/months/2026-10').expect(200);
  assert.deepEqual(result.body.totals,{expenses:15000,investments:10000,remaining:25000});
  assert.equal((await b.get('/api/months/2026-10')).body.entries.length,0);
  assert.equal((await a.get('/api/months/2026-11')).body.salary,0);
  const url = '/api/months/2026-10/entries/'+created.body.id;
  await send(b,'put',url,{...entry,amount:1}).expect(404);
  await send(b,'delete',url).expect(404);
  await send(a,'put',url,{...entry,amount:45000}).expect(204);
  assert.equal((await a.get('/api/months/2026-10')).body.totals.remaining,-5000);
  const anotherSession = request.agent(app);
  await send(anotherSession,'post','/api/auth/login',{email:'owner@example.com',password}).expect(200);
  assert.equal((await anotherSession.get('/api/months/2026-10')).body.entries.length,2);
  await send(a,'delete',url).expect(204);
  assert.equal((await a.get('/api/months/2026-10')).body.entries.length,1);
});
test('rejects invalid dates, monetary precision, categories, and unexpected fields',async()=>{
  const a=await account('validation@example.com');
  for(const values of [{salary:-1,received:'2026-10-01'},{salary:1.001,received:'2026-10-01'},{salary:1,received:'2026-09-01'},{salary:1,received:'2026-02-30'},{salary:1,received:'2026-10-01',userId:'another'}]) {
    await send(a,'put','/api/months/2026-10/salary',values).expect(400);
  }
  await a.get('/api/months/2026-13').expect(400);
  await send(a,'post','/api/months/2026-10/entries',{name:'X',type:'investment',category:'Rent & home',date:'2026-10-01',amount:10}).expect(400);
});
test('imports legacy records once, preserving existing cloud months and local IDs',async()=>{
  const a=await account('import@example.com');
  await send(a,'put','/api/months/2026-10/salary',{salary:500,received:'2026-10-01'}).expect(204);
  const values={salary:200,received:'2026-09-01',entries:[{id:'legacy-1',name:'Food',type:'expense',category:'Food & groceries',date:'2026-09-02',amount:20}]};
  const data={'2026-09':values,'2026-10':{salary:1,received:'2026-10-01',entries:[]}};
  assert.deepEqual((await send(a,'post','/api/import',data).expect(200)).body,{imported:1,skipped:1});
  assert.deepEqual((await send(a,'post','/api/import',data).expect(200)).body,{imported:0,skipped:2});
  assert.equal((await a.get('/api/months/2026-10')).body.salary,500);
  assert.equal((await a.get('/api/months/2026-09')).body.entries[0].id,'legacy-1');
  await send(a,'post','/api/import',{'2026-09':{...values,entries:[{...values.entries[0],category:'Stocks'}]}}).expect(400);
});
test('uses integer cents to avoid floating-point balance errors',()=>{
  assert.equal(summarize({salary:0.3,entries:[{type:'expense',amount:0.1},{type:'investment',amount:0.2}]}).remaining,0);
});

test('production serves the React app and keeps unknown API routes as JSON', async () => {
  // Each session middleware needs its own store instance: express-session installs
  // a cookie generator on the store, which otherwise changes the development app.
  const productionStore = MongoStore.create({ mongoUrl: mongo.getUri('pocket-tests') });
  try {
    const productionApp = createApp({ store: productionStore, secret: 'another-test-secret-more-than-32-characters', origin: 'https://pocket.example', production: true });
    const response = await request(productionApp).get('/').expect(200);
    assert.match(response.text, /<div id="root"><\/div>/);
    assert.match(response.headers['content-security-policy'], /fonts.googleapis.com/);
    await request(productionApp).get('/api/unknown').expect(401);
  } finally { await productionStore.close(); }
});

test('trip goals persist, isolate accounts, and support budget edits and removal', async () => {
  const owner = await account('traveler@example.com'), other = await account('trip-other@example.com');
  await request(app).get('/api/trips').expect(401);
  const values = { name: 'A week in Bali', budget: 80000, saved: 20000, targetDate: '2027-04-10' };
  const { body: trip } = await send(owner, 'post', '/api/trips', values).expect(201);
  assert.deepEqual({ ...trip, id: undefined }, { ...values, id: undefined });
  assert.equal((await owner.get('/api/trips')).body.length, 1);
  assert.deepEqual((await other.get('/api/trips')).body, []);
  await send(other, 'put', '/api/trips/' + trip.id, values).expect(404);
  await send(other, 'post', '/api/trips/' + trip.id + '/savings', { amount: 10 }).expect(404);
  await send(other, 'delete', '/api/trips/' + trip.id).expect(404);
  const updated = await send(owner, 'put', '/api/trips/' + trip.id, { ...values, budget: 90000, saved: 25000 }).expect(200);
  assert.equal(updated.body.budget, 90000);
  const anotherSession = request.agent(app);
  await send(anotherSession, 'post', '/api/auth/login', { email: 'traveler@example.com', password }).expect(200);
  assert.equal((await anotherSession.get('/api/trips')).body[0].saved, 25000);
  await send(owner, 'delete', '/api/trips/' + trip.id).expect(204);
  assert.deepEqual((await owner.get('/api/trips')).body, []);
});

test('trip contributions are atomic, preserve cents, and allow fully funded goals', async () => {
  const agent = await account('trip-savings@example.com');
  const { body: trip } = await send(agent, 'post', '/api/trips', { name: 'Weekend away', budget: 0.3, saved: 0, targetDate: '' }).expect(201);
  const url = '/api/trips/' + trip.id + '/savings';
  await Promise.all([send(agent, 'post', url, { amount: 0.1 }).expect(200), send(agent, 'post', url, { amount: 0.2 }).expect(200)]);
  assert.equal((await agent.get('/api/trips')).body[0].saved, 0.3);
  await send(agent, 'post', url, { amount: 1 }).expect(200);
  assert.equal((await agent.get('/api/trips')).body[0].saved, 1.3);
  // Recording an existing travel fund must not mutate monthly financial records.
  assert.equal((await agent.get('/api/months/2026-10')).body.totals.remaining, 0);
});

test('trip validation rejects invalid money, dates, ownership fields, and excessive balances', async () => {
  const agent = await account('trip-validation@example.com');
  const base = { name: 'Japan', budget: 100000, saved: 0, targetDate: '' };
  for (const values of [{ ...base, budget: 0 }, { ...base, saved: -1 }, { ...base, saved: 0.001 }, { ...base, name: ' ' }, { ...base, targetDate: '2027-02-30' }, { ...base, userId: 'other' }]) {
    await send(agent, 'post', '/api/trips', values).expect(400);
  }
  const { body: trip } = await send(agent, 'post', '/api/trips', { ...base, saved: 1000000000 }).expect(201);
  for (const amount of [0, -1, 0.001, 1000000001]) await send(agent, 'post', '/api/trips/' + trip.id + '/savings', { amount }).expect(400);
  await send(agent, 'post', '/api/trips/' + trip.id + '/savings', { amount: 1 }).expect(400);
  await send(agent, 'delete', '/api/trips/not-an-id').expect(404);
});


test('CORS permits the exact client and credentialed preflights without allowing other origins', async () => {
  const allowed = await request(app).options('/api/months/2026-10/salary')
    .set('Origin', origin).set('Access-Control-Request-Method', 'PUT')
    .set('Access-Control-Request-Headers', 'content-type').expect(204);
  assert.equal(allowed.headers['access-control-allow-origin'], origin);
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
  assert.match(allowed.headers['access-control-allow-methods'], /PUT/);
  const rejected = await request(app).get('/api/auth/me').set('Origin', 'https://untrusted.example').expect(200);
  assert.equal(rejected.headers['access-control-allow-origin'], undefined);
  await request(app).post('/api/auth/logout').set('Origin', 'https://untrusted.example').send({}).expect(403);
});

test('API-only production uses secure cross-site cookies and clears matching logout cookies', async () => {
  const splitStore = MongoStore.create({ mongoUrl: mongo.getUri('pocket-tests') });
  try {
    const frontend = 'https://client.example';
    const splitApp = createApp({ store: splitStore, secret: 'split-hosting-test-secret-with-more-than-32-characters', origin: frontend, production: true, trustProxy: true, crossSiteCookies: true, serveClient: false });
    await request(splitApp).get('/').expect(404);
    await request(splitApp).get('/api/health').expect(200);
    const result = await request(splitApp).post('/api/auth/register').set('Origin', frontend).set('X-Forwarded-Proto', 'https').send({ email: 'split@example.com', password }).expect(201);
    const cookie = result.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=None/);
    assert.equal(result.headers['access-control-allow-origin'], frontend);
    const sessionCookie = cookie.split(';')[0];
    const me = await request(splitApp).get('/api/auth/me').set('Origin', frontend).set('X-Forwarded-Proto', 'https').set('Cookie', sessionCookie).expect(200);
    assert.equal(me.body.user.email, 'split@example.com');
    const logout = await request(splitApp).post('/api/auth/logout').set('Origin', frontend).set('X-Forwarded-Proto', 'https').set('Cookie', sessionCookie).send({}).expect(204);
    assert.match(logout.headers['set-cookie'][0], /SameSite=None/);
    assert.match(logout.headers['set-cookie'][0], /Secure/);
    const after = await request(splitApp).get('/api/auth/me').set('Cookie', sessionCookie).expect(200);
    assert.equal(after.body.user, null);
  } finally { await splitStore.close(); }
});

test('refuses unsafe cross-site session and origin configurations', () => {
  const base = { secret: 'configuration-test-secret-with-more-than-32-characters', origin };
  assert.throws(() => createApp({ ...base, crossSiteCookies: true }), /require production HTTPS/);
  assert.throws(() => createApp({ ...base, production: true }), /must use HTTPS/);
  assert.throws(() => createApp({ ...base, origin: origin + '/' }), /without a trailing slash/);
});
