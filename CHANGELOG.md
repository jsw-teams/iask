# Changelog

## 0.2.1 — 2026-10-03

- Make the self-hosted operating model explicit: each operator owns their App, callback, repository and keys.
- Replace the site-specific App manifest with an operator-owned URL template.
- Remove site-specific moderation copy from the shared implementation.
- Verify that another operator’s configured origin controls their authorization callback and post-login return.

## 0.2.0 — 2026-10-03

- Extract the JS.GRIPE reference implementation into an independent package and open-source repository.
- Require GitHub App authorization and repository-scoped installation tokens; remove legacy OAuth/PAT configuration and data compatibility.
- Add explicit data namespaces and v2 session, thread and identity signatures.
- Coordinate concurrent first comments and persist thread IDs with SQLite Durable Objects.
- Preserve uncertain Issue creation results to prevent automatic duplicate creation.
- Validate uploaded and served images, and require visitor-bound attachment receipts.
- Enforce published-thread reads and block uploads after thread moderation.
- Include self-hosting configuration, a GitHub App manifest template, API examples and a protected private-file example.
- Add security, moderation, deletion recovery, namespace isolation and concurrency regression tests.
