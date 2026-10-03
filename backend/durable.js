const reads = new WeakMap();

// Coalesce identical concurrent reads, never mutations or completed responses.
// A fresh stub is required after a transient infrastructure failure.
export async function coordinatorFetch(namespace, id, request) {
  const readable = request.method === 'GET' || request.method === 'HEAD';
  if (!readable) return namespace.get(id).fetch(request);
  let pending = reads.get(namespace);
  if (!pending) {pending = new Map(); reads.set(namespace,pending);}
  const tracing=new Set(['cf-ray','traceparent','tracestate','x-request-id']);
  const key = JSON.stringify([String(id),request.method,request.url,[...request.headers].filter(([name])=>!tracing.has(name)).sort()]);
  if (pending.has(key)) return (await pending.get(key)).clone();
  const task = (async()=>{
    for (let attempt=0;;attempt++) {
      try {
        const response=await namespace.get(id).fetch(new Request(request,{signal:new AbortController().signal}));
        // These coordinator reads already return bounded JSON or buffered images.
        // Finish the DO response before tying delivery to an individual browser.
        const body=request.method==='HEAD'||[204,205,304].includes(response.status)?null:await response.arrayBuffer();
        return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
      }
      catch(error) {
        const transient=error?.retryable===true || (!error?.remote && /disconnected|reset because its code was updated/i.test(error?.message || ''));
        if (attempt>=1 || !transient || error?.overloaded) throw error;
        await new Promise(resolve=>setTimeout(resolve,25+Math.floor(Math.random()*50)));
      }
    }
  })();
  if (pending.size<128) pending.set(key,task);
  try{return (await task).clone();}
  finally{if(pending.get(key)===task)pending.delete(key);}
}
