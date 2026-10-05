import {loadStickerCatalog,renderStickerText} from './stickers.js';

export function mountCommentEditor(input,locale){
 const editor=document.createElement('div'),controller=new AbortController(),options={signal:controller.signal};
 editor.className='comment-editor';editor.contentEditable='true';editor.setAttribute('role','textbox');editor.setAttribute('aria-multiline','true');editor.dir='auto';
 const label=input.previousElementSibling;label.id='comment-body-label';editor.setAttribute('aria-labelledby',label.id);editor.setAttribute('aria-describedby',input.getAttribute('aria-describedby'));
 input.hidden=true;input.after(editor);
 let packs=[],entries=new Map(),saved=null,composing=false,accepted=input.value;
 function text(node){
  if(node.nodeType===Node.TEXT_NODE)return node.data;
  if(node.nodeType!==Node.ELEMENT_NODE&&node.nodeType!==Node.DOCUMENT_FRAGMENT_NODE)return '';
  if(node.nodeName==='IMG')return entries.has(node.dataset.sticker)?node.dataset.sticker:'';
  if(node.nodeName==='BR')return '\n';
  if(node.childNodes.length===1&&node.firstChild.nodeName==='BR')return '';
  let value='';for(const child of node.childNodes){if(/^(DIV|P|LI)$/.test(child.nodeName)&&value&&!value.endsWith('\n'))value+='\n';value+=text(child);}return value;
 }
 function selection(){const range=getSelection()?.rangeCount?getSelection().getRangeAt(0):null;return range&&editor.contains(range.commonAncestorContainer)?range:null;}
 function remember(){const range=selection();if(range)saved=range.cloneRange();}
 function offset(){const range=selection()||saved;if(!range||!editor.contains(range.startContainer))return accepted.length;const before=document.createRange();before.selectNodeContents(editor);before.setEnd(range.startContainer,range.startOffset);return text(before.cloneContents()).length;}
 function caret(position){
  const range=document.createRange(),walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT,{acceptNode:n=>n.nodeType===Node.TEXT_NODE||n.nodeName==='IMG'?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP});let remaining=position,node;
  while(node=walker.nextNode()){
   const length=text(node).length;if(remaining<=length){if(node.nodeType===Node.TEXT_NODE)range.setStart(node,remaining);else if(remaining===0)range.setStartBefore(node);else range.setStartAfter(node);range.collapse(true);saved=range;return;}
   remaining-=length;
  }
  range.selectNodeContents(editor);range.collapse(false);saved=range;
 }
 function prepareImages(container){for(const image of container.querySelectorAll('img')){image.draggable=false;image.loading='eager';}}
 function render(value,position=value.length){renderStickerText(editor,value,packs,locale);prepareImages(editor);caret(position);}
 function commit(){
  if(composing)return;
  const value=text(editor);if(value.length>input.maxLength){render(accepted,Math.min(offset(),accepted.length));restore();return;}
  accepted=value;input.value=value;remember();input.dispatchEvent(new Event('input',{bubbles:true}));
 }
 function restore(){editor.focus();const range=saved&&editor.contains(saved.startContainer)?saved:null;if(range){const selected=getSelection();selected.removeAllRanges();selected.addRange(range);}}
 function insertText(value){
  restore();const selected=selection();if(!selected||input.disabled||input.readOnly)return false;
  if(text(editor).length-text(selected.cloneContents()).length+value.length>input.maxLength)return false;
  const fragment=document.createElement('div');renderStickerText(fragment,value,packs,locale);prepareImages(fragment);
  // Native editing transactions retain the browser's undo/redo history. Only
  // escaped text and images from the validated local catalog reach insertHTML.
  document.execCommand('insertHTML',false,fragment.innerHTML);commit();return true;
 }
 function useCatalog(value){packs=value;entries=new Map(packs.flatMap(pack=>pack.items.map(entry=>[entry.token,entry])));if(/:[a-z][a-z0-9-]{1,63}:/.test(text(editor))){const value=text(editor),position=offset();render(value,position);}}
 render(input.value);
 if(/:[a-z][a-z0-9-]{1,63}:/.test(input.value))void loadStickerCatalog().then(useCatalog).catch(()=>{});
 editor.addEventListener('input',commit,options);
 editor.addEventListener('compositionstart',()=>{composing=true;},options);
 editor.addEventListener('compositionend',()=>{composing=false;commit();},options);
 document.addEventListener('selectionchange',remember,options);
 editor.addEventListener('beforeinput',event=>{
  if(event.inputType.startsWith('format'))event.preventDefault();
  if(event.isComposing||!event.data)return;
  const range=selection(),removed=range?text(range.cloneContents()).length:0;
  if(text(editor).length-removed+event.data.length>input.maxLength)event.preventDefault();
 },options);
 editor.addEventListener('paste',event=>{event.preventDefault();remember();insertText(event.clipboardData.getData('text/plain'));},options);
 editor.addEventListener('drop',event=>event.preventDefault(),options);
 for(const action of ['copy','cut'])editor.addEventListener(action,event=>{const range=selection();if(!range||range.collapsed)return;event.preventDefault();event.clipboardData.setData('text/plain',text(range.cloneContents()));if(action==='cut'){document.execCommand('delete');commit();}},options);
 label.addEventListener('click',()=>editor.focus(),options);
 window.addEventListener('pagehide',()=>controller.abort(),{once:true});
 return {element:editor,useCatalog,insert(entry){if(!entries.has(entry.token))return false;return insertText(entry.token);},focus:restore,setValue(value){accepted=input.value=value;render(value);},setLocked(value){input.readOnly=value;editor.contentEditable=String(!value);editor.setAttribute('aria-readonly',String(value));}};
}
