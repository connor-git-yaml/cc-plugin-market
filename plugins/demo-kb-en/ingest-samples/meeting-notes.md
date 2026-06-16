# Integration Review Meeting Notes (synthetic demo content)

> This file is a **synthetic sample for F192 three-party ingest (`scaffold-kb ingest --minutes`)**. Content is fictional, contains no real customer/company/project information, and only demonstrates ingesting meeting notes into the project KB with provenance.

## Agreements

- In this project, the app object is always created via `new Hono()` at module top level; do not recreate per request.
- Bearer auth middleware `bearerAuth({ token })` is mounted before route handlers, not after.
- Error code `E1001` here usually means a missing middleware order issue; check `app.use` placement first.

## Action items

- Evaluate whether `app.route()` nesting depth affects cold-start latency.
