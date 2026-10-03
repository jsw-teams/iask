// Loaded by the host only after the visitor enables this integration.
export function mount(root, options={}) {
  if(!root || root.dataset.commentnestMounted)return;
  const backend=new URL(options.backendUrl || new URL(import.meta.url).origin);
  if(backend.protocol!=='https:' || backend.username || backend.password || backend.pathname!=='/' || backend.search || backend.hash)throw new Error('Invalid CommentNest backend URL');
  root.dataset.commentnestMounted='true';
  const channel=Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
  const address=new URL('/commentnest/embed',backend);
  const inferredTheme=document.documentElement.dataset.theme;
  address.search=new URLSearchParams({thread:root.dataset.commentsThread || '',title:root.dataset.commentsTitle || document.title,locale:document.documentElement.lang || 'en',parent:location.origin,channel,theme:['light','dark'].includes(inferredTheme)?inferredTheme:'auto'});
  const frame=document.createElement('iframe');
  frame.title=root.dataset.commentsLabel || 'Comments · CommentNest';
  frame.referrerPolicy='no-referrer';
  frame.style.cssText='display:block;width:100%;max-width:100%;height:280px;border:0;margin:0;padding:0;box-sizing:border-box;';
  frame.setAttribute('allow','');
  const listen=event=>{
    if(event.source!==frame.contentWindow || event.origin!==backend.origin || event.data?.channel!==channel)return;
    if(event.data.type==='commentnest:resize' && Number.isFinite(event.data.height))frame.style.height=Math.ceil(Math.min(100_000,Math.max(120,event.data.height)))+'px';
    if(event.data.type==='commentnest:privacy')document.dispatchEvent(new CustomEvent('edgepress:privacy-open'));
  };
  window.addEventListener('message',listen);
  frame.addEventListener('load',()=>{
    const send=()=>frame.contentWindow?.postMessage({type:'commentnest:theme',channel,theme:['light','dark'].includes(document.documentElement.dataset.theme)?document.documentElement.dataset.theme:'auto'},backend.origin);
    send();
    const observer=new MutationObserver(send);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    window.addEventListener('pagehide',()=>{observer.disconnect();window.removeEventListener('message',listen);},{once:true});
  },{once:true});
  frame.src=address.href;
  root.style.minWidth='0';root.style.width='100%';root.style.boxSizing='border-box';
  root.replaceChildren(frame);
}
