# iask

Self-hosted comments owned entirely by this project: the editor, responsive layout, host color adaptation, language packs, accessibility, GitHub App sign-in, avatars, stickers, uploads and deletion. Websites contain static pages and consent-gated service slots.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jsw-teams/iask)
[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjsw-teams%2Fiask&env=COMMENTNEST_SITE_ORIGIN,COMMENTNEST_WEBSITE_ORIGIN,COMMENTNEST_REPOSITORY,COMMENTNEST_GITHUB_APP_ID,COMMENTNEST_GITHUB_APP_CLIENT_ID,COMMENTNEST_GITHUB_APP_CLIENT_SECRET,COMMENTNEST_GITHUB_APP_PRIVATE_KEY,COMMENTNEST_DATABASE_URL)

Each operator supplies their own exact website/service origins and GitHub App credentials. Cloudflare uses Durable Objects; Vercel requires a persistent PostgreSQL database. Deployment buttons create a project and still require these operator settings.

[Deployment and security](docs/deployment.md)

[EdgePress integration](docs/edgepress.md)

[Languages and accessibility](docs/languages.md)

[Storage lifecycle](docs/lifecycle.md)

## JS.GRIPE production

The live introduction is https://js.gripe/iask/. The independent Cloudflare Worker is named `iask` and serves https://iask.js.gripe through the operator-managed route; APIs require that exact origin. Its workers.dev address is disabled. The `web` Worker serves only the static website. Article discussions load after visitor consent. App credentials are configured privately on iask, with the callback at https://iask.js.gripe/api/comments/callback.

Run `npm run deploy:production` to build and deploy this site's iask instance. The GitHub Actions production workflow accepts an account Worker-edit Cloudflare API token stored in the repository's `CLOUDFLARE_API_TOKEN` secret. It deploys only iask and does not change website routes.

When assigning a new service domain, update `COMMENTNEST_SITE_ORIGIN`, the GitHub App callback (`<service-origin>/api/comments/callback`) and the website's `backendUrl`/`moduleUrl`. The App must allow the exact callback before GitHub sign-in works. Old storage is preserved separately; changing a service origin does not migrate signed comments automatically. Internal `/commentnest/` paths and configuration prefixes remain compatible. Other operators should use the standalone Cloudflare/Vercel deployment settings instead of this site's production profile.

For this deployment, reuse App `5165740`. Its private key and client secret are stored as `COMMENTNEST_GITHUB_APP_PRIVATE_KEY` and `COMMENTNEST_GITHUB_APP_CLIENT_SECRET` Secrets on Worker `iask`. Edit an existing binding instead of creating a duplicate; publish the resulting version to activate a dashboard change. The production profile supplies `COMMENTNEST_WEBSITE_ORIGIN`, `COMMENTNEST_SITE_ORIGIN` and `COMMENTNEST_REPOSITORY` automatically when deploying; no duplicate dashboard entries are needed. Public reads, sessions and the login redirect have been checked; completing an interactive GitHub sign-in remains an operator check. No private credentials belong in website files.

## Development

Use Node.js 22.12 or newer. Run npm ci, npm test and npm run build. Deploy with npm run deploy:cloudflare or npm run deploy:vercel. Never commit private keys, filled environment files or database URLs.

The platform entries are backend/cloudflare/worker.js and backend/vercel/handler.js. Shared backend modules validate the exact Origin, signed sessions, CSRF, published thread allowlists, comment ownership, upload receipts, image bytes and request sizes. GitHub access tokens stay server-side. Errors fail closed when persistent storage is unavailable.

The isolated widget supports 17 complete locale dictionaries, arbitrary BCP 47 language tags with fallback, RTL, light/dark mode, keyboard controls and high-contrast display. Add additional language packs as described in the language guide. It makes no requests before the website grants consent and does not poll in the background.

## Resources and cache

static/commentnest/ owns all browser code and CSS. content/assets/commentnest/stickers/ owns original black bear and panda stickers generated with image_gen. Each pack includes hello, approval, thinking, celebration and perfect score. Picking a sticker inserts its text token at the caret; known tokens render as local images, without an upload request or attachment slot. Builds fingerprint CSS, JS, locale files, sticker catalogs and images for one-year immutable caching. The small widget loader revalidates after 60 seconds. Static files bypass backend execution on both platforms. API responses are no-store; public read snapshots cache internally for 15 seconds and are invalidated before writes. Attachment access retains fresh deletion checks.

Comments accept 5,000 characters and up to four attachments. Cloudflare allows 5 MB per file; Vercel allows 4 MB. Sessions and upload receipts expire after one day. Drafts and the signed iframe session stay in this tab's session storage until cleared, submitted, logged out or expired.

## License

Project code declares MIT in package metadata. Sticker generation prompts and provenance are recorded in content/assets/commentnest/sticker-sources/generation.json.

Business requests use the fixed /api endpoint with X-Service-Action, X-Service-Thread and X-Service-Resource headers. Percent-encode header values. The /frame iframe receives context through origin-checked messages, not URL parameters. Login uses a fixed /auth popup that initializes OAuth through /api headers in a first-party context. The registered GitHub callback and standard OAuth code/state parameters remain compatible; hashed assets and old signed attachment URLs retain their established contracts. Published sticker renditions are transparent 192×192 WebP files.
