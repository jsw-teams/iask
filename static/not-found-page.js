export const notFoundStyles = `:root{color-scheme:light dark;--paper:#f5f1e7;--panel:#e9e2d3;--ink:#243b32;--muted:#56645a;--accent:#315e49;--line:#c8cebe}
*{box-sizing:border-box}
body{min-height:100svh;margin:0;display:flex;flex-direction:column;background:var(--paper);color:var(--ink);font:16px/1.8 system-ui,-apple-system,"Segoe UI",sans-serif}
.site-header,main,footer{width:min(1100px,calc(100% - 48px));margin-inline:auto}
.site-header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:24px 0;border-bottom:1px solid var(--line)}
.brand{font-size:1.3rem;font-weight:750;letter-spacing:.04em}
.site-note{color:var(--muted);font-size:.9rem}
main{flex:1;display:grid;grid-template-columns:minmax(280px,.8fr) minmax(0,1fr);align-items:center;gap:clamp(28px,6vw,90px);padding-block:clamp(48px,8vh,100px)}
.bear-scene{position:relative;display:grid;justify-items:center;margin:0;min-width:0;padding:36px 22px 24px;background:var(--panel);border:1px solid var(--line);border-radius:48% 48% 20px 20px}
.bear-scene img,.bear-scene svg{display:block;width:192px;max-width:100%;height:auto;margin:24px 0 18px;filter:drop-shadow(0 8px 10px #0002)}
.route-sign{display:flex;align-items:center;gap:16px;color:var(--accent);font-size:3rem;font-weight:800;line-height:1}
.route-sign span{font-size:1rem;font-weight:600;padding-left:16px;border-left:1px solid var(--line)}
figcaption{max-width:24ch;color:var(--muted);font-size:.92rem;text-align:center;line-height:1.7}
.eyebrow{color:var(--accent);font-size:.9rem;font-weight:650;letter-spacing:.04em;margin:0 0 12px}
h1{margin:0 0 24px;font-size:clamp(1.85rem,3.6vw,3.2rem);line-height:1.35;letter-spacing:-.025em;text-wrap:balance}
.description{max-width:37em;margin:0 0 18px;color:var(--muted)}
.proverb{margin:0 0 12px;padding-left:18px;border-left:3px solid var(--accent);font-size:1.1rem;font-weight:650;line-height:1.5}
.proverb p{margin:0}
.encouragement{margin:0 0 22px;max-width:37em}
.hint{margin:0 0 28px;font-size:.92rem}
.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:9px 22px;background:var(--accent);color:var(--paper);border-radius:8px;text-decoration:none;font-weight:650}
.button:hover{filter:brightness(.9)}
a:focus-visible{outline:3px solid var(--accent);outline-offset:5px}
.skip-link{position:fixed;top:8px;left:16px;z-index:2;transform:translateY(-160%);padding:10px 18px;background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:8px}
.skip-link:focus{transform:none}
footer{padding:22px 0;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
@media(prefers-color-scheme:dark){:root{--paper:#17241f;--panel:#23372d;--ink:#ecf0e7;--muted:#bac8bb;--accent:#b5d4a8;--line:#455c4c}.bear-scene img,.bear-scene svg{filter:drop-shadow(0 8px 10px #0004)}}
@media(max-width:680px){.site-header,main,footer{width:calc(100% - 32px)}.site-header{padding:18px 0}.site-note{font-size:.8rem}main{grid-template-columns:1fr;gap:28px;padding-block:32px}.bear-scene{width:min(100%,320px);justify-self:center;padding:24px 18px 20px}.bear-scene img,.bear-scene svg{width:168px;margin:16px 0}.route-sign{font-size:2.4rem}.message{max-width:440px;margin-inline:auto}h1{font-size:1.85rem;margin-bottom:18px}footer{font-size:.8rem}}
@media(forced-colors:active){.button{border:1px solid ButtonText}.bear-scene{border:1px solid CanvasText}}
`;

const escapeAttribute = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const fallbackBear = `<svg width="192" height="192" viewBox="0 0 192 192" role="img" aria-label="A friendly black bear beside a sign pointing toward a fresh start.">
  <path d="M151 42v112" stroke="#8c7554" stroke-width="9" stroke-linecap="round"/>
  <path d="M113 39h56l13 15-13 15h-56z" fill="#315e49"/><path d="M137 54h23m-7-6 7 6-7 6" fill="none" stroke="#f5f1e7" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <ellipse cx="79" cy="165" rx="59" ry="9" fill="#56645a" opacity=".2"/>
  <ellipse cx="74" cy="126" rx="45" ry="42" fill="#25302d"/><circle cx="37" cy="48" r="17" fill="#25302d"/><circle cx="103" cy="48" r="17" fill="#25302d"/>
  <circle cx="70" cy="76" r="43" fill="#25302d"/><ellipse cx="70" cy="90" rx="23" ry="17" fill="#e9e2d3"/>
  <circle cx="53" cy="73" r="4" fill="#f5f1e7"/><circle cx="88" cy="73" r="4" fill="#f5f1e7"/><ellipse cx="70" cy="85" rx="7" ry="5" fill="#25302d"/>
  <path d="M61 96q9 8 18 0" fill="none" stroke="#25302d" stroke-width="3" stroke-linecap="round"/>
  <path d="m53 122 21 16 22-16" fill="none" stroke="#e9e2d3" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M107 119q20-4 28-25" fill="none" stroke="#25302d" stroke-width="20" stroke-linecap="round"/>
</svg>`;

// One page template serves the static build and the asset-free backend fallback.
export function notFoundPage({stylesheet, illustration} = {}) {
  const style = stylesheet ? `<link rel="stylesheet" href="${escapeAttribute(stylesheet)}">` : `<style>${notFoundStyles}</style>`;
  const image = illustration ? `<img src="${escapeAttribute(illustration)}" width="192" height="192" alt="A thoughtful black bear checking whether this path leads anywhere.">` : fallbackBear;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#244438">
  <title>404 — A little detour | iask</title>
  ${style}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header"><span class="brand">iask</span><span class="site-note">Good questions. New paths.</span></header>
  <main id="main" tabindex="-1">
    <figure class="bear-scene">
      <span class="route-sign" aria-hidden="true">404 <span>A little detour</span></span>
      ${image}
      <figcaption>Our bear checked twice. Even behind the sign. Still no page.</figcaption>
    </figure>
    <div class="message">
      <p class="eyebrow">404 — Resource not found</p>
      <h1>This path took<br>a wrong turn.</h1>
      <p class="description">We couldn't find a resource at the requested address. The link may have a typo, or the page may have moved.</p>
      <blockquote class="proverb"><p>“Where there's a will, there's a way.”</p></blockquote>
      <p class="encouragement">A missing page isn't a dead end. Keep your curiosity, check the link, and give your next step a chance.</p>
      <p class="hint">Looking for a discussion? Return to the article you were reading and open its comments.</p>
      <a class="button" href="https://js.gripe/iask/">Meet iask</a>
    </div>
  </main>
  <footer>A small detour. Plenty of possibilities ahead.</footer>
</body>
</html>
`;
}
