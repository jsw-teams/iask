let catalogPromise;
const tokenPattern=/:[a-z][a-z0-9-]{1,63}:/g;
export const localizedSticker=(value,locale=document.documentElement.lang)=>typeof value==='string'?value:value?.[locale] || value?.[locale.split('-')[0]] || value?.en || '';
export function loadStickerCatalog() {
  return catalogPromise ??= fetch('/commentnest/stickers/packs.json',{credentials:'same-origin',redirect:'error'}).then(async response=>{
    if(!response.ok)throw new Error('sticker_catalog_unavailable');
    const text=await response.text();
    if(text.length>200_000)throw new Error('sticker_catalog_unavailable');
    const catalog=JSON.parse(text),tokens=new Set();
    if(!Array.isArray(catalog.packs))throw new Error('sticker_catalog_unavailable');
    const packs=catalog.packs.slice(0,20).map(pack=>{
      if(typeof pack.id!=='string' || !localizedSticker(pack.label) || !Array.isArray(pack.items))throw new Error('sticker_catalog_unavailable');
      return {...pack,items:pack.items.slice(0,100).map(entry=>{
        if(typeof entry.token!=='string' || !/^:[a-z][a-z0-9-]{1,63}:$/.test(entry.token) || tokens.has(entry.token) ||
          typeof entry.src!=='string' || !/^\/commentnest\/stickers\/mascots\/[a-z][a-z0-9-]*(?:\.[a-f0-9]{16})?\.(?:png|webp)$/.test(entry.src) || !localizedSticker(entry.label))throw new Error('sticker_catalog_unavailable');
        tokens.add(entry.token);return entry;
      })};
    });
    if(!packs.length)throw new Error('sticker_catalog_unavailable');
    return packs;
  }).catch(error=>{catalogPromise=null;throw error;});
}
export function stickerImage(entry,locale,decorative=false) {
  const image=document.createElement('img');
  image.className='comment-inline-sticker';image.src=entry.src;image.alt=decorative?'':localizedSticker(entry.label,locale);
  image.dataset.sticker=entry.token;
  image.width=64;image.height=64;image.loading='lazy';image.decoding='async';
  return image;
}
export function renderStickerText(container,text,packs,locale) {
  const entries=new Map(packs.flatMap(pack=>pack.items.map(entry=>[entry.token,entry]))),fragment=document.createDocumentFragment();
  let offset=0;
  for(const match of String(text).matchAll(tokenPattern)) {
    fragment.append(document.createTextNode(text.slice(offset,match.index)));
    fragment.append(entries.has(match[0])?stickerImage(entries.get(match[0]),locale):document.createTextNode(match[0]));
    offset=match.index+match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(offset)));container.replaceChildren(fragment);
}
