import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
import {handleServiceRequest} from '../backend/service.js';
import {appDefaults} from './helpers.mjs';
import {signValue} from '../backend/auth.js';
const backend='https://comments.example.com',website='https://journal.example.com';
const assets=fileURLToPath(new URL('../static/',import.meta.url));
const stickerAssets=fileURLToPath(new URL('../content/assets/commentnest/stickers/',import.meta.url));
const env={...appDefaults,COMMENTNEST_SITE_ORIGIN:backend,COMMENTNEST_WEBSITE_ORIGIN:website,COMMENTNEST_REPOSITORY:'owner/comments',COMMENTNEST_GITHUB_APP_CLIENT_ID:'app',COMMENTNEST_GITHUB_APP_CLIENT_SECRET:'client-secret',COMMENTNEST_SESSION_SECRET:'s'.repeat(64),COMMENTNEST_IDENTITY_SECRET:'i'.repeat(64)};
const token=await signValue({id:17,login:'RealReader',csrf:'csrf',exp:Date.now()+600000},{REPORELAY_SITE_ORIGIN:backend,REPORELAY_REPOSITORY:'owner/comments',REPORELAY_SESSION_SECRET:env.COMMENTNEST_SESSION_SECRET},'session');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1EAAAAASUVORK5CYII=','base64');
test('independent widget: cross-origin loading, safe comments, avatars, real stickers, deletion, drafts and layouts',async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {let cases=0;
 for(const locale of ['en','zh-CN','zh-SG','zh-TW'])for(const width of [360,820,1440])for(const mode of ['light','dark']) {
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:mode});
  let loggedIn=true,posted=null,failure=null,deleted=0,uploaded=0,apis=0,catalogs=0,avatarFetches=0;
  const errors=[],requestFailures=[];
  context.on('page',opened=>opened.on('requestfailed',request=>requestFailures.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText})));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url()),method=route.request().method();
   const fulfill=data=>route.fulfill({json:data});
   if(url.origin===website)return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="'+locale+'" data-theme="'+mode+'"><style>body{margin:24px}header{padding-left:130px}form{margin-left:170px}iframe{max-width:100%}section{margin:0}</style><main><section id="comments" data-comments-thread="article" data-comments-title="Article"></section></main><script type="module">import{mount}from"'+backend+'/commentnest/widget.js";mount(document.getElementById("comments"),{backendUrl:"'+backend+'"});</script></html>'});
   // Redirect responses bypass subsequent Playwright route handlers. A document
   // navigation keeps the mocked provider callback inside this offline fixture.
   if(url.origin==='https://github.com')return route.fulfill({contentType:'text/html',body:'<!doctype html><script>location.replace('+JSON.stringify(backend+'/commentnest/auth-complete?channel='+url.searchParams.get('channel'))+')</script>'});
   assert.equal(url.origin,backend);
   if(url.pathname==='/api') {
    assert.equal(url.search,'');
    const headers=route.request().headers(),action=headers['x-service-action'];
    const paths={comments:'/api/comments',session:'/api/comments/session',logout:'/api/comments/logout',login:'/api/comments/login',upload:'/api/comments/media/'};
    if(action==='login')return fulfill({url:'https://github.com/login/oauth/authorize?channel='+headers['x-service-channel']});
    if(action==='avatar'){avatarFetches++;url.pathname='/api/comments/avatar/'+decodeURIComponent(headers['x-service-resource']);}
    else if(action==='media')url.pathname='/api/comments/media/'+decodeURIComponent(headers['x-service-resource']);
    else url.pathname=paths[action];
    if(action==='comments')assert.equal(decodeURIComponent(headers['x-service-thread']),'article');
   }
   if(['/api/comments','/api/comments/session'].includes(url.pathname))apis++;
   if(url.pathname==='/api/comments/session') {const authorized=loggedIn || route.request().headers()['x-comments-session']===token;return fulfill({user:authorized?{id:17,login:'RealReader'}:null,csrf:authorized?'csrf':null});}
   if(url.pathname==='/api/comments/login') {
    const completed=new URL(url.searchParams.get('return'),backend);
    assert.equal(completed.pathname,'/commentnest/auth-complete');
    const response=await handleServiceRequest(new Request(completed,{headers:{Cookie:'__Host-reporelay_session='+token}}),env);
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
   }
   if(url.pathname==='/commentnest/auth-complete') {
    const response=await handleServiceRequest(new Request(url,{headers:{Cookie:'__Host-reporelay_session='+token}}),env);
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
   }
   if(url.pathname==='/api/comments/logout'){loggedIn=false;return fulfill({ok:true});}
   if(url.pathname.startsWith('/api/comments/avatar/'))return route.fulfill({contentType:'image/png',body:pixel});
   if(url.pathname==='/api/comments/media/' && method==='POST') {
    assert.equal(route.request().headers()['x-comments-csrf'],'csrf');uploaded++;
    return fulfill({url:backend+'/api/comments/media/'+'a'.repeat(24)+'/'+'b'.repeat(24)+'/12345678-1234-1234-1234-123456789012.png',receipt:'receipt'});
   }
   if(url.pathname.startsWith('/api/comments/media/'))return route.fulfill({contentType:'image/png',body:pixel});
   if(url.pathname==='/api/comments') {
    if(method==='DELETE'){if(failure)return route.fulfill({status:502,json:{error:'comments_backend_error'}});assert.deepEqual(route.request().postDataJSON(),{commentId:'123'});deleted++;return fulfill({ok:true});}
    if(method==='POST') {posted=route.request().postDataJSON();assert.equal(route.request().headers()['x-comments-csrf'],'csrf');assert.ok(!Object.hasOwn(posted,'name'));return fulfill({comment:{id:'123',author:'RealReader',authorId:17,body:posted.body,attachments:posted.attachments.map(item=>item.url),createdAt:'2026-10-03T12:00:00Z'}});}
    return fulfill({comments:[],closed:false});
   }
   if(url.pathname==='/commentnest/embed' || url.pathname==='/frame' || url.pathname==='/auth') {
    const response=await handleServiceRequest(new Request(url),env);
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
   }
   const base=url.pathname.startsWith('/commentnest/stickers/')?stickerAssets:assets;
   const file=resolve(base,url.pathname.startsWith('/commentnest/stickers/')?url.pathname.slice('/commentnest/stickers/'.length):url.pathname.slice(1));assert.ok(file.startsWith(base.replace(/[\\/]$/,'')+sep));
   if(url.pathname.endsWith('/packs.json'))catalogs++;
   const types={'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
   try{return route.fulfill({body:await readFile(file),contentType:types[extname(file)] || 'text/plain',headers:{'Access-Control-Allow-Origin':website}});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(website+'/article/');
  const frame=page.frameLocator('iframe');await frame.locator('[data-comments-form]').waitFor({state:'visible'});
  assert.equal(apis,2);assert.equal(catalogs,0);assert.equal(await frame.locator('[data-comments-identity]').textContent(),'@RealReader');
  const textarea=frame.locator('[name=body]');await textarea.fill('<img src=x onerror=alert(1)>');
  await textarea.focus();await page.keyboard.press('Tab');assert.ok(await frame.locator('[data-comments-stickers-toggle]').evaluate(node=>node===document.activeElement));
  await frame.locator('button[type=submit]').click();await frame.locator('.comment-item').waitFor();
  assert.equal(await frame.locator('.comment-body img').count(),0);assert.equal(await frame.locator('.comment-body').textContent(),'<img src=x onerror=alert(1)>');
  assert.equal(await frame.locator('.comment-item .comment-avatar img').count(),1);
  assert.equal(avatarFetches,1,'Repeated identities share one avatar request within this frame');
  assert.ok(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const layout=await frame.locator('.comment-form').evaluate(form=>({left:form.getBoundingClientRect().left,right:form.getBoundingClientRect().right,width:innerWidth}));assert.ok(layout.left<55 && layout.right<=layout.width,'Host stylesheet must not shift the widget');
  await page.waitForFunction(()=>{const iframe=document.querySelector('iframe');return parseInt(iframe.style.height)>350;});
  if(locale==='en' && width===360 && mode==='light') {
   const remove=frame.locator('[data-comments-delete]');await textarea.fill('Keep my draft');await remove.click();assert.equal(deleted,0);
   await frame.locator('.comment-actions button').last().click();await remove.click();failure=true;await remove.click();await frame.locator('[data-state=error]').waitFor();assert.equal(await frame.locator('.comment-item').count(),1);
   failure=false;await remove.click();await remove.click();await frame.locator('.comment-item').waitFor({state:'detached'});assert.equal(deleted,1);assert.equal(await textarea.inputValue(),'Keep my draft');
   await frame.locator('[data-comments-stickers-toggle]').click();await frame.locator('.comment-sticker').first().waitFor();assert.equal(await frame.locator('.comment-sticker').count(),5);assert.equal(catalogs,1);
   await textarea.fill('Before old After');await textarea.evaluate(node=>node.setSelectionRange(7,10));
   await frame.locator('[data-comments-sticker-packs] button').last().click();await frame.locator('.comment-sticker').last().click();
   assert.equal(await textarea.inputValue(),'Before :panda-perfect: After');assert.equal(uploaded,0);assert.equal(await frame.locator('.comment-attachment-preview').count(),0);
   assert.equal(await textarea.evaluate(node=>sessionStorage.getItem('reporelay-draft:article')), 'Before :panda-perfect: After');
   await frame.locator('.comment-sticker').first().focus();await page.keyboard.press('Escape');assert.ok(await frame.locator('[data-comments-stickers]').isHidden());
   await frame.locator('button[type=submit]').click();await frame.locator('.comment-body .comment-inline-sticker').waitFor();assert.equal(posted.body,'Before :panda-perfect: After');assert.ok(!Object.hasOwn(posted,'thread'));assert.ok(!Object.hasOwn(posted,'title'));assert.equal(posted.attachments.length,0);assert.equal(await frame.locator('.comment-body img').getAttribute('alt'),'Perfect score');
   assert.equal(await frame.locator('.comment-eyebrow').count(),1);assert.ok(!(await frame.locator('.comment-footer').textContent()).includes('iask'));
   await textarea.fill('Survives refresh');await page.reload();await frame.locator('[data-comments-form]').waitFor({state:'visible'});assert.equal(await textarea.inputValue(),'Survives refresh');
   const heightBefore=await page.locator('iframe').getAttribute('style');
   await page.evaluate(()=>{document.querySelector('iframe').contentWindow.postMessage({type:'commentnest:login',channel:'fake',token:'forged'},'*');window.postMessage({type:'commentnest:resize',channel:'fake',height:99999},'*');});
   await page.waitForTimeout(50);assert.equal(await page.locator('iframe').getAttribute('style'),heightBefore);
  }
  await frame.locator('[data-comments-logout]').click();await frame.locator('[data-comments-signin]').waitFor({state:'visible'});assert.ok(await frame.locator('[data-comments-form]').isHidden());
  if(locale==='en' && width===360 && mode==='light') {
   const popupEvent=page.waitForEvent('popup');await frame.locator('[data-comments-login]').click();const popup=await popupEvent;
   await frame.locator('[data-comments-form]').waitFor({state:'visible'}).catch(error=>{throw new Error('Login popup failed: '+JSON.stringify({closed:popup.isClosed(),url:popup.url(),errors,requestFailures})+'; '+error.message);});
   assert.equal(await frame.locator('body').evaluate(()=>sessionStorage.getItem('commentnest-session')),token);
   await page.reload();await frame.locator('[data-comments-form]').waitFor({state:'visible'});
   assert.equal(await frame.locator('[data-comments-identity]').textContent(),'@RealReader');
   await frame.locator('[data-comments-logout]').click();await frame.locator('[data-comments-signin]').waitFor({state:'visible'});assert.equal(await frame.locator('body').evaluate(()=>sessionStorage.getItem('commentnest-session')),null);
   if(!popup.isClosed())await popup.close();
  }
  assert.deepEqual(errors,[]);await context.close();cases++;
 }
 assert.equal(cases,24);
 }finally{await browser.close();}
});
