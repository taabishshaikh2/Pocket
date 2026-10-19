import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { createGateway } from '../gateway/app.js';

test('gateway preserves API paths, JSON bodies, Origin, and host-only cookies', async () => {
  const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'pocket.sid=test; Path=/; Secure; HttpOnly; SameSite=Lax'});res.end(JSON.stringify({path:req.url,method:req.method,body:JSON.parse(body),origin:req.headers.origin,proto:req.headers['x-forwarded-proto'],cookie:req.headers.cookie}));});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const app=createGateway({target:'http://127.0.0.1:'+server.address().port,trustProxy:true});
    const response=await request(app).put('/api/months/2026-10/salary?source=test').set('Origin','https://frontend.example').set('X-Forwarded-Proto','https').set('Cookie','pocket.sid=existing').send({salary:50,received:'2026-10-01'}).expect(200);
    assert.equal(response.body.path,'/api/months/2026-10/salary?source=test');assert.equal(response.body.method,'PUT');assert.equal(response.body.body.salary,50);
    assert.equal(response.body.origin,'https://frontend.example');assert.equal(response.body.proto,'https');assert.equal(response.body.cookie,'pocket.sid=existing');
    assert.match(response.headers['set-cookie'][0],/HttpOnly/);assert.equal(response.headers['cache-control'],'no-store');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('gateway refuses unsafe target configuration',()=>{
  assert.throws(()=>createGateway({target:'https://example.com/path'}),/without a path/);
  assert.throws(()=>createGateway({target:'http://example.com',production:true}),/must use HTTPS/);
  assert.throws(()=>createGateway({target:'https://user:password@example.com'}),/without a path/);
});
