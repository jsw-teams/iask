function channels(value) {
  if (/^#[\da-f]{6}$/i.test(value)) return [1,3,5].map(offset=>parseInt(value.slice(offset,offset+2),16)/255);
  const match=/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*(1(?:\.0+)?))?\s*\)$/i.exec(value);
  return match ? match.slice(1,4).map(Number).map(value=>value/255) : null;
}
export function contrast(a,b) {
  const luminance=value=>{
    const rgb=channels(value);if(!rgb || rgb.some(value=>value<0 || value>1))return null;
    const linear=rgb.map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
    return .2126*linear[0]+.7152*linear[1]+.0722*linear[2];
  };
  const x=luminance(a),y=luminance(b);
  return x===null || y===null ? 0 : (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function hostPalette(root) {
  const style=getComputedStyle(root), body=getComputedStyle(document.body);
  const pick=(...names)=>names.map(name=>style.getPropertyValue(name).trim()).find(Boolean);
  const canvas=pick('--canvas','--background','--bg','--color-background') || body.backgroundColor;
  const ink=pick('--ink','--text','--foreground','--color-text') || body.color;
  if(contrast(canvas,ink)<4.5)return {};
  const palette={canvas,ink,line:ink,danger:ink};
  const surface=pick('--surface','--bg-secondary','--color-surface');
  if(surface && contrast(surface,ink)>=4.5)palette.surface=surface;
  // Use the foreground color as a safe fallback when no accessible host accent exists.
  palette.accent=ink;palette.muted=ink;palette.focus=ink;
  for(const [key,names] of Object.entries({muted:['--muted','--text-muted'],accent:['--accent','--primary','--color-primary'],focus:['--focus','--focus-color']})) {
    const value=pick(...names);
    if(value && contrast(value,canvas)>=4.5 && (!palette.surface || contrast(value,palette.surface)>=4.5))palette[key]=value;
  }
  palette['accent-soft']=palette.surface || canvas;
  return palette;
}
