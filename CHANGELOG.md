# Changelog

## 202610.3 — 2026-10-03

- Let authenticated visitors delete their own comments, including in closed discussions. Verify signed identity, numeric GitHub user ID, CSRF and actual Issue ownership before deletion.
- Return commenter IDs and same-origin avatar paths; proxy bounded GitHub avatar images without forwarding visitor credentials.
- Preserve formal format 1 records, project isolation and persistent signing keys.
- Document installation, Worker configuration, optional consent, page discussions, local image/GIF sticker packs and EdgePress integration in a dedicated guide.
- Add adversarial deletion and avatar-proxy regression tests.

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
