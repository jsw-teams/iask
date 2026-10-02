# Changelog

## 202610.2 — 2026-10-03

- Discover the repository installation and App bot identity automatically.
- Generate per-site signing keys in persistent Durable Object storage; preserve existing explicit signing keys and the formal data format.
- Add multiple-website setup guidance and concurrent key initialization, restart and App rotation tests.

## 202610.1 — 2026-10-03

- Use GitHub App user authorization with PKCE and scoped installation tokens.
- Provide optional article comments, verified identity, image uploads and signed upload receipts.
- Coordinate article Issues through persistent Durable Objects, including moderation and checked deletion recovery.
- Derive data isolation from the operator’s own site and repository, without a separate setup variable.
- Keep callbacks and return addresses on each operator’s own website.
- Include self-hosting examples, a GitHub App manifest and an authorized private-file example.
- Cover authorization, project isolation, moderation, upload safety and concurrent submissions with regression tests.
