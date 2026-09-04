# Work — quickstart-now/hejbro#298

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — add-relational-reads proposal — seven rounds, two of them opened by the owner's own questions

_2026-08-28T00:00Z_

Proposal record for the relational query layer (#298, D102), the first
feature of the owner-sequenced queue ("start from #305, then in
order"; #305 landed the same day). Lead-run brainstorm, no team. The
recon that preceded it was one Explore agent whose three load-bearing
claims (FK info fully type-erased at `table()`'s extras annotation;
no select-as-expression node in the IR; one transaction per `db.as`
call) the lead re-verified in-file before opening the first question.

### The seven settled decisions

Two-layer structure (explicit base + FK-derived sugar in one change);
`jsonArrayFrom`/`jsonObjectFrom` (the half-verbatim `jsonAgg`/`jsonRow`
rejected); column-level `.references()` (extras keeps self-referencing/
composite/actions; both converge; double declaration loud);
`related()` (never `with` — CTE collision); forward keys = trailing-Id
strip, reverse keys = schema map names (an earlier "silent rename
trap" claim against Id-strip was CORRECTED during the round: a rename
breaks call sites loudly, the key vanishes from the type); cast +
revive (nested types equal top-level types, no silent 2^53 loss);
sugar depth 1 / `true` only (option objects rejected as the Drizzle
findMany re-invention path).

### Process notes

The ledger's denominator grew 5→7 mid-brainstorm as owner questions
opened decisions; the numbering confusion that caused is a real
communication defect — the corrective adopted: announce "+1 to the
queue" explicitly whenever a decision is inserted. The Explore agent's
report initially went out as session text (invisible) and had to be
re-requested via SendMessage — the same lost-channel failure gc2
produced the standing rule for; agents outside piece teams need the
rule in their spawn prompt too, which the lead now includes.

Migrated from the single-file entry `.blackbox/2026-08-28-relational-reads-proposal.md`, kept verbatim at `.blackbox/298/artifacts/2026-08-28-relational-reads-proposal.md`.

