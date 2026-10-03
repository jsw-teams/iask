# iAsk

- This project owns all comment UI, translations, adaptive theme/layout, accessibility, authentication, attachments, storage and APIs. Website projects use only generic consent-controlled service slots.
- Keep Cloudflare and Vercel adapters under `backend/<platform>`. Share authorization, CSRF validation, signing and comment logic; platform adapters must fail closed when persistent storage or secrets are unavailable.
- Vercel uses PostgreSQL with verified TLS and a direct connection or session-mode pooler. Session advisory locks protect an entire operation. Do not substitute in-memory persistence, transaction-mode pooling or expiring write leases.
- Preserve uncertain-creation markers and stable signing keys across processes. Check authorization and current thread state before mutations and attachment reads; cached public list snapshots may never replace those checks.
- Support valid BCP 47 language tags with explicit regional fallback, complete dictionaries, RTL layout, keyboard navigation, contrast, reduced motion and forced colors. Describe translated coverage accurately.
- Static hashed files bypass platform Functions and receive a one-year immutable cache. Sessions, embed HTML and sensitive API responses use `no-store`.
- Never commit deployment secrets. Keep `.env.example` illustrative and services disabled or unconfigured until real addresses and credentials are supplied.
- The public name and repository are iAsk · 我提问 and jsw-teams/iask. Preserve legacy COMMENTNEST_/REPORELAY_ bindings, /commentnest paths, cookie names, message types and signed storage markers: they are compatibility contracts, not public branding.
- JS.GRIPE production is deployed with backend/cloudflare/wrangler.production.jsonc. It intentionally retains the existing Worker name web, Durable Object class, migration tag, repository scope and callback origin. Never reset or rename these identities as part of a branding change. The production build composes the static web checkout with iAsk assets; all server logic stays in iAsk.
