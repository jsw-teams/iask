# Independent comment service deployment

Cloudflare uses `backend/cloudflare/worker.js`; Vercel uses `api/service.js`, which calls `backend/vercel/handler.js`. Shared authorization and comment logic stays under `backend/`. Each instance serves one exact website origin.

## Cloudflare

Use the README deployment button, or run `npm ci`, `npm test`, then `npm run deploy:cloudflare`. Wrangler provisions the `CommentCoordinator` Durable Object declared in `wrangler.jsonc`. Fill the public settings in that file and supply the private key and client secret through Cloudflare Secrets. Preserve the existing namespace on upgrades.

For JS.GRIPE, use `npm run deploy:production`: its production profile sets the website origin, service origin and repository. Existing App Secrets remain on the Worker. If a binding already exists, edit it rather than adding the same name; a dashboard version must be deployed before its changes are active.

The service root and unrelated paths return a static 404. An explicit `run_worker_first` route list sends only comment endpoints and embed/auth pages to service code, while `404-page` handles asset misses. Routing regression tests check both navigation and non-navigation probes without invoking a function. Legitimate API calls still invoke the Worker; requests matching an API route are rejected early when invalid. See [Cloudflare static routing](https://developers.cloudflare.com/workers/static-assets/binding/) and [static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

## Vercel

Use the README deployment button, attach a PostgreSQL database through your own Vercel Marketplace integration, and set these project environment variables:

| Variable | Value |
| --- | --- |
| `COMMENTNEST_SITE_ORIGIN` | Exact HTTPS origin of this service |
| `COMMENTNEST_WEBSITE_ORIGIN` | Exact HTTPS origin of the embedding website |
| `COMMENTNEST_REPOSITORY` | GitHub owner/repository with Issues enabled |
| `COMMENTNEST_GITHUB_APP_ID` | Your GitHub App ID |
| `COMMENTNEST_GITHUB_APP_CLIENT_ID` | Your GitHub App client ID |
| `COMMENTNEST_GITHUB_APP_CLIENT_SECRET` | Private App client secret |
| `COMMENTNEST_GITHUB_APP_PRIVATE_KEY` | Complete PEM private key, with actual newlines |
| `COMMENTNEST_DATABASE_URL` | PostgreSQL connection URL, kept server-side |

The database must accept verified TLS connections and allow the service role to create `commentnest_state`. Signing keys and thread state are initialized automatically. Use a direct PostgreSQL connection or a pooler in **session mode**: transaction-mode poolers cannot preserve the session advisory lock across GitHub operations. Keep the same database on updates. The adapter never falls back to temporary memory storage when the database is unavailable.

Vercel instances serialize each thread through a database advisory lock. The lock has no expiring lease; disconnecting releases it. State writes commit immediately, so an uncertain GitHub Issue creation remains recorded after a function timeout. Function duration is configured to 60 seconds. Lock acquisition times out after five seconds and returns an unavailable response.

Local CLI deployment is `npm run deploy:vercel`. A new instance requires App registration and database configuration even when created using a deployment button. The button creates the project; it cannot grant GitHub App permissions or provide operator credentials.

## GitHub App and origins

Register the exact callback `<COMMENTNEST_SITE_ORIGIN>/api/comments/callback`. Disable webhooks and device flow. Grant Metadata read, Issues read/write and Contents read/write, then install the App only on your comment repository. That repository needs an initial commit for media storage. Do not put secrets or database credentials in the website's `config.yml`.

Changing the service origin, repository or storage is a data migration. Existing comments are signed against their established scope. Preserve the original state and signing keys and follow [lifecycle.md](lifecycle.md) before changing that scope; a fresh deployment is not an automatic migration of a website's old comment storage.

## Cache and platform limits

| Resource | Policy |
| --- | --- |
| Hashed CSS, JS, locale JSON, sticker catalog and images | `public, max-age=31536000, immutable` |
| `widget.js` loader | 60 seconds, then revalidate |
| Public asset manifest | 300 seconds, then revalidate |
| Embed HTML, OAuth, session, writes, API responses | `no-store` |
| Public comment read snapshot | Internal 15-second cache; invalidate before writes |
| Attachment bytes | Up to five minutes internally; every read verifies current ownership/references |

Static widget files bypass Cloudflare Worker execution and Vercel Functions. There is no background polling. External moderation may take up to 15 seconds to appear in the public comment list; writes and attachment access still perform fresh checks. Platform outages do not produce cached success responses.

Cloudflare accepts up to four images of 5 MB each. Vercel caps each upload at 4 MB to remain below its [4.5 MB function payload limit](https://vercel.com/docs/functions/limitations). The widget receives the platform capability and displays its actual limit. Existing larger attachments require a separate storage migration when moving to Vercel.

Platform references: [Cloudflare deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js), [PostgreSQL client TLS](https://node-postgres.com/features/ssl).
