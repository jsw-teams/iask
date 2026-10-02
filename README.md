# RepoRelay

RepoRelay lets a website use a private GitHub repository without sending repository credentials to visitors. GitHub App user authorization identifies the visitor; a repository-scoped installation token performs the server-side operations.

Each operator self-hosts the Worker and registers their own GitHub App. The callback is generated from that instance's required `REPORELAY_SITE_ORIGIN`; there is no default callback or upstream service hosted by the project author. Other instances keep working independently if JS.GRIPE stops operating.

The first application is the article discussion system on [JS.GRIPE](https://js.gripe). This repository also includes an example for publishing an explicitly allowed private file behind application authentication.

## What it provides

- One readable Issue per article, shared across language versions.
- Verified GitHub identity, PKCE, same-origin requests, CSRF and signed comment metadata.
- PNG, JPEG, GIF, WebP and AVIF attachments: four per comment, five million bytes per file.
- Signed upload receipts tied to the uploading visitor and article.
- A Durable Object per repository, namespace and article to serialize first comments and persist the Issue number.
- Moderation through GitHub: delete a comment, close/lock a thread, or delete an Issue to start a replacement on the next submission.
- A server-only file client restricted to one configured repository, with read-only installation tokens by default.

The browser renders comment text as text. Images have validated signatures and explicit image response types. Repository keys and GitHub tokens remain on the server. Attachment URLs are public: use the upload interface only for images intended for publication.

## Installation

Node.js 22.12 or later is required for development. There are no runtime npm dependencies.

```sh
git clone https://github.com/jsw-teams/RepoRelay.git
cd RepoRelay
npm test
npm pack --dry-run
```

For an application, install from GitHub and commit the resulting lockfile. Use a specific commit for reproducible deployments; this package is not currently published to npm.

```sh
npm install github:jsw-teams/RepoRelay#v0.2.1
```

## Register and install a GitHub App

Create an App in your GitHub account. Set the website's exact callback URL, for example `https://comments.example.com/api/comments/callback`. Disable webhook delivery and device flow. Keep wildcard callback matching off. User authorization happens when a visitor chooses to sign in on the website.

Repository permissions for comments and media:

| Permission | Access |
| --- | --- |
| Metadata | Read |
| Issues | Read and write |
| Contents | Read and write |

Install the App only on the chosen storage repository. It must have Issues enabled and an initial commit for the media branch. The public source repository and the private comment repository are separate roles. Generate a client secret and a private key. PKCS#1 and PKCS#8 PEM keys are supported.

The installation ID is the number in the installation settings URL. The bot login is `<app-slug>[bot]`. See [GitHub user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) and [repository-scoped installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).

## Configure a comment Worker

Start from [examples/comments/wrangler.jsonc](examples/comments/wrangler.jsonc). Replace its IDs, repository, origin and namespace. Deploy a Worker that exports `CommentCoordinator`, and bind `REPORELAY_THREADS` to it with a SQLite Durable Object migration. The [Cloudflare Durable Objects guide](https://developers.cloudflare.com/durable-objects/get-started/) describes these bindings.

```js
import { handleCommentRequest } from '@jsw-teams/reporelay';
export { CommentCoordinator } from '@jsw-teams/reporelay';

export default {
  async fetch(request, env) {
    return await handleCommentRequest(request, env) || env.ASSETS.fetch(request);
  }
};
```

Required variables:

```text
REPORELAY_REPOSITORY=owner/private-repository
REPORELAY_NAMESPACE=production-v2
REPORELAY_SITE_ORIGIN=https://comments.example.com
REPORELAY_GITHUB_APP_ID=<App ID>
REPORELAY_GITHUB_APP_INSTALLATION_ID=<Installation ID>
REPORELAY_GITHUB_APP_CLIENT_ID=<Client ID>
REPORELAY_GITHUB_APP_BOT_LOGIN=<app-slug>[bot]
```

Add these Worker Secrets with Wrangler or the Cloudflare dashboard:

```sh
npx wrangler secret put REPORELAY_GITHUB_APP_PRIVATE_KEY
npx wrangler secret put REPORELAY_GITHUB_APP_CLIENT_SECRET
npx wrangler secret put REPORELAY_SESSION_SECRET
npx wrangler secret put REPORELAY_IDENTITY_SECRET
```

Use separate random secrets of at least 32 characters for session and identity signing. Never commit `.dev.vars` or private keys. For local development, copy `.dev.vars.example` to the example directory and fill it there. The HTTPS origin must match the request origin exactly.

The trusted `ASSETS` binding supplies `/edgepress/comment-threads.json`:

```json
[{"thread":"hello-world","title":"Hello world"}]
```

Generate this allowlist from published articles. Visitors cannot register arbitrary articles or set the displayed thread title.

## API integration

| Endpoint | Use |
| --- | --- |
| `GET /api/comments?thread=<id>` | Read a published discussion |
| `GET /api/comments/login?return=/article/` | Begin GitHub authorization |
| `GET /api/comments/callback` | Complete authorization |
| `GET /api/comments/session` | Read visitor identity and CSRF token |
| `POST /api/comments/logout` | Clear the session |
| `POST /api/comments/media/` | Upload image bytes |
| `GET /api/comments/media/<namespace>/<hash>/<file>` | Read a published image |
| `POST /api/comments` | Submit a comment |

Every write requires the website Origin, session cookie and `X-Comments-CSRF`. Uploads additionally require `X-Comments-Thread` and an image Content-Type. Retain the returned `url` and `receipt`; submit them together:

```json
{"thread":"hello-world","body":"Hello 👋","attachments":[{"url":"<upload URL>","receipt":"<upload receipt>"}],"company":""}
```

Comments accept 5,000 characters and may contain images without text. Upload receipts expire after one day. The session also expires after one day. Load the API and authentication only after the visitor enables the optional comment integration; reading the main article needs neither service.

Closing or locking an Issue also blocks uploads. Deleted Issue recovery checks repository access before creating a replacement. An ambiguous comment write is never retried automatically. An ambiguous Issue creation stays pending until a matching Issue appears in GitHub search; it does not risk a duplicate. If GitHub did not create that Issue, an operator must resolve the object's `creating` flag before retrying.

## Fresh data only

Protocol v2 deliberately has no OAuth App/PAT fallback or legacy session, thread, comment, media or draft migration. Only `REPORELAY_*` configuration is read. Session cookies end in `_v2`, signed values bind the namespace, and Issue markers include `reporelay-thread:v2:<namespace>:<hash>`.

Choose distinct production and test namespaces. Changing the namespace starts a separate discussion collection. Keep old test Issues and media separate; do not relabel or import them. Invalid or older relay comment metadata is excluded from results. Ordinary maintainer replies in a valid v2 Issue remain visible.

Deleting a comment removes it from the discussion, but does not delete its stored image objects or copies already cached by a visitor. Image responses are publicly cacheable for a year. The current read endpoint returns at most 500 comments; pagination is not yet part of this release.

## Private-content example

[examples/private-content/worker.js](examples/private-content/worker.js) demonstrates a fixed file allowlist, an application Bearer token and read-only GitHub permissions. The host application decides who can read the file. GitHub sign-in alone is not authorization to access private repository contents.

The client is server-side code:

```js
import { createRepositoryClient } from '@jsw-teams/reporelay';
const file = await createRepositoryClient(env).readFile('published/release-notes.md', 'main');
```

It does not accept another repository or an arbitrary upstream URL. Never expose the raw client as an unauthenticated API proxy.

## License

MIT. See [LICENSE](LICENSE).
