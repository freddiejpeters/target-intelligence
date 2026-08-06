# Architecture decisions

The private product separates suggestions from state changes. Research and AI components produce proposals; a validated command layer owns every mutation.

An approval is valid only for the exact entity identity, version, content hash and scope that the reviewer saw. Freshness is evaluated independently because previously approved evidence may later become stale. Provider enrichment is separately gated by person approval and an explicit credit limit.

Exports are dry-run first. The commit approval binds to the resulting batch hash, which prevents a changed payload from being sent under an earlier approval. Retried commands use idempotency keys to avoid duplicate effects.

These controls keep the system useful for research and drafting while preserving a clear human decision boundary around enrichment, data export and outreach.

