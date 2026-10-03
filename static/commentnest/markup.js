const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderWidget(document, dictionary) {
  const limit = String((document.maxAttachmentBytes || 5_000_000)/1_000_000)+' MB';
  const label = key => escape((dictionary[key] || key).replaceAll('5 MB',limit));
  const messages = {
    loading:'commentsLoading',empty:'commentsEmpty',error:'commentsError',posted:'commentsPosted',closed:'commentsClosed',count:'commentsCount',
    'login-required':'commentsLoginRequired','service-unavailable':'commentsServiceUnavailable','rate-limited':'commentsRateLimited',
    'thread-reset':'commentsThreadReset','attachment-label':'commentAttachment','attachment-help':'commentAttachmentHelp',
    'attachment-too-large':'commentAttachmentTooLarge','attachment-invalid':'commentAttachmentInvalid',uploading:'commentAttachmentUploading',
    'delete-label':'commentDelete','delete-confirm':'commentDeleteConfirm',cancel:'commentCancel',deleted:'commentDeleted',
    'remove-attachment':'commentRemoveAttachment','stickers-label':'commentStickers','stickers-error':'commentStickersError'
  };
  const attributes = Object.entries(messages).map(([attribute,key]) => ' data-comments-' + attribute + '="' + label(key) + '"').join('');
  return '<section id="comments" class="post-comments" data-commentnest-comments data-comments-thread="' + escape(document.thread) +
    '" data-comments-title="' + escape(document.title) + '"' + attributes + '>' +
    '<header class="post-comments-header"><div><span class="comment-eyebrow">' + label('projectName') + '</span><h2>' + label('commentsTitle') + '</h2></div></header>' +
    '<p class="comments-status" data-comments-status role="status" aria-live="polite">' + label('commentsLoading') + '</p>' +
    '<ol class="comment-list" data-comments-list></ol>' +
    '<div class="comment-account" data-comments-account hidden><span data-comments-identity></span><button type="button" class="comment-secondary" data-comments-logout>' + label('commentsLogout') + '</button></div>' +
    '<div class="comment-welcome" data-comments-signin hidden><span class="comment-welcome-text">' + label('commentsLoginRequired') + '</span><a class="comment-login" data-comments-login>' + label('commentsLogin') + '</a></div>' +
    '<form class="comment-form" data-comments-form hidden><label><span>' + label('commentBody') +
    '</span><textarea name="body" rows="5" maxlength="5000" aria-describedby="comment-notice" dir="auto"></textarea></label>' +
    '<div class="comment-toolbar"><button type="button" class="comment-secondary" data-comments-stickers-toggle aria-expanded="false" aria-controls="comment-stickers">' + label('commentStickers') + '</button>' +
    '<label class="comment-attachment-picker"><span>' + label('commentAttachment') + '</span><input name="attachments" type="file" aria-describedby="comment-attachment-help" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" multiple></label></div>' +
    '<section id="comment-stickers" class="comment-stickers" data-comments-stickers hidden aria-label="' + label('commentStickers') + '">' +
    '<div class="comment-sticker-packs" data-comments-sticker-packs></div><div class="comment-sticker-grid" data-comments-sticker-grid></div></section>' +
    '<small id="comment-attachment-help" class="comment-note">' + label('commentAttachmentHelp') + '</small><div class="comment-attachment-list" data-comments-attachments></div>' +
    '<div class="comment-honeypot" aria-hidden="true"><label>Company<input name="company" type="text" tabindex="-1" autocomplete="off"></label></div>' +
    '<button type="submit" class="comment-primary">' + label('commentSubmit') + '</button><p id="comment-notice" class="comment-note">' + label('commentNotice') + '</p>' +
    '</form><footer class="comment-footer"><button type="button" class="comment-privacy" data-comments-privacy>' + label('privacySettings') + '</button></footer><noscript><p class="comment-note">' + label('commentsNeedJavaScript') + '</p></noscript></section>';
}
