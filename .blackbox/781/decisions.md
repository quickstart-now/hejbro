# Decisions — quickstart-now/hejbro#781

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Q2: attgenerated splits default from generated in the bulk read; Q4: generated mismatch is one differs, the default axis is not compared

_lead · interpretation · basis D1 · 2026-09-04T14:28Z · ratified: pending_

Q2 catalog read (a): the bulk `columns` query reads `attgenerated` alongside `pg_get_expr(adbin)` and splits the text into `catalogDefault` (attgenerated = '') and `catalogGenerated` (otherwise) — one of the two non-null — with one new `ColumnRow` field; no extra statement, no privilege beyond the catalog.
Q4 the generated/default axes (a): when either side is generated, the default axis is not compared at all; "declared generated, database plain" (or the reverse) is one `check-object-differs`, the database's default text quoted in the message when present; both generated → expression comparison. Two findings (b) would produce a `Next:` the user cannot act on ("add the default to the declaration"), which is the false report #781 describes.

