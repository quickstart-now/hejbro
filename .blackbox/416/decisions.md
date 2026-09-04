# Decisions — quickstart-now/hejbro#416

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — Owner context

_owner · 2026-08-29T00:00Z_

Owner delegation (2026-08-29, rewritten from Korean per this
directory's convention): the owner, stepping away again, delegated
everything — merges and planning decisions alike — to the assistant, to
be decided as the builder of this product and processed through the
established procedures; the owner stressed that what is being built is
an ORM, exclusively for Postgres and for services built on Postgres;
teams are to be used through the existing procedures where a piece
needs one, and even owner-gated OpenSpec decisions are to be made
directly by the assistant until the owner is back.

(Correction note: this section originally quoted the owner's Korean
verbatim, on the lead's instruction — which contradicted this
directory's own convention ("English rewrites, not literal
translations", owner rule 2026-08-26). Caught by the add-check-schema
piece's implementer while writing that change's entry; both entries now
follow the convention. The lead's mis-instruction is part of the
record.)

Return rule (owner, same day): mid-session owner messages do not end the
delegation; only an explicit return declaration does. All owner-gated
decisions in this change (D4's resolution into WindowNode + `over()`,
D104's addition to the decision log, and F1's scope — the six declaration
sites that reject a window function) were made by the lead session under
this delegation, to be surfaced to the owner on return.

