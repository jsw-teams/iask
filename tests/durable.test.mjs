import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorFetch} from '../backend/durable.js';

test('identical concurrent reads share one DO call, but different identities and later reads do not',async()=>{
  let calls=0;const namespace={get:()=>({fetch:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return Response.json({ok:true});}})};
  const request=new Request('https://iask.example/api/comments',{headers:{Cookie:'reader=one'}});
  const responses=await Promise.all(Array.from({length:12},(_,index)=>coordinatorFetch(namespace,'thread',new Request(request,{headers:{Cookie:'reader=one','CF-Ray':String(index)}}))));
  assert.equal(calls,1);for(const response of responses)assert.deepEqual(await response.json(),{ok:true});
  await coordinatorFetch(namespace,'thread',request);assert.equal(calls,2);
  await Promise.all([coordinatorFetch(namespace,'thread',request),coordinatorFetch(namespace,'thread',new Request(request,{headers:{Cookie:'reader=two'}}))]);assert.equal(calls,4);
});

test('a disconnected read recreates its stub once and does not propagate client aborts into shared DO reads',async()=>{
  let calls=0,stubs=0;const namespace={get:()=>{stubs++;return {fetch:async request=>{calls++;assert.equal(request.signal.aborted,false);if(calls===1)throw Object.assign(new Error('Durable Object client disconnected'),{retryable:true});return Response.json({ok:true});}};}};
  const aborted=new AbortController();aborted.abort();const request=new Request('https://iask.example/read',{signal:aborted.signal});
  assert.deepEqual(await (await coordinatorFetch(namespace,'thread',request)).json(),{ok:true});assert.equal(calls,2);assert.equal(stubs,2);
});

test('writes, overloaded reads and application errors are never retried',async()=>{
  for(const [method,error] of [['POST',{retryable:true}],['DELETE',{retryable:true}],['GET',{retryable:true,overloaded:true}],['GET',{remote:true}]]){
    let calls=0;const failure=Object.assign(new Error('Disconnected'),error);const namespace={get:()=>({fetch:()=>{calls++;throw failure;}})};
    await assert.rejects(coordinatorFetch(namespace,'thread',new Request('https://iask.example/api',{method})),error=>error===failure);assert.equal(calls,1);
  }
});
