import {serviceFetch,imageResource,setWebsite} from './client.js';
import {loadStickerCatalog,localizedSticker,stickerImage,renderStickerText} from './stickers.js';
import {mountCommentEditor} from './editor.js';
export function initializeComments(context) {
  setWebsite(context.parent);
  const root = document.querySelector('[data-commentnest-comments]');
  if (!root) return;
  const thread = root.dataset.commentsThread || '';
  const list = root.querySelector('[data-comments-list]');
  const form = root.querySelector('[data-comments-form]');
  const status = root.querySelector('[data-comments-status]');
  const submit = form?.querySelector('button[type="submit"]');
  const account = root.querySelector('[data-comments-account]');
  const identity = root.querySelector('[data-comments-identity]');
  const signin = root.querySelector('[data-comments-signin]');
  const login = root.querySelector('[data-comments-login]');
  const logout = root.querySelector('[data-comments-logout]');
  let session = null;
  const tokenKey='commentnest-session';
  let bearer=null;
  try {bearer=sessionStorage.getItem(tokenKey);}catch{}
  const sessionHeaders=()=>bearer?{'X-Comments-Session':bearer}:{};
  let popup=null, loginChannel=null;
  if(login) {
    login.href='#';
    login.addEventListener('click',event=>{
      event.preventDefault();
      loginChannel=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
      popup=window.open('/auth','commentnest-login-'+loginChannel,'popup,width=620,height=740');
      if(!popup){setStatus(messages.error,true);return;}
    });
    window.addEventListener('message',event=>{
      if(event.origin===location.origin && event.source===popup && event.data?.type==='commentnest:login-ready' && loginChannel){popup.postMessage({type:'commentnest:login-start',channel:loginChannel,loading:messages.loading,error:messages.error},location.origin);return;}
      if(event.origin!==location.origin || event.source!==popup || event.data?.type!=='commentnest:login' || event.data.channel!==loginChannel)return;
      popup.postMessage({type:'commentnest:login-ack',channel:loginChannel},location.origin);
      bearer=typeof event.data.token==='string' && event.data.token.length<=2048?event.data.token:null;
      try {bearer?sessionStorage.setItem(tokenKey,bearer):sessionStorage.removeItem(tokenKey);}catch{}
      popup=null;loginChannel=null;loadComments();
    });
  }
  const bodyInput = form?.elements.namedItem('body');
  const companyInput = form?.elements.namedItem('company');
  const attachmentInput = form?.elements.namedItem('attachments');
  const attachmentList = root.querySelector('[data-comments-attachments]');
  let uploadedAttachments = [];
  // Keep the persisted draft key stable across the public project rename.
  const draftKey = 'reporelay-draft:' + thread;
  try { if (bodyInput) bodyInput.value = sessionStorage.getItem(draftKey) || ''; } catch {}
  const bodyEditor=bodyInput?mountCommentEditor(bodyInput,context.locale):null;
  bodyInput?.addEventListener('input', () => {
    try { sessionStorage.setItem(draftKey, bodyInput.value); } catch {}
  });
  const messages = {
    delete: root.dataset.commentsDeleteLabel || 'Delete',
    deleteConfirm: root.dataset.commentsDeleteConfirm || 'Delete this comment?',
    cancel: root.dataset.commentsCancel || 'Cancel',
    deleted: root.dataset.commentsDeleted || 'Comment deleted.',
    removeAttachment: root.dataset.commentsRemoveAttachment || 'Remove image',
    stickersError: root.dataset.commentsStickersError || 'The sticker gallery is unavailable.',
    loading: root.dataset.commentsLoading || 'Loading comments…',
    empty: root.dataset.commentsEmpty || 'No comments yet.',
    error: root.dataset.commentsError || 'Comments are unavailable right now.',
    posted: root.dataset.commentsPosted || 'Comment posted.',
    closed: root.dataset.commentsClosed || 'Comments are closed.',
    count: root.dataset.commentsCount || '{count} comments',
    service: root.dataset.commentsServiceUnavailable || 'Comment service is temporarily unavailable. Your draft is kept.',
    limited: root.dataset.commentsRateLimited || 'Comments are busy. Please try again later. Your draft is kept.',
    reset: root.dataset.commentsThreadReset || 'This comment thread was removed. A new thread will start with the next comment.',
    attachment: root.dataset.commentsAttachmentLabel || 'Images / GIFs',
    attachmentHelp: root.dataset.commentsAttachmentHelp || 'Up to 4 PNG, JPEG, GIF, WebP or AVIF files, 5 MB each.',
    attachmentTooLarge: root.dataset.commentsAttachmentTooLarge || 'That file is too large.',
    attachmentInvalid: root.dataset.commentsAttachmentInvalid || 'That file type is not supported.',
    uploading: root.dataset.commentsUploading || 'Uploading attachment…'
  };

  function backendMessage(error) {
    if (error.message === 'comments_rate_limited') return messages.limited;
    if (['comments_credentials_unavailable', 'comments_permission_denied', 'comments_unavailable'].includes(error.message)) return messages.service;
    return messages.error;
  }

  function setStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = isError ? 'error' : 'ready';
  }

  function countLabel(count) {
    return messages.count.replace('{count}', new Intl.NumberFormat(context.locale || document.documentElement.lang).format(count));
  }

  function renderAttachments(urls, container) {
    for (const url of Array.isArray(urls) ? urls : []) {
      let asset;
      try { asset = new URL(url); } catch { continue; }
      if (asset.origin !== location.origin || !/^\/api\/comments\/media\/[a-f0-9]{24}\/[a-f0-9]{24}\/[0-9a-f-]{36}\.(png|jpg|gif|webp|avif)$/.test(asset.pathname)) continue;
      const link = document.createElement('a');
      link.target = '_blank';link.rel = 'nofollow noopener';
      const image = document.createElement('img');
      image.alt = messages.attachment;image.loading = 'lazy';image.decoding = 'async';image.className = 'comment-attachment-image';
      imageResource(asset.pathname.slice('/api/comments/media/'.length)).then(url=>{if(image.isConnected){image.src=url;link.href=url;}}).catch(()=>link.remove());
      link.append(image);
      container.append(link);
    }
  }

  function renderPendingAttachments() {
    if (!attachmentList) return;
    attachmentList.replaceChildren();
    for (const attachment of uploadedAttachments) {
      const item = document.createElement('div');
      item.className = 'comment-attachment-preview';
      const image = document.createElement('img');
      image.src = attachment.previewUrl || attachment.url;
      image.alt = messages.attachment;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', messages.removeAttachment);
      remove.addEventListener('click', () => {
        if(attachment.previewUrl)URL.revokeObjectURL(attachment.previewUrl);
        uploadedAttachments = uploadedAttachments.filter(entry => entry.url !== attachment.url);
        renderPendingAttachments();
      });
      item.append(image, remove);
      attachmentList.append(item);
    }
  }

  async function uploadAttachment(file) {
    if (!file || !['image/png','image/jpeg','image/gif','image/webp','image/avif'].includes(file.type)) {
      throw new Error('attachment_invalid');
    }
    if (file.size > (context.maxAttachmentBytes || 5_000_000)) throw new Error('attachment_too_large');
    const response = await serviceFetch('upload', {
      thread,
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...sessionHeaders(),
        Accept: 'application/json',
        'Content-Type': file.type,
        'X-Comments-CSRF': session?.csrf || ''
      },
      body: file
    });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok || !data?.url) {
      const error = new Error(data?.error || 'comments_request_failed');
      error.status = response.status;
      throw error;
    }
    return {...data,previewUrl:URL.createObjectURL(file)};
  }

  function avatar(id, name) {
    const wrapper=document.createElement('span');wrapper.className='comment-avatar';wrapper.setAttribute('aria-hidden','true');
    wrapper.dataset.initial=String(name || '?').slice(0,1).toUpperCase();
    if(Number.isSafeInteger(id) && id>0) {
      const image=document.createElement('img');imageResource(String(id),'avatar').then(url=>{if(image.isConnected)image.src=url;}).catch(()=>image.remove());image.alt='';image.width=40;image.height=40;image.loading='lazy';image.decoding='async';
      image.addEventListener('error',()=>image.remove(),{once:true});wrapper.append(image);
    }
    return wrapper;
  }

  function renderComment(comment) {
    const item = document.createElement('li');
    item.className = 'comment-item';

    const article = document.createElement('article');
    const header = document.createElement('header');
    header.className = 'comment-meta';
    const author = document.createElement('a');
    author.textContent = '@' + (comment.author || 'GitHub');
    if (/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(comment.author)) author.href = 'https://github.com/' + comment.author;
    author.rel = 'nofollow';
    const time = document.createElement('time');
    if (comment.createdAt) {
      time.dateTime = comment.createdAt;
      const date = new Date(comment.createdAt);
      time.textContent = Number.isNaN(date.valueOf()) ? comment.createdAt : new Intl.DateTimeFormat(context.locale || document.documentElement.lang || undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
    }
    header.append(avatar(comment.authorId,comment.author), author, time);

    const body = document.createElement('p');
    body.className = 'comment-body';
    body.textContent = comment.body || '';
    if (/:[a-z][a-z0-9-]{1,63}:/.test(comment.body || ''))loadStickerCatalog().then(packs=>{if(body.isConnected)renderStickerText(body,comment.body,packs,context.locale);}).catch(()=>{});
    article.append(header, body);
    if (Array.isArray(comment.attachments) && comment.attachments.length) {
      const media = document.createElement('div');
      media.className = 'comment-attachments';
      renderAttachments(comment.attachments, media);
      article.append(media);
    }
    if (session?.user && Number.isSafeInteger(comment.authorId) && comment.authorId === session.user.id) {
      const actions = document.createElement('div');
      actions.className = 'comment-actions';
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'comment-secondary'; remove.textContent = messages.delete;
      remove.dataset.commentsDelete = comment.id;
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'comment-secondary'; cancel.textContent = messages.cancel; cancel.hidden = true;
      let confirming = false;
      const reset = () => {confirming=false;remove.textContent=messages.delete;cancel.hidden=true;remove.disabled=false;cancel.disabled=false;};
      cancel.addEventListener('click',()=>{reset();remove.focus();});
      remove.addEventListener('click',async()=>{
        if (!confirming) {confirming=true;remove.textContent=messages.deleteConfirm;cancel.hidden=false;return;}
        remove.disabled=true;cancel.disabled=true;
        try {
          const data=await requestJson('comments',{method:'DELETE',headers:{'Content-Type':'application/json','X-Comments-CSRF':session.csrf},body:JSON.stringify({commentId:comment.id})});
          if (!data?.ok) throw new Error('comments_request_failed');
          item.remove();setStatus(messages.deleted);
          (list.querySelector('[data-comments-delete]') || (!form?.hidden ? bodyEditor : logout))?.focus();
        } catch(error) {
          reset();
          if (['login_required','invalid_csrf'].includes(error.message)) {
            session=null;form.hidden=true;account.hidden=true;signin.hidden=false;
            for(const action of list.querySelectorAll('.comment-actions'))action.hidden=true;
            setStatus(root.dataset.commentsLoginRequired || 'Sign in with GitHub to comment.',true);login?.focus();
          } else {setStatus(backendMessage(error),true);remove.focus();}
        }
      });
      actions.append(remove,cancel);article.append(actions);
    }
    item.append(article);
    return item;
  }

  function renderComments(comments) {
    if (!list) return;
    list.replaceChildren(...comments.map(renderComment));
  }

  async function requestJson(action, options) {
    const response = await serviceFetch(action, {
      thread,
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: { Accept: 'application/json', ...sessionHeaders(), ...(options?.headers || {}) }
    });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(data?.error || 'comments_request_failed');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function loadComments() {
    setStatus(messages.loading);
    try {
      const data = await requestJson('comments');
      const comments = Array.isArray(data?.comments) ? data.comments : [];
      try { session = await requestJson('session'); if(!session?.user && bearer){bearer=null;try{sessionStorage.removeItem(tokenKey);}catch{}session=await requestJson('session');} } catch { session = null; }
      renderComments(comments);
      if (form) form.hidden = !session?.user || !!data.closed;
      if (account) account.hidden = !session?.user;
      if (signin) signin.hidden = !session || !!session.user;
      if (identity) {
        identity.replaceChildren();
        if(session?.user)identity.append(avatar(session.user.id,session.user.login),document.createTextNode('@'+session.user.login));
      }
      if (data.closed) {setStatus(messages.closed);return;}
      setStatus(!session ? messages.error : data.threadReset ? messages.reset : comments.length ? countLabel(comments.length) : messages.empty, !session);
    } catch (error) {
      if (form) form.hidden = true;
      if (account) account.hidden = true;
      if (signin) signin.hidden = true;
      setStatus(backendMessage(error), true);
    }
  }

  const stickerToggle=root.querySelector('[data-comments-stickers-toggle]');
  const stickerPanel=root.querySelector('[data-comments-stickers]');
  const stickerPacks=root.querySelector('[data-comments-sticker-packs]');
  const stickerGrid=root.querySelector('[data-comments-sticker-grid]');
  const localized=value=>localizedSticker(value,context.locale);
  function showPack(pack) {
    stickerGrid.replaceChildren();
    for(const tab of stickerPacks.children)tab.setAttribute('aria-pressed',String(tab.dataset.pack===pack.id));
    for(const entry of pack.items) {
      const button=document.createElement('button');button.type='button';button.className='comment-sticker';
      button.setAttribute('aria-label',localized(entry.label));button.title=localized(entry.label);
      button.append(stickerImage(entry,context.locale,true));
      button.addEventListener('click',()=>{
        if(session?.user && !submit.disabled)bodyEditor?.insert(entry);
      });
      stickerGrid.append(button);
    }
  }
  stickerToggle?.addEventListener('click',async()=>{
    if(!stickerPanel || !session?.user)return;
    stickerPanel.hidden=!stickerPanel.hidden;stickerToggle.setAttribute('aria-expanded',String(!stickerPanel.hidden));
    if(stickerPanel.hidden)return;
    try {
      const packs=await loadStickerCatalog();
      bodyEditor?.useCatalog(packs);
      if(!stickerPacks.children.length) {
        for(const pack of packs) {
          const button=document.createElement('button');button.type='button';button.className='comment-secondary';
          button.textContent=localized(pack.label);button.dataset.pack=pack.id;
          button.addEventListener('click',()=>showPack(pack));stickerPacks.append(button);
        }
        showPack(packs[0]);
      }
    }catch{setStatus(messages.stickersError,true);}
  });
  stickerPanel?.addEventListener('keydown',event=>{
    if(event.key==='Escape'){stickerPanel.hidden=true;stickerToggle.setAttribute('aria-expanded','false');stickerToggle.focus();}
  });

  attachmentInput?.addEventListener('change', async () => {
    if (attachmentInput.disabled) return;
    attachmentInput.disabled = true;
    if (stickerToggle) stickerToggle.disabled = true;
    if (submit) submit.disabled = true;
    const files = [...(attachmentInput.files || [])];
    attachmentInput.value = '';
    if (!files.length) { attachmentInput.disabled = false; if(stickerToggle)stickerToggle.disabled=false; if (submit) submit.disabled = false; return; }
    for (const file of files) {
      if (uploadedAttachments.length >= 4) break;
      try {
        setStatus(messages.uploading);
        const uploaded = await uploadAttachment(file);
        uploadedAttachments.push(uploaded);
        renderPendingAttachments();
        setStatus(uploadedAttachments.length ? messages.attachmentHelp : messages.empty);
      } catch (error) {
        if (error.message === 'attachment_too_large' || error.message === 'payload_too_large') setStatus(messages.attachmentTooLarge, true);
        else if (['attachment_invalid','unsupported_media_type','invalid_media'].includes(error.message)) setStatus(messages.attachmentInvalid, true);
        else setStatus(backendMessage(error), true);
      }
    }
    attachmentInput.disabled = false;
    if (stickerToggle) stickerToggle.disabled = false;
    if (submit) submit.disabled = false;
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (attachmentInput?.disabled) return;
    if (!form.reportValidity() || (!String(bodyInput?.value || '').trim() && uploadedAttachments.length === 0)) return;
    if (submit) submit.disabled = true;
    if (attachmentInput) attachmentInput.disabled = true;
    if (stickerToggle) stickerToggle.disabled = true;
    setStatus(messages.loading);
    bodyEditor?.setLocked(true);
    try {
      const data = await requestJson('comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Comments-CSRF': session?.csrf || '' },
        body: JSON.stringify({
          body: String(bodyInput?.value || ''),
          attachments: uploadedAttachments.map(({url, receipt}) => ({url, receipt})),
          company: String(companyInput?.value || '')
        })
      });
      if (data?.comment && list) list.append(renderComment(data.comment));
      bodyEditor?.setValue('');
      for(const attachment of uploadedAttachments)if(attachment.previewUrl)URL.revokeObjectURL(attachment.previewUrl);
      uploadedAttachments = [];
      renderPendingAttachments();
      try { sessionStorage.removeItem(draftKey); } catch {}
      const count = list?.children.length || 0;
      setStatus(messages.posted + (count ? ' ' + countLabel(count) : ''));
    } catch (error) {
      if (['login_required', 'invalid_csrf'].includes(error.message)) {
        if (form) form.hidden = true;
        if (account) account.hidden = true;
        if (signin) signin.hidden = false;
        setStatus(root.dataset.commentsLoginRequired || 'Sign in with GitHub to comment.', true);
      } else if (error?.status === 409) {
        if (form) form.hidden = true;
        setStatus(messages.closed, true);
      } else {
        if (error.status === 503 && form) form.hidden = true;
        setStatus(backendMessage(error), true);
      }
    } finally {
      if (attachmentInput) attachmentInput.disabled = false;
      if (stickerToggle) stickerToggle.disabled = false;
      if (submit) submit.disabled = false;
      bodyEditor?.setLocked(false);
    }
  });

  logout?.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await requestJson('logout', { method: 'POST', headers: { 'X-Comments-CSRF': session?.csrf || '' } });
      bearer=null;
      try {sessionStorage.removeItem(tokenKey);}catch{}
      await loadComments();
    } catch { setStatus(messages.error, true); }
    finally { logout.disabled = false; }
  });

  void loadComments();
}
