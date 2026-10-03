# CommentNest · 评巢

A self-hosted comment service for websites. CommentNest owns the widget, styling, translations, GitHub sign-in, avatars, sticker gallery, uploads and deletion. A website supplies its backend URL and published article context, and loads the widget only after the visitor opts in.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jsw-teams/CommentNest)

The button copies this repository to your GitHub account and creates your Worker. Supply your own GitHub App settings and exact website/service origins during setup. Deploying the template does not register or install a GitHub App for you. The project does not depend on a service operated by its author.

[中文安装与 EdgePress 接入](docs/edgepress.md) · [Release notes](CHANGELOG.md) · [Storage and upgrade policy](docs/lifecycle.md)

## Project layout

`backend/` owns the Worker, GitHub App authorization, comment API and Durable Objects. `static/commentnest/` owns the widget HTML renderer, CSS, translations and browser interaction. `content/assets/commentnest/stickers/` is the only source of sticker images and their catalog. `tools/` builds deployable assets in `dist/`. EdgePress supplies a configured backend URL and article context; it contains no comment editor or comment stylesheet.

## Features

- An automatically sized iframe isolates the comment UI from the site's theme. Responsive layouts, light and dark modes, keyboard navigation, English, Simplified Chinese and Traditional Chinese.
- GitHub App authorization verifies visitors. Repository credentials and GitHub access tokens stay on the server.
- Avatars, profile links, plain text comments, a real local sticker gallery and image uploads.
- Delete your own comments: user ID, signature and thread ownership are verified on the server.
- Moderate using GitHub Issues: close/lock discussions, remove comments or delete an Issue.
- Stable discussions for published articles/pages, shared across translations. Unknown threads are rejected.
- Durable Objects serialize writes and persist thread mappings and signing keys. No manual signing secrets, installation IDs or bot logins.
- Cross-origin widgets sign in through a first-party popup and keep a signed CommentNest session in iframe session storage. GitHub login does not require third-party cookies, and the GitHub access token never enters browser storage.

## Deploy

Use the button above, or clone this repository and run `npm ci`, `npm test`, `npm run build`, then `npm run deploy`. Development requires Node.js 22.12 or later. Edit [wrangler.jsonc](wrangler.jsonc):

| Setting | Value |
| --- | --- |
| `COMMENTNEST_SITE_ORIGIN` | Exact HTTPS origin of the comment Worker, such as `https://comments.example.com` |
| `COMMENTNEST_WEBSITE_ORIGIN` | Exact HTTPS origin of the embedding website, such as `https://journal.example.com` |
| `COMMENTNEST_REPOSITORY` | Your `owner/repository` with Issues enabled |
| `COMMENTNEST_GITHUB_APP_ID` | App ID from GitHub |
| `COMMENTNEST_GITHUB_APP_CLIENT_ID` | Client ID from GitHub |

Store the complete PEM private key and client secret as Worker Secrets:

```sh
npx wrangler secret put COMMENTNEST_GITHUB_APP_PRIVATE_KEY
npx wrangler secret put COMMENTNEST_GITHUB_APP_CLIENT_SECRET
```

The Deploy button asks for the same Secrets using [.dev.vars.example](.dev.vars.example). Never commit a filled `.dev.vars`, private key or client secret. Signing keys are generated on first use and stored persistently. Keep the Durable Object namespace when upgrading.

Register your own GitHub App with the exact callback `<COMMENTNEST_SITE_ORIGIN>/api/comments/callback`. Turn off webhooks, wildcard callbacks and device flow. Grant **Metadata: read**, **Issues: read/write** and **Contents: read/write**. Install it only on the chosen comment repository, which needs an initial commit for media storage. Visitors authorize their identity; they do not install the App on their repositories.

## Connect a website

EdgePress needs `provider: commentnest` and `backendUrl` inside its consent service configuration. See the [complete configuration](docs/edgepress.md). It supplies the article's thread ID, title and locale, and loads the widget after consent. When using a separately deployed service, the website needs no CommentNest npm dependency, GitHub App keys, comment CSS or sticker files.

For other website builders, add a container and load this module after your consent system permits comments:

```html
<section id="comments" data-comments-thread="article-id" data-comments-title="Article title"></section>
```

```js
const backendUrl = siteConfig.comments.backendUrl;
const {mount} = await import(new URL('/commentnest/widget.js', backendUrl).href);
mount(document.getElementById('comments'), {backendUrl});
```

Publish the allowlist at your configured website origin, `/edgepress/comment-threads.json`:

```json
[{"thread":"article-id","title":"Article title"}]
```

EdgePress generates this file from published articles and explicit `comments` page blocks. Other builders should generate it during their own build. The service fetches it only from the configured origin; visitors cannot provide a manifest URL or register arbitrary discussions. The manifest is limited to one million bytes.

## Multiple websites

Deploy one CommentNest instance per website. Each has its own exact website origin, backend origin, repository configuration and Durable Object namespace. You may reuse an App that you own by registering every instance's exact callback in that App; other operators register their own App. No origin is supplied by the project author.

Existing same-origin sites can compose the independently owned service with their static website Worker:

```js
import website from './website-worker.js';
import {handleServiceRequest} from '@jsw-teams/commentnest';
export {CommentCoordinator} from '@jsw-teams/commentnest';
export default {async fetch(request, env, ctx) {
  return await handleServiceRequest(request, env) || website.fetch(request, env, ctx);
}};
```

Install the package from a pinned commit or release; it is not published to npm. Run `commentnest assets dist` after the website's build to copy package-owned widget resources into its static output, and route `/api/comments*` and `/commentnest/*` through the Worker. This composition belongs to the site deployment, not the EdgePress framework. Existing App Secrets and formal comment storage can remain in their original Worker.

## API and limits

The API remains `/api/comments`: read with `?thread=`, submit with POST, delete with DELETE and `{thread,commentId}`. The service owns `/session`, `/login`, `/callback`, `/logout`, `/media/` and `/avatar/<user-id>` below that prefix. Writes require the service's exact Origin, a signed visitor session and `X-Comments-CSRF`. Uploads also require `X-Comments-Thread`.

Comments accept 5,000 characters and four PNG, JPEG, GIF, WebP or AVIF attachments of five million bytes each. Upload receipts and sessions expire after one day. Attachments are public only while referenced by a valid published comment. Deleting the comment or Issue stops service access; underlying files require separate removal. Public attachment responses use `no-store`. Validated file bytes may be cached internally for five minutes, but every request checks the current Issue and signed comment before accessing that cache. Drafts and the cross-origin session remain in the iframe's session storage until cleared, submitted, logged out or expired.

The local sticker gallery uses licensed Noto Emoji images. Extend `content/assets/commentnest/stickers/packs.json` with licensed images or GIFs and retain attribution. No third-party sticker API is called.

## Cost control

Nothing loads before consent. The widget makes no background polling requests. Scripts, stylesheets, catalogs and sticker images receive content fingerprints and long-lived caching; the small loader revalidates after 60 seconds. The gallery loads only when opened. Avatars are cached for one day. Concurrent signing-key reads coalesce, and Worker memory reuses persistent keys for five minutes without replacing their source in Durable Objects. Attachment-byte caching reduces GitHub downloads while retaining fresh deletion checks. Keep the existing DO namespace on upgrades; no alarms or per-request signing objects are created. Cache API entries are local to a data center and may be evicted, so caching reduces expected traffic rather than imposing a hard spending limit. Monitor usage and configure CPU limits and billing notifications for your Cloudflare plan.

## License

MIT for project code. Bundled sticker artwork retains its included Apache 2.0 license and attribution.
