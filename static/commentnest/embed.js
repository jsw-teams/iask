import {loadDictionary,direction,canonicalLocale} from './i18n.js';
import {renderWidget} from './markup.js';
import {initializeComments} from './comments.js';
import {embeddingWebsite} from './website.js';
const initial=JSON.parse(document.getElementById('commentnest-context').textContent);
async function start(context) {
const {locale,messages}=await loadDictionary(context.locale,context.localeFiles);
document.documentElement.lang=locale;
document.documentElement.dir=direction(context.locale);
context.locale=canonicalLocale(context.locale);
const root=document.getElementById('commentnest');
root.innerHTML=renderWidget(context,messages);
initializeComments(context);
const post=payload=>parent.postMessage({...payload,channel:context.channel},context.parent);
root.querySelector('[data-comments-privacy]')?.addEventListener('click',()=>post({type:'commentnest:privacy'}));
let framePending=false,lastHeight=0;
function resize() {
  if(framePending)return;
  framePending=true;
  requestAnimationFrame(()=>{
    framePending=false;
    const height=Math.ceil(root.getBoundingClientRect().height)+2;
    if(height!==lastHeight){lastHeight=height;post({type:'commentnest:resize',height});}
  });
}
new ResizeObserver(resize).observe(root);
root.addEventListener('load',resize,true);
window.addEventListener('message',event=>{
  if(event.source!==parent || event.origin!==context.parent || event.data?.channel!==context.channel || event.data.type!=='commentnest:theme')return;
  const theme=event.data.theme;
  document.documentElement.dataset.theme=['light','dark'].includes(theme)?theme:'auto';
  const palette=event.data.palette;
  if (palette && typeof palette === 'object') for(const [key,value] of Object.entries(palette)) {
    if (['canvas','surface','ink','muted','line','accent','accent-soft','focus','danger'].includes(key) && typeof value === 'string' && /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s/]+\))$/i.test(value)) document.documentElement.style.setProperty('--'+key,value);
  }
});
post({type:'commentnest:ready',title:messages.commentsTitle});
resize();

}
if(initial.thread)void start(initial);
else {
  let started=false;
  window.addEventListener('message',async event=>{
    const data=event.data;
    if(started || event.source!==parent || data?.type!=='commentnest:init')return;
    const website=await embeddingWebsite(initial.websites || [{origin:initial.parent,prefix:''}],event.origin);
    if(started || !website || !/^[a-f0-9]{32}$/.test(data.channel || '') || typeof data.thread!=='string' || !data.thread || (website.prefix+data.thread).length>240 || /[\x00-\x1f\x7f]/.test(data.thread) || typeof data.title!=='string' || data.title.length>500)return;
    started=true;void start({...initial,parent:website.origin,thread:website.prefix+data.thread,title:data.title,channel:data.channel,locale:canonicalLocale(data.locale),theme:['light','dark'].includes(data.theme)?data.theme:'auto'});
  });
}
