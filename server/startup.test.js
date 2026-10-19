import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStartupSession } from '../client/src/startup.js';

test('startup wakes the backend before restoring the session',async()=>{
  const paths=[];
  const api=async(path,options)=>{paths.push(path);assert.equal(options.cache,'no-store');assert.ok(options.signal);return path==='/health'?{status:'ok'}:{user:null};};
  assert.deepEqual(await loadStartupSession(api),{user:null});assert.deepEqual(paths,['/health','/auth/me']);
});
test('sleeping backend errors retry safe GETs until the session is available',async()=>{
  let time=0,attempts=0;const paths=[];
  const api=async(path)=>{paths.push(path);if(++attempts===1)throw Object.assign(new Error('Waking up'),{status:503});if(attempts===3)throw Object.assign(new Error('Restarting'),{status:502});return path==='/health'?{status:'ok'}:{user:{email:'test@example.com'}};};
  const result=await loadStartupSession(api,{now:()=>time,sleep:async(ms)=>{time+=ms;},retryDelayMs:1000,timeoutMs:10000});
  assert.equal(result.user.email,'test@example.com');assert.deepEqual(paths,['/health','/health','/auth/me','/health','/auth/me']);assert.equal(time,2000);
});
test('startup stops retrying at its deadline and does not retry permanent configuration errors',async()=>{
  let time=0,calls=0;
  await assert.rejects(()=>loadStartupSession(async()=>{calls++;throw new TypeError('Offline');},{now:()=>time,sleep:async(ms)=>{time+=ms;},retryDelayMs:1000,timeoutMs:2500}),/taking longer/);
  assert.equal(time,2500);assert.equal(calls,3);
  calls=0;
  await assert.rejects(()=>loadStartupSession(async()=>{calls++;throw Object.assign(new Error('Forbidden'),{status:403});}),/Forbidden/);assert.equal(calls,1);
});
test('cancelled startup aborts pending requests rather than updating a stale screen',async()=>{
  const controller=new AbortController();let observed;
  const pending=loadStartupSession(async(_path,{signal})=>new Promise((_resolve,reject)=>{observed=signal;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});}),{signal:controller.signal});
  controller.abort();await assert.rejects(()=>pending,{name:'AbortError'});assert.equal(observed.aborted,true);
});
test('an unresponsive startup request is aborted and reaches a bounded error',async()=>{
  let cancellations=0;
  await assert.rejects(()=>loadStartupSession(async(_path,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{cancellations++;reject(new DOMException('Timeout','AbortError'));},{once:true})),{requestTimeoutMs:15,retryDelayMs:1,timeoutMs:40}),/taking longer/);
  assert.ok(cancellations>=1);
});
