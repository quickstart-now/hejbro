# Work — quickstart-now/hejbro#653

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — the emitter's Relations map and the inputs that fixed its expectations

_2026-09-06T00:31Z_

Group 1 task 1.1. Before any expected text was written, the five relation classes with no witness in `packages/query/test` (a foreign-key column key not ending in `Id`, a column key of exactly `"Id"`, a forward/reverse key collision, a composite foreign key, a target outside the schema map) were measured against the query layer itself: a type oracle (`const probe: RelationKeysOf<D, T> = "__PROBE__"`, whose error prints the admitted key union) and a runtime oracle (`.related({ k: true }).compile()` in try/catch). Findings: a non-`Id` key is excluded because `stripId` is the identity there and the key then collides with the column itself, not because of any `endsWith` test; a column key of exactly `"Id"` cannot be produced by `table()` at all (`toSnakeCase("Id")` is `_id`, which `assertSqlName` refuses), but the emitter's input is an export description, which is foreign input, so a hand-built payload reaches it; a forward/reverse collision is excluded at the type level and silently resolved forward at runtime; a composite foreign key is invisible to both layers; and the type layer never checks schema-map membership, so only the emitter can keep `target` naming a real `Tables` key.

The input table therefore ran ten rows, not eight: the eight classes `tasks.md` names, plus the hand-built `"Id"` row (the one input that separates "stripId then omit on collision" from a naive `endsWith("Id")`, which would emit a blank relation key), plus a row whose foreign-key target is in the snapshot but not in the emitted `Tables` -- added after mutation M6 passed, which proved that the row originally assigned to that rule could not witness it: its target never reaches the snapshot at all, so `buildRelationships` drops it one step earlier and the carried-target check has nothing left to do. Ten mutations were run one at a time, each reverted and verified against the saved green patch; every row and the runtime-metadata control has at least one mutation that reddens it.

<a id="w2"></a>
## W2 — the client's type layer, and two mutation gaps it exposed

_2026-09-06T00:31Z_

Group 1 task 1.2. The runtime did not change: `select()` already returns the internal chain, which carries `related` for any table projection, so only the cast target moved by one line. That is design Q3 ("forward, not a reimplementation") measured rather than asserted -- the compile-parity row and the scoped-read row were both green before the type work landed.

Two mutations exposed gaps in the tests rather than in the code. Removing the `Record<Exclude<keyof TSpec, keys>, never>` intersection reddens only the mixed-spec row: a spec of purely unknown keys is already refused by ordinary excess-property checking, so the intersection's own witness is the mixed row, exactly as `db/chain.ts`'s F3 comment says. Removing the outer `[keys] extends [never] ? unknown` gate reddened nothing at first, because every no-member row called `.related()` with a key: the inner intersection refuses that call either way. The gate decides whether the member exists, so its witness had to be a call with an empty spec (`.related({})`), which the same file's own comment names as the point -- absence beats a callable that could only ever take `{}`.

One measurement was reported wrongly and corrected by re-running it: an unused-directive diagnostic was first attributed to the wrong row. The correction came from the compiler output with line numbers, not from reasoning.

<a id="w3"></a>
## W3 — the real-server witness, and a planner claim that was overstated

_2026-09-06T00:31Z_

Group 1 tasks 1.3 and 1.4. The two-repository witness was green the moment it was written -- tasks 1.1 and 1.2 had already opened the path -- so its value had to come from a mutation. The first mutation (the emitter returns no relations at all) left the witness green: the runtime follows `contractMetadata.foreignKeys`, never the emitted `Relations` map, and the integration test reads the vendored module through hand-written local types, so nothing in it depended on the emitted text. The witness now also asserts the vendored `contract.ts` text names the relation, and the same mutation then reddens it and nothing else.

The `Relations` blocks the skills prelude carries were copied from a real `emitContract` run, not invented, and the snippet gate reddens when that map is emptied.

Recorded against the planner: the instruction that settled the render position claimed a current assertion would break if `Relations` were placed between `Update` and `Relationships`. It would not -- every assertion in that slice is `toContain`. The position ruling stands on its other grounds (the raw list first, the derived view after it; a widened slice would let a later `not.toContain` be silently wrong), but the breakage claim was an overstatement, made without reading the assertions it named.

<a id="w4"></a>
## W4 — what the declaring side actually offers for a self-referential foreign key

_2026-09-06T01:31Z_

Constructor review round 1 returned REWORK on one axis: a self-referential foreign key. Measured afterwards, with a probe deleted before any commit:

`.references()` cannot express a self-reference at all -- the declaration would reference its own initializer, and TypeScript refuses it (TS7022/TS7024). Core's own comment on `.references()` routes that case elsewhere: "Self-referencing and composite foreign keys stay on the `extras` path." An `extras` foreign key never populates a column's `TMeta.references`, which is the only thing the type layer reads, so the declaring side's own `RelationKeysOf` for such a table is `never` -- it offers no self-relation key at all, forward or reverse.

The runtime derives both anyway: nothing in `ReverseRelations`, `deriveOne` or `buildReverse` excludes the parent table from its own schema-map lookup. Both reads compile, and both are wrong, because neither aliases the target: the nested `from "app"."nodes"` shadows the outer row, so the forward read compiles `where "app"."nodes"."id" = "app"."nodes"."parent_id"` and the reverse one `where "app"."nodes"."parent_id" = "app"."nodes"."id"` -- self-loops only. On a real server the reviewer measured `parent: null` on a child row and `nodes: []` on a parent row.

The emitter reads snapshot foreign keys, which do carry `extras` edges, so it emitted what the declaring type layer could not offer: the vendored surface was WIDER than the declaring one, and a consumer's `tsc` accepted a key that returns a wrong value. Excluding self-references from emission (653/R6) restores parity with the declaring type layer rather than diverging from it. The alias defect itself is the query layer's, filed as its own issue.

Two attributions. The instruction that produced this told the implementer, in so many words, not to exclude self-references, reasoning from the runtime's schema-map lookup and missing the delta's own word "another" -- the mirror of the earlier `.offset()` failure, where the spec sentence was carried without opening the code.

And a correction: the two integration failures reported at the end of group 1 (`check-live` 6.3, `declare-emit-roundtrip` 2.2) are a known pre-existing drift, reproduced on a clean dev by the lead, not host interference by another team's container. The interference reading rested on nothing but a concurrent container being up.

