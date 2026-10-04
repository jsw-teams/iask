import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {isIP} from 'node:net';
import {Readable} from 'node:stream';
import {websiteOrigin} from '../static/commentnest/website.js';

export function publicAddress(address) {
  if(isIP(address)===4) {
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || a===169&&b===254 || a===172&&b>=16&&b<=31 ||
      a===192&&(b===168 || b===0&&(c===0||c===2) || b===88&&c===99) || a===100&&b>=64&&b<=127 ||
      a===198&&(b===18 || b===19 || b===51&&c===100) || a===203&&b===0&&c===113);
  }
  if(isIP(address)===6) {
    const value=address.toLowerCase();
    return /^[23][0-9a-f]{3}:/.test(value) && !/^2001:(?:0*:|0?db8:|0?2:|0?10:|0?20:)/.test(value) && !value.startsWith('2002:');
  }
  return false;
}

// Node hosts must not turn an arbitrary embedding origin into private-network I/O.
// Pin the validated address through TLS connection setup to prevent DNS rebinding.
export async function fetchPublicManifest(value,{resolveHost=lookup,send=request}={}) {
  const url=new URL(value);
  if(!websiteOrigin(url.origin) || url.pathname!=='/edgepress/service-contexts.json' || url.search || url.hash)throw new Error('Invalid website manifest');
  const signal=AbortSignal.timeout(5000);
  const addresses=await Promise.race([
    resolveHost(url.hostname,{all:true,verbatim:true}),
    new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('Website lookup timed out')),{once:true}))
  ]);
  if(signal.aborted || !addresses.length || addresses.some(item=>!publicAddress(item.address)))throw new Error('Website must resolve to public addresses');
  const selected=addresses.find(item=>item.family===4) || addresses[0];
  return new Promise((resolve,reject)=>{
    const outgoing=send(url,{
      method:'GET',agent:false,signal,
      headers:{Accept:'application/json'},
      lookup:(_host,options,callback)=>options.all?callback(null,[selected]):callback(null,selected.address,selected.family)
    },incoming=>{
      const headers=new Headers();
      for(const [name,value] of Object.entries(incoming.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
      resolve(new Response([204,205,304].includes(incoming.statusCode)?null:Readable.toWeb(incoming),{status:incoming.statusCode,headers}));
    });
    outgoing.once('error',reject);
    outgoing.end();
  });
}
