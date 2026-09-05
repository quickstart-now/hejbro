# Decisions — quickstart-now/hejbro#653

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The vendored client gains .related() typed from a contract-emitted Relations map

_lead · extension · basis 412/D24, D25; owner seal (가) one query language; #654 measurement (the wrapper's chain already reaches every db() stage); the pre-functions-contract precedent · 2026-09-05T08:12Z · ratified: pending_

Design (design.md Q1-Q5): the declaring side emits `Relations` per table (key → { target, mode }) with the runtime's own stripId/collision rules, because the relation key is a column key the consumer's type layer cannot recover from `Relationships`' SQL names; the name-keyed chain forwards `.related(spec)` to the internal db() handle (byte-identical SQL, same guards, same RLS scoping); a table with no relations and a pre-Relations contract have no member. schema-vendoring MODIFIED (existing-table requirement, the join scenario returns) + ADDED. Ratification: owner on return.

<a id="r2"></a>
## R2 — the snippet prelude and the guide join the files; the no-member scenario is a type-layer claim

_lead · extension · basis R1 · 2026-09-05T21:14Z · ratified: pending_

(Q1) `skills/hejbro/references/polyrepo.md`'s snippets compile against `packages/skills/test/fixtures/preludes/polyrepo-contract.ts`, whose `Database` has one table and no relation, so a `.related()` example there cannot compile without a second table, a foreign key and both `Relations` maps in the prelude. The prelude joins task 1.3's files; the `no-check` allowlist stays empty by design and prose without a compiled example would leave the new surface undocumented in the one place the gate proves. (Q2) `docs/guide/polyrepo.md` lines 109-126 show an emitted `Database`; after this change that illustration disagrees with real output, so it gains `readonly Relations: {};` -- one line, the file joins task 1.3 -- because two readers of the same fact must not disagree. (Q3) "A table with no relation has no member" is a type-layer claim: the internal chain attaches `related` to every `Table` projection and the client forwards the chain unchanged (design Q3, nothing re-derived in the client), so the member exists structurally at runtime and the existing `unknown-relation`/`ambiguous-relation` guards are the runtime backstop; the scenario is pinned by a `@ts-expect-error` type test, and the scenario's wording is checked to say "the type layer offers no `.related` member" if it does not already. Facts adopted: the repository has no committed contract goldens -- "goldens refreshed" in tasks.md means the inline emitted-text assertions in `contract-emit.test.ts` and `contract-origin.test.ts`, whose changed lines are reported verbatim in (b); the position of `Relations` in the rendered table (before or after `Relationships`) is a 1.1 design item because `sectionBetween(...)` slices on `Relationships:`; and the "key not ending in `Id`" row is implemented as the collision-omission rule, not an `endsWith` test, so the `"Id"` boundary agrees with the runtime.

