# Decisions — quickstart-now/hejbro#423

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — Owner context

_owner · 2026-08-29T00:00Z_

The owner was away; the lead held the delegation and the standing
instruction that what we build is an ORM, for Postgres only. Two owner
inputs reached this piece directly:

- A comment on #426 (owner, @hello-pooh): #386 widened the query-side
  condition positions to `Condition` but deliberately left `ctx.if` out,
  because "the body statement surface is being reworked here and in
  #423" and because the body capability then had no OpenSpec spec of its
  own. "Whichever change lands first here should carry the same one-line
  widening." This piece inherited that. The comment's second premise is
  now stale — #424 created `plpgsql-function-bodies` — which is why the
  scenario had somewhere to live.
- Mid-flight, the owner raised a concern about "mechanical proliferation
  of similar functions added without regard for UX/DX". The lead made a
  surface-delta section mandatory for every piece. This entry carries
  ours.

