# D106 evaluation — add-unmanaged-objects

## Round 1

### Verdict

**BLOCKING 2 / NON-BLOCKING 7 / OK 8**

Two delta scenarios are contradicted by shipped behavior. Both come from
one root gap: the DDL-blocking guard lives only in `tableKind.diff`
(`packages/core/src/kinds/table-kind.ts:567-573`), so it covers the table
node and nothing else. The objects a table declaration *fans out into* —
the serial-family sequences `synthesizeSequenceDeclarations` synthesizes,
and the `RlsDeclaration`/`PolicyDeclaration`s `resolveTableDeclarations`
appends — carry no existing marker and are diffed and emitted normally.
The resulting statements include `alter table "<schema>"."<table>" …`
against a table the declaration says hejbro does not own.

---

### Blocking

#### B1 — An `existingTable()` with a serial-family column emits DDL, including an `alter table` on the existing table itself

Scenario (`table-declaration`, "An existing declaration produces no migration"):

> - **THEN** no migration is written for it, the snapshot records it as
>   existing with its declared columns, and a later run with the
>   declaration changed or removed writes no migration either

Requirement text, same requirement:

> the generator SHALL emit no statement for it and SHALL diff nothing
> against it … everything that writes DDL SHALL not see it at all.

**Code path.** `resolveTableDeclarations` (`packages/core/src/engine/generate.ts:127-155`)
calls `synthesizeSequenceDeclarations` (`generate.ts:102-121`) for *every*
table declaration, with no `meta.existing` guard — the only guard it kept
is `meta.authority === "usage"`. `existingTable()`
(`packages/core/src/dsl/existing-table.ts:19-51`) accepts any
`Record<string, ColumnBuilder>`, so a `serial()`/`smallserial()`/
`bigserial()` column is buildable. `sequenceKind` has no existence guard
either (`packages/core/src/kinds/sequence-kind.ts` — `grep existing`
returns only unrelated prose).

**Reproduction** (real run against `packages/core/src`, no mocks):

```ts
const app = schema("p1");
const base = generateMigration({ declarations: [app], previousSnapshot: emptySnapshot });
const ex = existingTable("p1", "legacy", { id: serial(), name: text() });
generateMigration({ declarations: [app, getTableMeta(ex)], previousSnapshot: base.snapshot });
```

emits (`hasChanges: true`):

```sql
create sequence "p1"."legacy_id_seq" as integer;
alter sequence "p1"."legacy_id_seq" owned by "p1"."legacy"."id";
alter table "p1"."legacy" alter column "id" set default nextval('p1.legacy_id_seq');
```

The third statement is an `alter table` on the existing table — exactly
what "everything that writes DDL SHALL not see it at all" forbids.

The scenario's *removal* clause fails the same way: dropping that same
declaration on the next run emits

```sql
alter table "p7"."legacy" alter column "id" drop default;
drop sequence "p7"."legacy_id_seq";
```

**This is not a synthetic construction — it is already in the repo's own
test corpus.** `packages/nile/test/validators.test.ts:467-492` builds
`existingTable("app", "legacy_counters", { tenantId: uuid(), seq: serial() })`
and runs `generateMigration` over it. Replayed verbatim, that run produces:

```sql
create sequence "app"."legacy_counters_seq_seq" as integer;
alter sequence "app"."legacy_counters_seq_seq" owned by "app"."legacy_counters"."seq";
alter table "app"."legacy_counters" alter column "seq" set default nextval('app.legacy_counters_seq_seq');
```

The test stays green only because it asserts `result.errors` alone and
never `result.sql` (see N3).

**Amplification — the flagship preset case.** For a *managed* table this
DDL would at least be caught in a reserved schema; for the synthesized
sequence it is not. `reservedSchemaValidator`
(`packages/supabase/src/validators/reserved-schemas.ts:30-49`) resolves a
declaration's schema via `schemaOf`
(`packages/supabase/src/validators/schema-of.ts:87-111`), whose flat group
is `{schema, function, trigger, rls, policy, grant}` and nested group is
`{table, view, enum}` — `SequenceDeclaration` is in neither, so `schemaOf`
returns `null` and the sequence is never judged. Result:
`existingTable("auth", "users", { id: serial() })` under the Supabase
preset generates `create sequence "auth"."users_id_seq"` plus an
`alter table "auth"."users"` with **no diagnostic at all** — hejbro
writing DDL into Supabase's reserved `auth` schema, the exact outcome D38
and the reserved-schema requirement exist to prevent. Nile is the mirror
image: `nileSerialValidator`
(`packages/nile/src/validators.ts:253`, filtered by
`isManagedTableDeclaration`, `validators.ts:53-57`) deliberately exempts
the existing declaration from its serial refusal, and the engine then
emits the very sequence Nile's platform cannot support.

**Fix shape (informational):** the existence guard has to move up to
declaration expansion — `resolveTableDeclarations` should not synthesize
sequences (nor append `rls`/policies, see B2) for an `existing`
declaration — or `existingTable()` must refuse serial-family columns
outright, since a table hejbro does not own has no business owning a
hejbro-declared sequence.

---

#### B2 — A managed→existing handover emits `drop policy`, `disable row level security`, `drop sequence` and `alter table … drop default`

Scenario (`table-declaration`, "A table changing hands emits nothing"):

> - **THEN** no statement is written for that table, neither a drop nor a
>   create, and the snapshot records it under its new management

Requirement text, same requirement:

> A managed declaration replaced by an existing one, or the reverse,
> SHALL emit nothing — the table stands as it is; the reverse is
> adoption, and only later changes alter it.

**Code path.** `resolveTableDeclarations`
(`packages/core/src/engine/generate.ts:151-155`) appends `meta.rls` and
`meta.rls.policies` for a managed table. `existingTable()` hardcodes
`rls: null` (`existing-table.ts:42`), so on the handover run those
declarations simply vanish from the next side, and `rlsKind`/`policyKind`/
`sequenceKind` diff them as removals — none of the three consults
`tableExisting`.

**Reproduction** — a managed `p3.widgets` with `rls.enabled(...)`, one
policy and a `serial()` primary key, replaced by
`existingTable("p3", "widgets", …)`:

```sql
-- hejbro migration
-- - policy p3.widgets.read_low [dropped]
-- - rls p3.widgets [dropped]
-- - sequence p3.widgets_id_seq [dropped]

drop policy "read_low" on "p3"."widgets";
alter table "p3"."widgets" alter column "id" drop default;
drop sequence "p3"."widgets_id_seq";
alter table "p3"."widgets" disable row level security;
```

Four statements, all naming the table by identity, three of them drops —
and `disable row level security` on a table the repository just declared
it does not own is a live data-exposure change, not a bookkeeping one.

**The reverse direction fails the same sentence.** `existingTable("p4",
"widgets", …)` replaced by a managed `table()` carrying `rls.enabled(...)`
emits, on the adoption run itself:

```sql
alter table "p4"."widgets" enable row level security;
drop policy if exists "read_low" on "p4"."widgets";
create policy "read_low" on "p4"."widgets" for select to "r4" using (…);
```

against a requirement that says the reverse "is adoption, and only later
changes alter it". (Whether that emission is *desirable* is a design
question; what is not in question is that the shipped run emits creates
where the scenario says nothing is written.)

**Test gap.** `packages/core/test/generate.test.ts:920-955` pins both
handover directions, but only on a bare `table(app, "widgets", { id:
uuid().primaryKey() })` — no RLS, no policy, no serial. The two fixtures
are precisely the shape that cannot reach the fan-out, so the guard hole
is invisible to them.

---

### Non-blocking

**N1 — `check`'s inventory silently widens to the whole reserved schema.**
`declaredSchemaNames` (`packages/cli/src/check/inventory.ts:29-36`) reads
the `schema` field off *every* snapshot object, and an existing table's
node carries `schema: "auth"`
(`packages/core/src/kinds/table-kind.ts:612`). Before this change an
`existingTable()` reached no snapshot at all, so the `auth` schema was
never "touched" and its tables were out of scope. Now, declaring
`auth.users` with `existingTable()` pulls every *other* `auth.*` catalog
table into the unmanaged inventory. Measured against a real
`buildInventory` call: catalog `[auth.users, auth.sessions,
auth.identities]` + snapshot with `existingTable("auth","users")` yields
`[{auth,sessions},{auth,identities}]`. For a real Supabase project that is
roughly a dozen new inventory lines produced by adopting the change's own
flagship example. No delta scenario forbids it (the requirement's
definition of *unmanaged* is technically satisfied), and the check-command
test's catalog holds only `auth.users`
(`packages/cli/test/check-command.test.ts:557-559`), so nothing observes
it. Worth an explicit decision: either scope the inventory to schemas a
*managed* declaration touches, or state the widening in the requirement.

**N2 — "one that checks a reference SHALL see it" has no observer.** The
requirement's validator sentence has two halves. The first (managed-DDL
validators skip an existing table) is pinned four ways
(`packages/supabase/test/reserved-schemas.test.ts:81-97`,
`packages/nile/test/validators.test.ts:467-492`, plus
`isManagedTableDeclaration` at `schema-of.ts:34-37` and
`nile/src/validators.ts:53-57`). The second half has no shipped
counterpart: no validator in core, Supabase or Nile inspects a foreign
key's target (`grep foreignKeys` over both preset validator sets returns
nothing). The clause is structurally satisfiable — existing declarations
now do reach `declarations` — but nothing exercises it, so a future
refactor could re-filter them out invisibly.

**N3 — a shipped test masks B1.**
`packages/nile/test/validators.test.ts:467-492` names itself "an
existingTable is not validated as a managed table", builds a fixture with
`seq: serial()`, and asserts only `expect(result.errors).toEqual([])`. The
same `result` carries three DDL statements including an `alter table` on
the existing table. Adding `expect(result.sql).toBe("")` there would have
caught B1 at authoring time.

**N4 — stale contract doc on the declaration field.**
`packages/core/src/dsl/table.ts:132` still documents
`TableDeclaration.existing` as "reference-only, **never passed to
`generateMigration`**, never diffed, never emitted" — the first clause is
exactly what this change retires. Every other touched doc site was updated
(`existing-table.ts:9-18`, `table-snapshot.ts:244-251`,
`generate.ts:130-133`); this one was missed.

**N5 — the vendoring read-path scenario is Docker-only.** "A consumer
reads a platform-owned table" is split: the contract half (the `Tables`
entry, the `existing` mark, the resolved relation) is pinned in-process by
`packages/cli/test/contract-existing.test.ts`, but the "rows … read
through the client" half is witnessed only by
`packages/cli/test/two-repo.integration.test.ts:511`, which is
Docker-gated. On a machine without Docker the scenario's second clause has
no observer at all.

**N6 — `baseline`/`raise` carry no requirement.** The change's own summary
says `baseline`/`raise`/`reset` ignore existing tables. `reset` is both
guarded (through `planReset`'s `generateMigrations`) and pinned
(`packages/cli/test/apply-reset.test.ts:147`), but no ADDED requirement in
any of the four deltas mentions any of the three, so the `raise`/`baseline`
behavior is asserted nowhere and specified nowhere. Either fold a clause
into the `cli-commands` requirement or drop the claim.

**N7 — the surviving refusal's advice names only `table()`.** With
`existing-table-declared` retired (`generate.ts:130-136`;
`grep -rn existing-table-declared` finds it only in `docs/plans/` and the
D41 log entry, i.e. no live raise site), the single refusal a synthesized
declaration hits is `synced-table-declared`, whose message says "declare
it with `table()` in the repository that owns its schema"
(`generate.ts:143`). Now that an `existingTable()` is itself a valid
declaration, that advice is incomplete for a table the owning repository
declares existing. Wording only; the refusal itself is correct and pinned
(`packages/query/test/client/synthesize.test.ts:69-85`, code
`synced-table-declared`, keyed on `authority: "usage"` — not on
`existing`, which `synthesizeTable` also sets to `true`
(`packages/query/src/client/synthesize.ts:108`)).

---

### Verified scenarios

| # | Capability | Scenario | Verdict | Evidence |
|---|---|---|---|---|
| 1 | table-declaration | An existing declaration produces no migration | **BLOCKING** | `generate.ts:102-121` + `:151`; reproduced `create sequence` / `alter table … set default` / `… drop default`. Managed-shape half OK: `generate.test.ts:834-853`, `:876-890` |
| 2 | table-declaration | A managed table may reference an existing one | OK | `generate.test.ts:892-916` — `references "uo4"."users"` present, `create table "uo4"."users"` absent |
| 3 | table-declaration | A table changing hands emits nothing | **BLOCKING** | `generate.ts:151-155` (rls/policy fan-out ungated) + `table-kind.ts:567` (guard is table-node-only); reproduced `drop policy` / `disable row level security` / `drop sequence` / `alter … drop default`. Bare-table half OK: `generate.test.ts:920-955` |
| 4 | table-declaration | A reserved-schema validator exempts an existing table | OK | `reserved-schemas.ts:30-37` + `schema-of.ts:34-37`; both clauses pinned at `supabase/test/reserved-schemas.test.ts:81-97` (17/17 files, 141 tests green) |
| 5 | table-declaration | An older snapshot's tables are all managed | OK | `table-snapshot.ts:273-275` (`tableExisting` defaults false), `core/test/snapshot.test.ts:484-508` |
| 6 | schema-export | An existing table survives the round trip | OK | `export/description.ts:150-163` (shared `columnFact`, `existing: meta.existing`), `cli/test/export-write.test.ts:207-238`, read-back `validate-export.test.ts:135-151`, key order `export-determinism.test.ts:94-119` |
| 7 | schema-export | A description written before the mark reads as managed | OK | `vendor/validate-export.ts:43-48` (`z.boolean().default(false)`), `validate-export.test.ts:167-176` |
| 8 | schema-vendoring | A consumer reads a platform-owned table | OK (see N5) | `contract/tables.ts:238-246`, `contract/emit.ts:126-131`; `cli/test/contract-existing.test.ts` (all three cases, incl. real ESM evaluation of the emitted module); client read half via Docker-gated `two-repo.integration.test.ts:511`. `.related()` absence matches the requirement's own note: `query/src/client/name-keyed-db.ts:51-60` |
| 9 | schema-vendoring | An undeclared table still has no relation | OK | `contract/tables.ts:178-196` (`findTableInSnapshot` → `null` drops the entry), `cli/test/contract-emit.test.ts:133` |
| 10 | cli-commands | An existing declaration is neither compared nor inventoried | OK (see N1) | `check/compare.ts:420-427` (returns `[]` before any catalog lookup), `check/inventory.ts:39-44` (snapshot key covers it); all four clauses pinned at `cli/test/check-command.test.ts:545-635` (4 passed) |

---

### Method

- `npx openspec show add-unmanaged-objects --diff` from the repo root — the
  four ADDED requirements and their ten scenarios. (Note: this command
  prints the proposal preamble ahead of the diffs; findings below are
  drawn from the delta requirement/scenario text only. `proposal.md`,
  `design.md`, `tasks.md`, PR bodies, git log and `blackbox/` were not
  read.)
- Read: `packages/core/src/{dsl/existing-table.ts, dsl/table.ts,
  kinds/table-kind.ts, kinds/table-snapshot.ts, kinds/sequence-kind.ts,
  engine/generate.ts, engine/core-validators.ts}`;
  `packages/cli/src/{loader.ts, export/description.ts,
  vendor/validate-export.ts, contract/tables.ts, contract/emit.ts,
  check/compare.ts, check/inventory.ts, commands/reset.ts}`;
  `packages/query/src/client/{synthesize.ts, contract-types.ts,
  name-keyed-db.ts}`; `packages/supabase/src/validators/*`;
  `packages/nile/src/validators.ts`;
  `skills/hejbro/references/{brownfield-adoption.md, polyrepo.md}`.
- Adversarial probes: eight throwaway `tsx` scripts under `/tmp/d106-eval/`
  importing `packages/core/src` (and `packages/cli/src/check/inventory.ts`,
  whose `@hejbro/core` import is type-only) directly — no repo file
  created or modified. They exercised: an existing declaration with a
  serial column (B1); the same fixture the Nile validator test ships;
  removal of a serial-carrying existing declaration; managed→existing and
  existing→managed handover with RLS + policy + serial (B2); adoption
  followed by a later column change; passing the built `Table` value rather
  than `getTableMeta(...)`; and `buildInventory` over a three-table `auth`
  catalog (N1).
- Tests run: `packages/core` — `generate.test.ts`, `snapshot.test.ts`,
  `existing-table.test.ts` (3 files, 116 passed). `packages/cli` —
  `contract-existing.test.ts`, `validate-export.test.ts`,
  `apply-reset.test.ts` green; `check-command.test.ts -t existing` (4
  passed). `packages/supabase` — full suite (17 files, 141 passed).
- Not run: `packages/cli`'s `check-command.test.ts` subprocess cases,
  `export-determinism.test.ts` and `export-write.test.ts` — all three fail
  on the `assertFreshBuild` staleness guard alone
  (`packages/cli/test/support/cli-runner.ts:61`), not on any assertion; per
  the review brief no build was run, and their assertions were read
  instead. `packages/nile` has no installed `node_modules`, so its suite
  could not run; its sources and tests were read, and the fixture at
  `validators.test.ts:467` was replayed against `packages/core/src`
  directly. Docker-gated `*.integration.test.ts` files were not run.

---

## Round 1 disposition

Summary for a round 2 evaluator: every BLOCKING item is fixed and
pinned; every NON-BLOCKING item is either fixed or filed as its own
issue, never silently dropped. Three commits, in order —
`df93bc47` (B1, N3, N4, N6-baseline, N7), `2293a7ba` (B2's initial
design, N6-raise), `e42f9d78` (a within-round correction to B2's own
design) — plus this file's own final commit (B2's remaining gap,
found by the correction's own review).

### B1 — fixed (`df93bc47`)

**Fix**: `resolveTableDeclarations` (`packages/core/src/engine/
generate.ts`) gained a guard at declaration expansion — `if
(meta.existing) { return [meta]; }` — before `synthesizeSequenceDeclarations`
or the `rls`/policy fan-out ever run. Root cause matched the
evaluator's own diagnosis exactly (the DDL-blocking guard "covers the
table node and nothing else"); the fix moves the chokepoint to where
the fanned-out declarations are *invented*, so `tableKind.diff`'s own
guard's siblings (`sequenceKind`/`rlsKind`/`policyKind`) never see
anything to diff for an existing table.

**Pins**: two tests in `packages/core/test/generate.test.ts` ("an
existing table with a serial-family column produces no migration" /
its removal direction), replaying the evaluator's own reproduction
fixture verbatim.

**Mutant** (the guard removed): exactly 2 red across the full core
suite (98 files/1469), the other 1466 stayed green — including every
managed-table serial test, confirming the fix touches nothing about
managed-table sequence synthesis.

### B2 — fixed (`2293a7ba`, corrected by `e42f9d78`, closed by this
commit)

**J10 ruling (lead)**: the table itself and the objects it fans out
into (sequence/RLS/policy) are governed by **two different
contracts**, not one:
- **The table's own node**: *bidirectional* silence — existing on
  either side suppresses a drop (handover) and a create (adoption)
  alike. Reason: an `existingTable()` declaration's own column list is
  a **partial claim**, never a complete description (the same way
  `authUsers` declares only `{id, email}`) — diffing it against a
  managed declaration's column list would treat a partial claim as a
  complete one, and could emit `add column` (a column the database
  already has, breaking `apply`), `drop column`, or a spurious `alter
  column … type …` (see the mutant below) — genuinely destructive DDL
  derived from a claim that was never a full description in the first
  place.
- **Fan-out objects (sequence/RLS/policy)**: `next`-only — a
  fanned-out object's create/drop is skipped only when `next`'s own
  record for the owning table says existing; on adoption, `next` says
  managed, so the objects hejbro now manages on that table are created
  normally. The rejected alternative (`previous || next`, "both
  directions silence") would leave a user's declared RLS/policy/serial
  column silently un-created on adoption, forever, on every later run
  too — the create/enable/apply failure is *silent*, where a
  `create sequence` name collision at apply time is *loud* (and
  `baseline` is the existing remedy for it, see #668 below) — so
  silence was the wrong default for adoption specifically.

**Design**: `ObjectKind` gained an optional `ownerTableIdentity?(node):
string` accessor (no kind-name hardcoding) — implemented by **only the
three fan-out kinds** (`sequenceKind`/`rlsKind`/`policyKind`, each
`tableIdentity(schema, table)` off their own snapshot node); **not**
implemented by `grant` (a user's own standalone declaration, never a
table fan-out — implementing it there would silently drop an
explicitly-written grant under the same rule); **not** implemented by
`tableKind` (its own guard already enforces a strictly stronger
contract, so a second, weaker mechanism for the same key would be a
second place to keep in sync, not a second layer of safety —
implementer's own call, offered either way by the lead).
`diffSnapshots` (`engine/diff-engine.ts`) gained `ownerIsExisting`: a
fan-out key is skipped before its kind's own `diff` runs when the
owning table's *authoritative* record — `next`'s own entry, falling
back to `previous`'s only when the table's declaration was removed
outright and `next` carries no entry at all — is marked existing.
`tableKind.diff` keeps its own pre-existing `isExistingSide(previous)
|| isExistingSide(next)` guard, now carrying a one-line comment
(constraint only) stating why it's not the same rule as the fan-out
kinds'.

**Correction within this round**: the guard above was first measured
and *removed* (no test calls `tableKind.diff` directly with an
existing-marked node, and the suite stayed green) on the reasoning
that the new fan-out rule made it redundant. That reasoning was wrong
— see the J10 ruling above — and the guard was restored in `e42f9d78`.

**Pins** (`packages/core/test/generate.test.ts`, "an existing
declaration emits nothing" describe block): four tests replay the
evaluator's RLS + one policy + `serial()` fixture on both handover
directions, in two column shapes —
- **Identical columns** ("managed … to existing" / "existing to
  managed"): handover is `hasChanges: false, sql === ""`; adoption has
  no `create table` and no `alter column "id" type …` (see mutant ③
  below for why that second assertion exists), but `create sequence`/
  `enable row level security`/`create policy` all present.
- **Partial columns** (existing declares only `id`; managed declares
  `id`/`email`/`createdAt` — the lead's own fixture, since the pair
  above shares one column shape and so "cannot reach" the diff this
  design question is actually about, the same gap evaluation.md named
  for the pre-existing `generate.test.ts:920-955` pins): handover is
  again `hasChanges: false, sql === ""`; adoption has no `add column`,
  no `drop column`, and no `alter column "id" type …`, while the same
  three fan-out creates are still present.

**Three mutants**, each isolating a different edge of the design (all
reverted; 98/98 clean after each):
- **① fan-out rule `next` → `previous || next`**: exactly 1 red (the
  identical-columns adoption test only) across `generate.test.ts`'s 35,
  every handover test and the other 33 stayed green — the one word is
  the substance of the J10 ruling.
- **② fan-out rule removed entirely**: exactly 1 red (the
  identical-columns handover test only) across the full core suite,
  adoption unaffected.
- **③ `tableKind.diff`'s own guard weakened to `next`-only** (the same
  shape as the fan-out rule) — measured twice, and the measured result
  differed from the first prediction both times:
  - *First measurement* (identical-columns fixture only, before the
    partial fixture existed): not 1 red as first guessed but **3** —
    both removal-direction tests (`next` carries no entry at all when
    a declaration is removed outright, so `next`-only reads `false`
    and the phantom drop this guard exists to suppress reappears — a
    failure mode nobody had named) plus the identical-columns adoption
    test, whose actual leak, found by directly probing
    `generateMigration`'s own `result.sql` under the mutant, was not a
    literal `create table` but `alter table … alter column "id" type
    integer;` (the existing declaration's own column shape diffed
    against the managed declaration's as if one were a real edit of
    the other) — worse than a duplicate create precisely because it
    looks like a plausible statement.
  - *Second measurement* (both fixtures together, this commit): **4**
    red — the same 2 removal tests, the identical-columns adoption
    test (same `alter column … type` leak), and now the
    **partial-columns adoption test**, whose own leak is the sharper,
    originally-predicted one: `alter table … add column "email"
    text;` / `add column "created_at" …` — a column the real database
    already has, which fails loudly at `apply` time rather than
    silently corrupting data, but is still a wrong statement the
    engine should never construct. Neither measurement found the
    identical-columns *or* partial-columns **handover** test breaking
    under this mutant — both stay green, because handover's own
    `next` side always *is* the existing marker, so a `next`-only
    check happens to still catch it; it is the *removal* and
    *adoption* directions this guard's `previous`-side check protects.

### N1, N2, N5 — filed as issues, not silently dropped

No instruction to fix these landed this round; each is now tracked so
the next reader knows where it went rather than re-discovering it:
- **N1** (check's inventory silently widens to the whole reserved
  schema once an existing table is declared there) → **#665** (Bug).
- **N2** ("a validator that checks a reference SHALL see it" has no
  shipped observer) → **#666** (Task).
- **N5** (the vendoring read-path scenario's client-read half is
  Docker-gated only, no non-Docker observer) → **#667** (Task).

Two more, found by this round's own work, filed the same way:
- **#668** — adoption should warn ahead of time when the sequence
  name `resolveTableDeclarations` would synthesize for a newly-managed
  serial column collides with a sequence the database already has
  (the J10 ruling's own "loud at apply time" half currently means
  "loud", not "warned in advance").
- **#669** — core thunk eager-evaluation, found by a different piece
  working in this repository concurrently; referenced here for
  continuity only, not this piece's own scope.

### N3 — fixed (`df93bc47`)

`packages/nile/test/validators.test.ts`'s "an existingTable is not
validated as a managed table" gained `expect(result.sql).toBe("")`,
restructured to a base-then-diff run (schema created first, isolating
the existing declarations' own contribution from `create schema`
noise) — the same shape the evaluator's own B1 reproduction uses.
Verified genuinely red before B1's fix landed (the actual `create
sequence`/`alter table` statements B1 found), green after — the
evaluator's own claim ("this line would have caught B1 at authoring
time") reproduced by hand, not just cited.

### N4 — fixed (`df93bc47`)

`packages/core/src/dsl/table.ts`'s `TableDeclaration.existing` doc
comment's first clause ("never passed to `generateMigration`")
corrected to match the other three doc sites this change already
updated; the constraint alone, no narrative.

### N6 — fixed (`df93bc47` baseline, `2293a7ba` raise; requirement text
is the lead's)

**`baseline`**: new test in `packages/cli/test/baseline-command.test.ts`
("an existing declaration contributes nothing to the baseline
migration") — a schema with both a managed table and an
`existingTable()` baselines to a migration containing the managed
table's DDL and nothing naming the existing one. Probe mutant
(`table-kind.ts`'s guard replaced with `false`, core+cli rebuilt):
exactly 1 red across the file's 11, the other 10 stayed green;
reverted, 11/11 green again.

**`raise`**: round 1 cited only 2.3's structural finding with no new
test — corrected in `2293a7ba` (exactly the N2-shaped gap: a
satisfiable-but-unexercised clause, once the `raise` sentence landed
in the `cli-commands` requirement). New test in `apply-raise.test.ts`
raises a *real* `generateMigration` output for a schema including an
`existingTable()` (not a hand-written SQL string) end-to-end —
succeeds, records the ledger under the caller's own filename, and the
generated SQL names nothing about the existing table.

### N7 — fixed (`df93bc47`)

`generate.ts`'s `synced-table-declared` message now names both
`table()` and `existingTable()` as valid declaration forms. Confirmed
no test asserts the literal message text beyond
`.toContain("carries no migration authority")`
(`packages/core/test/engine/authority-refusal.test.ts:45`), which the
new wording still contains unchanged; the code-only pins
(`synthesize.test.ts:69-85`, `authority-refusal.test.ts:30`) are
untouched by a wording change.

### Gates, by commit

- **`df93bc47`** (B1, N3, N4, N6-baseline, N7): `TURBO_FORCE=1 pnpm
  build --force` (7/7), `check` (656 files clean), `check-types`
  (16/16, 0 cached), `test` (17/17 tasks — core 98f/1469t incl. 1
  todo, query 61f/843t, nile 5f/59t, cli 64f/544t).
- **`2293a7ba`** (B2's initial design, N6-raise): same 4 gates green —
  core 98f/1471t incl. 1 todo (+2), query 61f/843t, nile 5f/59t,
  supabase 17f/141t, cli 64f/545t (+1).
- **`e42f9d78`** (B2's within-round correction): same 4 gates green —
  core 98f/1471t unchanged in count (one assertion strengthened), cli
  64f/545t.
- **This commit** (B2's remaining gap — partial-column pins + mutant
  ③ re-measured with both fixtures): same 4 gates green — core
  98f/1473t incl. 1 todo (+2), cli 64f/545t unchanged. `openspec
  validate --strict` valid throughout, reconfirmed after every commit.
