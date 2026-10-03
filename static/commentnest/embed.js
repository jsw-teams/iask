import {dictionaries} from './locales.js';
import {renderWidget} from './markup.js';
import {initializeComments} from './comments.js';
const context=JSON.parse(document.getElementById('commentnest-context').textContent);
const locale=Object.hasOwn(dictionaries,context.locale)?context.locale:context.locale.startsWith('zh')?(context.locale==='zh-HK'?'zh-TW':'zh-CN'):'en';
document.documentElement.lang=locale;
const root=document.getElementById('commentnest');
root.innerHTML=renderWidget(context,{...dictionaries.en,...dictionaries[locale]});
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
});
resize();
