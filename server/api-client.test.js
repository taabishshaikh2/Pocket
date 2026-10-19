import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, authenticateAndVerify } from '../client/src/api.js';

test('client uses the configured API origin and includes session credentials', async () => {
  let call;
  const api = createApiClient('https://pocket-api.example/', async (url, options) => {
    call = { url, options }; return { ok: true, status: 200, json: async () => ({ email: 'test@example.com' }) };
  });
  await api('/auth/login', { method: 'POST', body: { email: 'test@example.com', password: 'test-only' } });
  assert.equal(call.url, 'https://pocket-api.example/api/auth/login');
  assert.equal(call.options.credentials, 'include');
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(call.options.body).email, 'test@example.com');
});
test('client keeps local proxy support and handles no-content and failed responses', async () => {
  let called;
  const api = createApiClient('', async url => { called = url; return { ok: true, status: 204 }; });
  assert.equal(await api('/auth/logout', { method: 'POST' }), null);
  assert.equal(called, '/api/auth/logout');
  const denied = createApiClient('', async () => ({ ok: false, status: 401, json: async () => ({ error: 'Please sign in.' }) }));
  await assert.rejects(() => denied('/trips'), error => error.status === 401 && error.message === 'Please sign in.');
  const html = createApiClient('', async () => ({ ok: true, status: 200, json: async () => { throw new Error('HTML'); } }));
  await assert.rejects(() => html('/auth/me'), /invalid response/);
  assert.throws(() => createApiClient('https://example.com/api'), /without a path/);
});


test('sign-in requires a persisted browser session before showing the dashboard', async () => {
  const calls=[];
  const accepted=async(path)=>{calls.push(path);return path==='/auth/me'?{user:{email:'test@example.com',role:'user'}}:{email:'test@example.com'};};
  assert.deepEqual(await authenticateAndVerify(accepted,'login',{email:'test@example.com',password:'test-only'}),{email:'test@example.com',role:'user'});
  assert.deepEqual(calls,['/auth/login','/auth/me']);
  const blocked=async(path)=>path==='/auth/me'?{user:null}:{email:'test@example.com'};
  await assert.rejects(()=>authenticateAndVerify(blocked,'login',{}),/could not keep you signed in/);
  await assert.rejects(()=>authenticateAndVerify(blocked,'register',{}),/could not keep you signed in/);
});
