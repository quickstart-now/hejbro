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

---

## Round 2

### Verdict

**BLOCKING 2 / NON-BLOCKING 7 / OK 10**

Round 1's two BLOCKING items are genuinely fixed and pinned. Round 2's
two are a different, deeper instance of the same root shape: the change
made an existing declaration a **snapshot object**, and every consumer
of the snapshot that predates the change still treats every `table:`
entry as a managed table.

- Round 1 found the fan-out consumers (`sequenceKind`/`rlsKind`/
  `policyKind`) — those are now gated.
- Round 2 finds the two consumers that were never gated at all: the
  **rename planner** (`engine/rename/*`, which reads raw `table:`
  entries and both refuses runs and emits `alter table … rename …`
  against existing tables), and the **CLI's own snapshot-persistence
  rule** (`hasChanges === false ⇒ write no snapshot`, whose invariant
  "no changes means the declared state already matches the snapshot"
  this change silently broke).

---

### Round-1 findings re-checked

| # | Round-1 finding | Round-2 verdict | Evidence |
|---|---|---|---|
| B1 | existing declaration with a serial column emits DDL | **closed** | `engine/generate.ts:164` (`if (meta.existing) return [meta]`) runs before `synthesizeSequenceDeclarations`/rls fan-out. Independent probe: `existingTable("p1","legacy",{id:serial(),name:text()})` on a base snapshot → `hasChanges:false`, `sql:""`; removal run → `""`. R1's `create sequence`/`alter table … set default`/`drop default` all gone |
| B1-amp | Nile fixture in the repo's own corpus emitted DDL | **closed** | `packages/nile/test/validators.test.ts:467-508` fixture replayed verbatim against `packages/core/src` → `sql:""`, `errors:[]` |
| B2 | managed→existing handover emitted `drop policy`/`disable rls`/`drop sequence`; adoption emitted creates | **closed for the in-process API; re-opened at the CLI level by R2-B2** | `diff-engine.ts:163-206` (`ownerIsExisting`, `next`-authoritative) + `table-kind.ts:636` (bidirectional table guard). Probe: managed(`serial` PK + `rls` + 1 policy) → `existingTable` = `hasChanges:false, sql:""`; partial-column pair likewise. Note the delta's own requirement text was **rewritten this round** (R1 quoted "SHALL emit nothing … the reverse is adoption, and only later changes alter it"; the shipped text is the two-contract rule) — the shipped code matches the new text, so this is a spec amendment, not a code fix, for the adoption half. But see **R2-B2**: through the real CLI the handover's snapshot is never written, and the exact statements R1 listed return on the next removal |
| N1 | `check`'s inventory widens to the whole reserved schema | **still open** (tracked #665) | `check/inventory.ts:29-36` `declaredSchemaNames` still maps `.schema` off *every* snapshot object; an existing `auth.users` still pulls every other `auth.*` catalog table in. No code change, no new pin |
| N2 | "a validator that checks a reference SHALL see it" has no observer | **still open** (tracked #666) | `grep foreignKeys` over `core/src/engine/core-validators.ts`, `supabase/src/validators/*`, `nile/src/validators.ts` → zero hits. Clause still structurally satisfiable, still unexercised |
| N3 | Nile test masked B1 | **closed** | `packages/nile/test/validators.test.ts:507` now asserts `expect(result.sql).toBe("")` on a base-then-diff run |
| N4 | stale `TableDeclaration.existing` doc | **closed** | `packages/core/src/dsl/table.ts:132` now reads "passing it to `generateMigration` is accepted, but it is never diffed and never emitted" |
| N5 | vendoring read-path scenario is Docker-only | **still open** (tracked #667) | `packages/cli/test/two-repo.integration.test.ts:511` is still the only witness for the client-read half; `vitest.config.ts` excludes `*integration.test.ts` from the default run |
| N6 | `baseline`/`raise` carried no requirement | **closed** | `cli-commands` delta's second paragraph now names all three; `baseline-command.test.ts:100`, `apply-raise.test.ts:274`, `apply-reset.test.ts:147` |
| N7 | `synced-table-declared` advice named only `table()` | **closed** | `engine/generate.ts:157` now names `table()` *and* `existingTable()` |

---

### Blocking

#### R2-B1 — the rename planner sees existing tables: it refuses otherwise-valid runs, and the remedy it prescribes emits `alter table … rename …` against a table the declaration says hejbro does not own

Scenario (`table-declaration`, "An existing declaration produces no migration"):

> - **THEN** no migration is written for it, the snapshot records it as
>   existing with its declared columns, and a later run with the
>   declaration **changed or removed** writes no migration either

Requirement text, same requirement:

> the generator SHALL emit no statement for it and SHALL diff nothing
> against it … Adding, changing, or removing an existing declaration
> SHALL produce no migration … everything that writes DDL SHALL not see
> it at all.

**Code path.** `generateMigrations` calls `planRenames`
(`engine/generate.ts:520-526`) with the raw `previous`/`next`
snapshots, *before* `diffSnapshots` and entirely outside both new
guards. `planRenames` builds its working sets from
`tableEntries(objects)` (`engine/rename/snapshot-sets.ts:22-30`) — every
`table:` key, with no `existing` filter anywhere in
`engine/rename/*` (`grep -n existing engine/rename/` returns only
unrelated local variable names). `computeSchemaTableSets`
(`snapshot-sets.ts:50`) and `computeTableColumnSets`
(`snapshot-sets.ts:118`) therefore count existing tables as dropped/added
table names and dropped/added column names, and
`residualTableAmbiguityFor` (`rename/ambiguities.ts:249-283`) raises on
them. `tableKind`'s own guard never runs: `plan.errors.length > 0`
short-circuits at `generate.ts:528` before any diff.

**Reproduction A — changing an existing declaration's column name.**
The most ordinary edit there is: correcting the shape you claim for a
platform table.

```ts
existingTable("c1", "users", { id: uuid(), name:  text() })   // run 1
existingTable("c1", "users", { id: uuid(), title: text() })   // run 2
```

Run 2 (measured, `packages/core/src`, no mocks):

```
errors: [ambiguous-column-rename]  hasChanges: false  sql: ""
"table "c1.users" has an ambiguous column change: column "name" was dropped
 and column "title" was added … Next: rerun with `--rename c1.users.name=title`"
```

`hejbro generate` **fails**. Following the remedy the error itself
prescribes:

```sql
-- hejbro migration
-- ~ table c1.users [column "name" renamed to "title"]

alter table "c1"."users" rename column "name" to "title";
```

Real DDL, against a table declared `existingTable()`. Both halves
contradict the scenario: without the flag a *changed* existing
declaration does not "write no migration", it writes an error and stops
the whole run; with the flag it writes a migration.

**Reproduction B — renaming the existing declaration itself.**
`existingTable("e2","old_name",…)` → `existingTable("e2","new_name",…)`:
`ambiguous-table-rename`, and with `--rename e2.old_name=new_name`:

```sql
alter table "e2"."old_name" rename to "new_name";
```

**Reproduction C — an existing declaration poisons an unrelated managed
change in the same schema.** Remove `existingTable("e4","legacy",…)` and
add a managed `table(app,"fresh",…)` in the same run → the whole
migration is refused with `ambiguous-table-rename` (dropped `legacy`,
created `fresh`). `create table "e4"."fresh"` is blocked until the user
passes `--confirm-drop e4.legacy` — confirming the "drop" of a table
hejbro never manages and would never drop. This is the "removing an
existing declaration SHALL produce no migration" clause failing in the
opposite direction: it produces a refusal and a mandatory flag.

**Reproduction D — DDL *into* an existing table's identity.** Managed
`e3.widgets` replaced by `existingTable("e3","gadgets",…)`, with the
prescribed `--rename e3.widgets=gadgets`:

```sql
alter table "e3"."widgets" rename to "gadgets";
alter table "e3"."gadgets" rename constraint "widgets_pkey" to "gadgets_pkey";
```

Two statements against `e3.gadgets`, a declared existing table that by
definition already exists in the database — the rename would collide
with it at apply time.

**Amplification — the flagship preset case, again.** `reservedSchemaValidator`
skips every existing table declaration outright
(`packages/supabase/src/validators/reserved-schemas.ts:32-36`), so
`alter table "auth"."users" rename column "full_name" to "name";`
generated by Reproduction A under the Supabase preset raises **no
diagnostic at all** — the same D38 hole R1's B1 amplification described,
reached by a different door.

**Test gap.** The two pins that would cover this
(`generate.test.ts:908` "changing an existing declaration produces no
migration", `:934` "removing an existing declaration produces no
migration") change columns only by *addition* and remove the declaration
in a run with no added table in that schema — neither fixture can
produce a drop+add pair, so neither can reach `planRenames` at all. It
is precisely the fixture-shape gap R1 named for the handover pins,
repeated one layer up.

**Fix shape (informational):** `planRenames` needs the same existence
awareness the diff engine got — exclude tables marked existing on either
side from `computeSchemaTableSets`/`computeTableColumnSets` (they are
neither dropped nor created by hejbro), which removes the spurious
ambiguity, the spurious remedy, and the DDL the remedy produces, in one
place.

---

#### R2-B2 — through the real CLI the existing marker never reaches the snapshot on disk, so the handover's own drops come back and the vendored contract loses the table

Scenario (`table-declaration`, "A table handed to the platform loses nothing"):

> - **THEN** no statement is written at all … **and the snapshot records
>   the table as existing**

Requirement text (`table-declaration`): "The snapshot SHALL record it as
an existing table". Requirement text (`schema-vendoring`): "A vendored
contract SHALL emit an existing table … under `Tables`".

**Code path.** `packages/cli/src/commands/generate.ts:708-723`: when
`firstPass.hasChanges` is false the command returns
`"no changes — snapshot already matches your declarations."` and the
only `writeFileSync(join(cwd, config.snapshotPath), …)` in the file
(`:767`) is in the difference-found path *below* that return. The
comment at `:713-716` states the invariant this rests on — "No changes
means the declared state already matches `previousSnapshot`" — and that
invariant is exactly what this change broke: `hasChanges === false` now
also means "the diff was suppressed", not "the two snapshots agree".

**Consequence 1 — the handover scenario's own second clause is false.**
Measured: a managed `k1.widgets` (`serial` PK + `rls` + one policy)
handed to `existingTable("k1","widgets",…)` gives `hasChanges: false`.
The CLI therefore writes nothing. The on-disk snapshot still holds

```
policy:k1.widgets.read_low, rls:k1.widgets, sequence:k1.widgets_id_seq,
table:k1.widgets   (no `existing` marker)
```

The scenario says "the snapshot records the table as existing". It does
not. The `secondResult.snapshot.objects[…]` the core tests assert
(`generate.test.ts:1051-1055`, `:1179-1183`) is an in-memory return
value the CLI discards.

**Consequence 2 — R1's B2 drops come back, one run later.** Because the
marker never persisted, deleting the `existingTable()` line afterwards
diffs against the *original managed* snapshot. Measured:

```sql
-- hejbro migration
-- - policy k1.widgets.read_low [dropped]
-- - rls k1.widgets [dropped]
-- - table k1.widgets [dropped]
-- - sequence k1.widgets_id_seq [dropped]

drop policy "read_low" on "k1"."widgets";
alter table "k1"."widgets" alter column "id" drop default;
drop sequence "k1"."widgets_id_seq";
alter table "k1"."widgets" disable row level security;
drop table "k1"."widgets";
```

That is R1's B2 statement list plus `drop table`, reachable through the
shipped CLI, against a table the repository declared it does not own.
The in-process pin cannot see it because it threads
`firstResult.snapshot` → `secondResult.snapshot` by hand, which is what
the CLI declines to do.

**Consequence 3 — the flagship vendoring path breaks whenever the
existing declaration is added on its own.** Adding
`export const authUsers = existingTable("auth","users",…)` to a project
already in sync is `hasChanges: false` (measured: `generateMigrations`
returns `migrations: 0`). The CLI then writes no snapshot, and
`--export` writes `writeExportArtifact(previousSnapshot)`
(`generate.ts:718`) — a description whose `tables` array *does* carry
the existing table's fact, paired with a snapshot that does *not* carry
its `table:` node. `computeTables` (`packages/cli/src/contract/emit.ts:
31-50`) drops any fact with no matching snapshot table, and
`buildRelationships` (`contract/tables.ts:178-196`) resolves relations
only through `findTableInSnapshot`. Result: the vendored contract has no
`Tables["users"]` entry and a managed FK onto it has no relation —
directly against `schema-vendoring`'s requirement and its "A consumer
reads a platform-owned table" scenario. The shipped pins miss it because
every fixture (`export-write.test.ts:207`, `contract-existing.test.ts`,
`two-repo.integration.test.ts`) introduces the existing table in a run
that *also* creates managed objects, so `hasChanges` is true.

**Fix shape (informational):** `hasChanges` can no longer stand in for
"snapshot is current". Either the no-change branch must still persist
the newly-built snapshot when it differs from `previousSnapshot`, or
`generateMigrations` must report snapshot-changed separately from
migration-emitted.

---

### Non-blocking

**R2-N1 — adoption creates the fan-out objects but silently never
creates the adopted table's own declared indexes, checks, foreign keys
or primary key.** `tableKind.diff`'s bidirectional guard
(`table-kind.ts:636`) returns `[]` for the whole adoption run, so the
managed declaration's `indexes`/`checks`/`foreignKeys`/`primaryKeyName`
produce no DDL — while `serialize` still records them, so the snapshot
claims they exist and no later run will ever create them. Measured:
`existingTable("a1","widgets",{id})` → `table(app,"widgets",{…},()=>({
rls…, indexes:[index().on(t.email)]}))` emits `create sequence` /
`enable row level security` / `create policy` and **no**
`create index … widgets_email_idx`; the snapshot node afterwards carries
`"indexes":[{"name":"widgets_email_idx",…}],"primaryKeyName":"widgets_pkey"`.
The delta's own enumeration is closed — "its sequences, its row-level
security, its policies" — so the scenario is not contradicted, but a
reader of "created as they are for any managed table" would not predict
this, and nothing pins it either way. Worth an explicit decision or a
clause.

**R2-N2 — R1-N1 (`check`'s inventory widening) is still open**, tracked
as #665, with no code change and no pin. Re-measured by reading
`check/inventory.ts:29-36`: unchanged.

**R2-N3 — R1-N2 (the reference-checking validator clause has no shipped
observer) is still open**, tracked as #666. `grep foreignKeys` over
core's and both presets' validator sets still returns nothing.

**R2-N4 — R1-N5 (the vendoring client-read half is Docker-gated only) is
still open**, tracked as #667. On a machine without Docker the second
half of "A consumer reads a platform-owned table" still has no observer.

**R2-N5 — the changeset and the user-facing skill both over-claim
"ever".** `.changeset/declare-existing-tables.md`: "`generateMigration`
still diffs and emits nothing for it, **ever**"; `skills/hejbro/
references/brownfield-adoption.md:133-139`: "`generateMigration` diffs
nothing for it and emits no statement, **ever**" / "hejbro never touches
its DDL". R2-B1 falsifies both. Whatever the resolution of B1, these two
sentences are the user-facing contract and must not outrun it.

**R2-N6 — the skill contradicts the delta's own adoption scenario.**
`brownfield-adoption.md:136-141` states `existingTable()` "is not a
staging step toward later full management of that table" and "The
adoption choice per table is binary and made once", while
`table-declaration`'s "An adopted table gains what the declaration
manages" specifies exactly that transition and pins it
(`generate.test.ts:1058`, `:1185`). One of the two is wrong; the spec
wins, so the skill text needs correcting (AGENTS.md: "a stale skill is a
broken user contract").

**R2-N7 — the export round trip is pinned in two halves that never meet.**
`schema-export`'s "An existing table survives the round trip" asks that
the table come back "with its declared columns and their facts, marked
existing". The write side (`export-write.test.ts:207-238`) asserts only
`existing` on a real CLI run — never the existing table's `columns`,
`exportName`, modes or `notNullElements`; the read side
(`validate-export.test.ts:135-151`) asserts a hand-written payload. No
fixture writes an existing table's facts and reads them back. Shared
`columnFact`/`columnsBySqlName` (`export/description.ts:134-148`) makes
it structurally true; nothing observes it.

---

### Verified scenarios

| # | Capability | Scenario | Verdict | Evidence |
|---|---|---|---|---|
| 1 | table-declaration | An existing declaration produces no migration | **BLOCKING (R2-B1)** | `engine/generate.ts:520-526` → `rename/snapshot-sets.ts:22,50,118` (no `existing` filter); reproduced `ambiguous-column-rename` / `ambiguous-table-rename` refusals and `alter table … rename column`/`rename to` under the prescribed `--rename`. Add/no-op halves OK: probes `p1` (serial fixture, `sql:""`, removal `""`), `generate.test.ts:830,858,886,908,934` |
| 2 | table-declaration | A managed table may reference an existing one | OK | Probe: `create table "m1"."profiles"` + `references "auth"."users" ("id")`, no statement naming `auth.users` itself; `generate.test.ts:950` |
| 3 | table-declaration | A table handed to the platform loses nothing | **BLOCKING (R2-B2)** on the snapshot clause | SQL clause OK in-process (`hasChanges:false, sql:""` for `serial`+`rls`+policy and for the partial-column pair; `table-kind.ts:636`, `diff-engine.ts:206`). Snapshot clause fails through the CLI: `commands/generate.ts:708-723` returns before `:767` writes the snapshot; measured the drops returning on the next removal |
| 4 | table-declaration | An adopted table gains what the declaration manages | OK (see R2-N1) | Probe: no `create table`, no `add column`/`drop column`/`alter column "id" type`; `create sequence` + `enable row level security` + `create policy` all present, identical-column and partial-column fixtures; `generate.test.ts:1058`, `:1185` |
| 5 | table-declaration | A reserved-schema validator exempts an existing table | OK | `supabase/src/validators/reserved-schemas.ts:32-36` + `schema-of.ts:34-37`; both clauses pinned `supabase/test/reserved-schemas.test.ts:81-97` (suite green 17/17, 141 tests) |
| 6 | table-declaration | An older snapshot's tables are all managed | OK | `kinds/table-snapshot.ts:273-275`; `core/test/snapshot.test.ts:484-512` uses a real `formatVersion: 8` node and proves the behavioral half (a drop still happens) |
| 7 | schema-export | An existing table survives the round trip | OK (see R2-N7; and R2-B2 when the run has no other change) | `export/description.ts:150-161` (shared `columnFact`, `existing: meta.existing`), `export-write.test.ts:207-238`, `validate-export.test.ts:135-151`, key order `export-determinism.test.ts:94-119` |
| 8 | schema-export | A description written before the mark reads as managed | OK | `vendor/validate-export.ts:43-48` (`z.boolean().default(false)`), `validate-export.test.ts:167-176` (payload with no `existing` key) |
| 9 | schema-vendoring | A consumer reads a platform-owned table | OK (see R2-N4; and R2-B2 for the add-alone path) | `contract/tables.ts:238-246`, `contract/emit.ts:126-131,157`; `cli/test/contract-existing.test.ts` (real ESM evaluation of the emitted module: `existing:true` present on the existing table, key absent on the managed one, `referencedRelation: "auth.users"`). Client-read half Docker-gated |
| 10 | schema-vendoring | An undeclared table still has no relation | OK | `contract/tables.ts:178-196` (`findTableInSnapshot` → `null` drops the entry); `cli/test/contract-emit.test.ts` green |
| 11 | cli-commands | An existing declaration is neither compared nor inventoried | OK (R2-N2 widening still open) | `check/compare.ts:414-427` (returns `[]` before any catalog lookup), `check/inventory.ts:38-44`; all four clauses pinned `check-command.test.ts:545-635`, green |
| 12 | cli-commands | baseline and reset pass an existing declaration by | OK | `apply-reset.test.ts:147-183` (`planReset` yields `["table:app.managed","schema:app"]` only; no DDL call mentions `auth`) green; `baseline-command.test.ts:100-124` asserts the baseline SQL never names the existing table (read, not run — subprocess suite blocked on the dist-freshness guard) |

---

### Method

- `npx openspec show add-unmanaged-objects --diff` from the repo root —
  four ADDED requirements, twelve scenarios. Read from
  `evaluation.md`: the round-1 findings list and `## Round 1
  disposition` only. `proposal.md`, `design.md`, `tasks.md`, PR bodies,
  `git log` messages and `blackbox/` were not read.
- Read: `packages/core/src/{dsl/existing-table.ts, dsl/table.ts,
  dsl/grant.ts, engine/generate.ts, engine/diff-engine.ts,
  engine/rename-plan.ts, engine/rename/{types,snapshot-sets,ambiguities}.ts,
  kinds/{table-kind,table-snapshot,sequence-kind,rls-kind,policy-kind}.ts,
  kind/object-kind.ts}`; `packages/cli/src/{loader.ts,
  commands/generate.ts, commands/reset.ts, export/description.ts,
  vendor/validate-export.ts, contract/{tables,emit}.ts,
  check/{compare,inventory}.ts}`; `packages/query/src/client/synthesize.ts`;
  `packages/supabase/src/validators/*`; `packages/nile/src/validators.ts`;
  `skills/hejbro/references/brownfield-adoption.md`;
  `.changeset/declare-existing-tables.md`.
- Adversarial probes: sixteen throwaway `tsx` scripts under
  `/tmp/d106-r2/` importing `packages/core/src/index` directly (deleted
  afterwards; no repository file created or modified). They exercised:
  an `existingTable()` with `serial`, and its removal; the repo's own
  Nile fixture replayed; managed(`serial` PK + RLS + policy) → existing
  handover with full SQL dump, and the removal that follows it; the
  reverse adoption, with an index/`notNull` columns in the managed
  declaration; the partial-column pair in both directions; an existing
  declaration alone (no `create schema` leak); two existing tables
  together; a managed FK onto an existing table; a grant attempt (the
  grant DSL is schema-level, so a table-scoped grant onto an existing
  table is not expressible — the `ownerTableIdentity` decision to skip
  `grant` is moot, not risky); the same identity declared both managed
  and existing (correctly refused, `declarations at index … both
  produce the identity`); table renames and column renames across
  existing declarations, with and without `--rename`/`--confirm-drop`
  (R2-B1); and `generateMigrations` over an in-sync project gaining an
  existing declaration alone (R2-B2).
- Tests run: `packages/core` full suite — 98 files, 1472 passed + 1
  todo. `packages/supabase` full suite — 17 files, 141 passed.
  `packages/cli` — `contract-existing`, `contract-emit`,
  `validate-export`, `apply-reset`, `apply-raise` green (48 passed);
  `check-command.test.ts`'s existing block read and its four in-process
  cases green in the full run.
- Not run / environment notes: 23 `packages/cli` files fail on the
  `assertFreshBuild` staleness guard alone
  (`test/support/cli-runner.ts:61`) — per the brief no build was run and
  their assertions were read instead. One further `packages/cli` failure,
  `assert-schema.test.ts` "supplying registerSupabaseKinds's registry
  turns the refusal into a stated boundary", is an artifact of invoking
  vitest outside turbo: `vitest.shared.ts` aliases `@hejbro/core` and
  `@hejbro/query` to source but **not** `@hejbro/supabase`, which then
  resolves to a stale `dist`. Unrelated to this change.
  `packages/nile` has no installed `node_modules`, so its suite could not
  run; its sources and tests were read and its fixture replayed against
  `packages/core/src`. Docker-gated `*integration.test.ts` files were not
  run.

---

## Round 2 disposition

Summary for a round 3 evaluator: R2-B1 is fixed and pinned with all
four of the evaluator's own reproductions. R2-N5/N6/N7 are fixed.
R2-B2 is **held** — measured, not coded — because its fix shape needs
an owner-level judgment call the implementer cannot make alone: the
one candidate fix (persist a snapshot on the no-change branch) would
contradict an already-shipped, unrelated requirement in the live
`cli-commands` spec.

### R2-B1 — fixed

**Fix**: `engine/rename/snapshot-sets.ts` gained `excludeExisting`,
applied where `rename-plan.ts` builds `previousTables`/`nextTables`
from `tableEntries` (D106 R2) — a table marked existing on either side
is dropped from both maps before `computeSchemaTableSets`/
`computeTableColumnSets` ever run, so it can never be counted as a
rename candidate or a rename-ambiguity source. `tableEntries` itself
is untouched (still literally "every table entry"); the exclusion is
applied at the one real call site instead, since `tableEntries` has no
other caller in the repository.

**Pins**: four new tests in `packages/core/test/generate.test.ts`
("an existing declaration emits nothing" describe block), replaying
the evaluator's own reproductions A–D verbatim: changing an existing
declaration's own column name (A), renaming the declaration itself
(B), removing an existing declaration alongside an unrelated managed
table addition in the same schema (C), and a managed table replaced by
an existing declaration under a *different* name (D) — measured to
resolve as an ordinary drop of the vanished managed identity, touching
nothing named after the existing table, not as a rename ambiguity.

**Mutant** (`excludeExisting` reverted to `tableEntries` directly):
exactly 4 red — the same four new tests, reproducing the evaluator's
own exact error messages verbatim (`ambiguous-column-rename`/
`ambiguous-table-rename`, naming the exact `--rename`/`--confirm-drop`
remedy the evaluator quoted) — across the full core suite (98 files/
1477), the other 1473 stayed green, including every pre-existing
`rename-plan.test.ts`/`rename-with.test.ts` test: the fix does not
touch managed-table rename behavior at all.

**Amplification note**: the evaluator's own "flagship preset" finding
(Supabase's `reservedSchemaValidator` raising no diagnostic for the
rename DDL) is now moot, not merely unobserved — the DDL this fix
prevents was the only thing that finding depended on; with R2-B1
closed, there is no statement left for that validator to have missed.

### R2-N5, R2-N6 — fixed

Both in `skills/hejbro/references/brownfield-adoption.md`'s "Deciding
what to manage" section (rewritten) and `.changeset/
declare-existing-tables.md` (rewritten): the unscoped "ever"/"never"
claims are now scoped to what's actually guaranteed (an existing
table's own identity — adding, changing, renaming, or removing the
declaration, none of it blocking an unrelated managed change either,
now that R2-B1 closed the rename-planner gap) rather than an
unconditional absolute; a stale "the adoption choice per table is
binary and made once … not a staging step" sentence (directly
contradicted by the delta's own "An adopted table gains what the
declaration manages" scenario) is replaced with a description of the
supported handover/adoption transition and exactly what gets created
on adoption (a serial column's sequence, row-level security, its
policies) — matching AGENTS.md's "a stale skill is a broken user
contract". `packages/skills` test: 5 files/21 tests green, unchanged
(the existing link-checker/snippet-compiler gate every path and code
block cited).

### R2-N7 — fixed

New test in `packages/cli/test/export-write.test.ts`, "an existing
table's own columns, mode and notNullElements survive a real
write-then-read round trip" — connects both halves of the round trip
the write pin (`export-write.test.ts`'s own "carries an existing table
marked as such") and the read pin (`validate-export.test.ts`'s hand-
written payloads) never met: a real CLI `generate --export` writes a
richer existing declaration (`bigint`/an array column with
`notNullElements()`), and `validateExport` — imported in-process,
since it is pure JSON validation with none of `loadDeclarations`'
jiti/module-instance risk the CLI-subprocess convention exists to
avoid — reads the same `format.json`/`schema.json` that same run just
produced, asserting the existing table's `exportName`, and each
column's `key`/`mode`/`notNullElements` round-trip exactly.

### R2-B2 — fixed (held for measurement first, unblocked by the lead's J12 ruling)

No code changed in this sub-round. Three measurements, as instructed:

**① Does `generateMigrations` expose a top-level snapshot when
`migrations` is empty? No — confirmed by reading, not assumed.**
`GenerateMigrationsResult` (`engine/generate.ts:272-279`) has no
top-level `snapshot` field at all, only `migrations[].snapshot`. Worse
than merely absent: `generateMigrations`' own `!pipeline.hasChanges`
branch (`engine/generate.ts:608-616`) returns `{ migrations: [],
hasChanges: false, errors: [], ambiguities: [], warnings }` —
`pipeline.snapshot` is a real, already-computed value in scope at that
exact point (used two branches later, at `:622-623`, when there ARE
changes) and is silently discarded rather than returned. The CLI's own
`runGenerate` calls `generateMigrations` (confirmed in group 3's own
measurement, tasks.md 3.1), never the singular `generateMigration`
(which *does* return a top-level `snapshot` unconditionally,
`engine/generate.ts:679-705` — a different function with a different
contract). This is why the CLI structurally cannot get the built
snapshot out of the no-change branch today: the value exists one stack
frame away and is thrown away before the caller ever sees it.

**② Is the "no changes — snapshot already matches your declarations."
text fixed by a live requirement? Yes — this is a bigger finding than
the evaluator's own framing.** The text is pinned in a real test
(`packages/cli/test/generate-command.test.ts`) — but it is also
written, verbatim, into the **currently-active, unrelated**
`cli-commands` capability at `openspec/specs/cli-commands/spec.md:
409-414`: "A run that finds no difference SHALL write no migration
**and no snapshot**, report 'no changes — snapshot already matches
your declarations'". This is not merely a message-text/MODIFIED-delta
question — the evaluator's own suggested fix shape ("persist the
newly-built snapshot when the no-change branch's snapshot differs from
`previousSnapshot`") would **contradict this already-shipped
requirement outright**, for every project, not just ones with an
existing declaration. Reconciling add-unmanaged-objects' own need
(record the existing marker even when nothing else changed) against
this pre-existing, unrelated "no changes ⇒ no snapshot write" rule is
exactly the judgment call that needs the owner/lead, not something
this measurement can resolve on its own.

**③ Does the `--export` no-change path use `previousSnapshot`, and is
the description rebuilt fresh? Confirmed, both halves, exactly as the
evaluator described.** `commands/generate.ts:697-717`:
`writeExportArtifact` takes a `snapshot` parameter and is called with
`previousSnapshot` (`:717`) on the no-change branch; its own
`description` (`:698-701`) is rebuilt from the *current* `declarations`
via `buildExportDescription` every time, unconditionally. So an
existing declaration added alone (`hasChanges: false`) produces an
export whose `description.tables` genuinely carries the new table's
fact, paired with a `snapshot` that does not carry its `table:` node —
exactly the mismatch `contract/emit.ts`'s `computeTables` silently
drops, reproducing the evaluator's own Consequence 3 by reading, not
running.

**Fix (option A, lead's J12 ruling).** `GenerateMigrationsResult` gained
an unconditional top-level `snapshot` (all three return branches —
blocked, no-DDL, ordinary — now match `generateMigration` singular's own
convention, closing measurement ①). The CLI's no-DDL branch
(`commands/generate.ts`) now decides whether to persist by comparing the
run's own settled snapshot against `previousSnapshot`
(`sameJson(firstPass.snapshot.objects, previousSnapshot.objects)`,
core's own public `sameJson`) instead of trusting `hasChanges` alone —
when they differ, the snapshot is written even with no migration to
write, and `--export`'s no-change path always describes
`firstPass.snapshot`, never the stale `previousSnapshot` (closing
measurement ③). Measurement ②'s apparent conflict resolved differently
than it first looked: this change's *own, still-open* `cli-commands`
delta (`openspec/changes/add-unmanaged-objects/specs/cli-commands/spec.md`,
written directly by the lead/planner per J12) already replaces the live
capability's "no migration and no snapshot" text with language covering
exactly this scenario — the underlying requirement decision had already
been made at proposal time; the implementation just hadn't caught up to
it. The report line for the new case
(`"no migration — snapshot updated to record the declared change."`)
matches that delta's own description ("report that the snapshot was
updated with no migration to write") and is pinned in three CLI tests,
replaying the evaluator's own consequences 1-3 through the real CLI
subprocess (not a hand-built payload): `generate-command.test.ts`'s
"an existing marker survives a real handover run on the on-disk
snapshot" (① — reads the file the CLI actually wrote) and "a run that
later removes a handed-over table's declaration entirely never brings
its drops back" (② — file-count plus four narrowed destructive-drop
greps, after a bare `"drop"` search first false-positived on `create
policy`'s own idempotent `drop policy if exists` line), and
`export-write.test.ts`'s "an in-sync project that only newly exports an
existing declaration keeps the export/contract pairing" (③ — feeds the
CLI's real `schema.json`/`format.json` through `validateExport` into
`emitContract`, not a hand-built `ExportPayload`). Mutant (the whole
fix reverted to the pre-fix, `hasChanges`-only shape): exactly 3 red /
549, zero collateral — measured twice (mid-fix and again against the
final code including the message-text change), same count both times;
`generate-command.test.ts`'s own pre-existing "reports no changes and
writes no new file on a second run" (the "No difference writes nothing"
scenario's pin) stayed green under the identical mutant both times,
confirming the two cases genuinely diverge rather than the fix simply
making the snapshot write unconditionally.

### Gates (R2-02, R2-B2's own close)

`TURBO_FORCE=1 pnpm build --force` (7/7, run once per mutant swap),
`check` (656 files clean — one ternary Biome's `noTernary` refused,
extracted into a small helper), `check-types` (16/16, 0 cached, forced),
`test` (17/17 tasks — core 98f/1477t unchanged, cli 64f/549t [+3 over
R2-01's 546t]). `openspec validate --strict` valid.

### Snapshot consumers

UO-D106-R2-05 (lead ruling: a full sweep is cheaper before a round-3
review than another round finding the next site one at a time — R1 found
the fan-out kinds, R2 found the rename planner and the CLI's own
snapshot-write rule, both on the same axis: *a consumer that reads the
snapshot without knowing this piece's own marker*). Every site below was
found by grepping `packages/{core,cli,supabase,nile}/src` for
`snapshot.objects`, `asTableSnapshot`, `tableEntries`, `splitObjectKey`,
the string literal `"table:`, and every function parameter typed
`Snapshot` (including non-`snapshot`-named ones — `previous`/`next`/
`previousSnapshot`/`currentSnapshot`/`rewrittenPrevious`/`nextSnapshot`/
`contextSnapshot`) — the exact commands are listed at the end of this
section so a later reviewer can re-run the same sweep. Grouped by area;
line numbers are this round's own (`3183d167`).

**① column** — does this site make a decision that must answer
differently for a table hejbro doesn't own (write DDL, refuse, compare
against a live catalog, list in an inventory, emit a type)? **②** — does
it actually know, today? **③** — file:line and the test that pins it, or
"no pin" if none exists.

#### Diff / generate engine (core)

| Site | ① | ② | ③ |
|---|---|---|---|
| `diffSnapshots` (`engine/diff-engine.ts:189`), via `ownerIsExisting`/`authoritativeOwnerNode` (`:163`/`:136`) | yes | yes | `core/test/generate.test.ts` uo7-uo10 (R1), the R1-03/R1-04 mutants (3-4 red measured) |
| `tableKind.diff`'s own `isExistingSide(previous)\|\|isExistingSide(next)` guard (`kinds/table-kind.ts:636`, guard `:568`) | yes | yes | same uo7-uo10 suite; R1-03's own mutant (3 red, the removal-direction failure mode it named) |
| `resolveTableDeclarations`'s `if (meta.existing) return [meta]` (`engine/generate.ts:127,164`) | yes | yes | B1's own fan-out-suppression pins (R1) — this is *why* sequence/rls/policy fan-out declarations never exist for an existing table, upstream of the diff entirely |
| `table-kind-emit.ts`'s whole emit surface (`emitCreate`, `standingGrantStatements`, `identityOptionChangeStatements`, …) | n/a | n/a | structurally unreachable — every emit function here is only ever called from a `KindChange` `tableKind.diff` already produced, and the guard above means no such change exists for an existing table; no per-function check needed |
| `core-validators.ts`'s `notNullWithoutDefaultWarnings` (reads `change.previous`/`change.next` via `asTableSnapshot`) | no | — | filters `isTableAlterChange` first — an `alter` `KindChange` for an existing table can't exist (same guard as above), so this never sees one |
| `core-validators.ts`'s `rlsUnreachableSchemaWarnings` | no | — | judges `PolicyDeclaration`s only; `existingTable()`'s own DSL (`dsl/existing-table.ts`) takes no `rls`/policy config at all, so a policy can never target an existing table by construction |
| `grant-kind.ts`'s `standingAllTablesGrants` (`snapshot: Snapshot` param, `:143`) | no | — | reads schema-wide standing grants to re-issue alongside a table's own `create` — only ever called from an already-guarded `create` emit, and doesn't ask "is *this* table existing" at all |
| `grant-kind.ts`'s `emit`/`diff` | no | — | **checked, then corrected**: first pass here claimed a deliberate-but-unpinned "grant on an existing table still emits" gap, matching R1's `ownerTableIdentity` note. Re-checked against `dsl/grant.ts:17` (D28) before finalizing: `GrantKind` is `"schema-usage" \| "all-tables-privileges" \| "default-table-privileges"` only — **per-table grants don't exist in this DSL at all** ("out of scope until a real declaration needs them"), so there is no existing/managed axis for a grant declaration to answer differently about; R1's `ownerTableIdentity` exclusion is precautionary for a future per-table grant kind, not a currently-reachable behavior |
| `engine/split.ts`'s `applySplitChangesOnly` (`previousSnapshot: Snapshot`) | no | — | only ever applies **enum**-kind changes to build the intermediate split snapshot; an enum change is never about a table's own identity |
| `engine/validate.ts`'s `Validator`/`runValidators` | n/a | n/a | the orchestrator/interface only — the decision lives in each preset's own validator (see below) |

#### Rename engine (core)

| Site | ① | ② | ③ |
|---|---|---|---|
| `engine/rename-plan.ts`'s `planRenames` → `excludeExisting` (`engine/rename/snapshot-sets.ts`) | yes | yes (R2-B1) | `core/test/generate.test.ts` "D106 R2, R2-B1 repro A/B/C/D"; mutant 4 red/1477 |
| `rename/ambiguities.ts` (`residualColumnAmbiguities`/`residualTableAmbiguities`/`consumedColumnNamesByTable`/`consumedTableNamesBySchema`) | yes | yes, transitively | reads only the already-filtered `tableColumnSets`/`schemaTableSets` `planRenames` builds — never the raw snapshot directly; covered by the same R2-B1 repros (an ambiguity naming an existing table was exactly repro B/C's own shape) |
| `rename/apply.ts`'s `applyTableRename`/`applyColumnRename`, `rename/retarget.ts`'s rewrite helpers (both read via `asTableSnapshot`) | yes | yes, transitively | only ever invoked with a `RenameSpec` from `renameResult.validSpecs`, itself derived from the filtered sets above — an existing table's rename can't reach here to begin with; no dedicated pin exercises `apply.ts` directly with an existing-table spec (relies on the upstream filter, not a bespoke check in this file) |

#### `hejbro check` (CLI)

| Site | ① | ② | ③ |
|---|---|---|---|
| `check/compare.ts`'s `compareTable` (`:414`, guard `:426`) | yes | yes | `check-command.test.ts` "no difference is reported for it"; requirement: `cli-commands` (this change's own ADDED) "The apply commands leave existing declarations alone" |
| `check/inventory.ts`'s `declaredTableIdentities`/`unmanagedTables` | yes | yes — **by construction, not a check**: any `table:` key (existing or managed) counts as declared, so an existing table is excluded from "unmanaged" without a dedicated `existing` branch | `check-command.test.ts` "is absent from the inventory section", "the word \`unmanaged\` never appears in the report…"; requirement: same ADDED requirement, "SHALL NOT list it in the unmanaged inventory" |
| `commands/check.ts`'s `renderCheckReport` / coverage-boundary section (`cli-commands`, live requirement "The check states the boundary of its own coverage") | **yes — found by this round's own R2-06/R2-07 check** | **no, until this round** | **fixed this round**: added `existingTableBoundaryLines` (`commands/check.ts`), a new line per declared existing table, matching the boundary section's own established "check does not compare X: reason" style (not `inventoryLines`' "unmanaged" wording — R2-08's own explicit vocabulary rule): `"check does not compare <schema>.<table>: declared existing and not compared."`, threaded through a new optional 4th `snapshot` param on `renderCheckReport` (defaults to `emptySnapshot`, same safety reasoning as the existing `registry` default — informational text only, never the exit code). Classification: the live requirement's own two "uncomparable" categories (a kind-level `noCatalogObjectReason`, or an object-level operational failure) are both about answers left *uncertain*; an existing table's skip is a *certain*, by-design non-comparison, matching neither category by name — but the requirement's own opening sentence ("check SHALL state, in its own report, what it did not compare... A checker silent about its blind spots is read as a guarantee it never made") is not scoped to only those two categories, so this was a genuine silent gap, not a false alarm. Not a conflict with this change's own "SHALL NOT list it in the unmanaged inventory" clause: the inventory is the *undeclared*-table list, the coverage-boundary section is the *uncompared-declaration* list — two different questions, same distinction this change already drew in round 1 over the word "unmanaged" (declared-but-unmanaged vs undeclared). The scenario names four THEN clauses (naming, not a finding, absent from the unmanaged inventory, exit code unaffected) — a fifth, "not counted as agreeing", was drafted mid-round and then **cut** (R2-11) once measuring `renderCheckReport`'s exit-0 branch/`summaryLine`/`nonEmptyFindingsExitCode` showed this report has no agree-count anywhere for an existing table to be counted under — keeping that clause would have made it an unobserved claim, the exact N2 shape this piece has avoided throughout. Each of the four remaining clauses gets its own assertion (`check-command.test.ts`, matching round 1's own per-axis convention): ⑤ names the table in the boundary section, ⑥ contributes zero findings, ⑦ absent from the unmanaged inventory, ⑧ exit code unaffected. Mutant (comment out the new boundary line): exactly 1 red (⑤ only), ⑥⑦⑧ and every pre-existing test stay green — the four axes are genuinely independent. The planner/lead wrote the delta text and scenario directly into this change's own still-open `cli-commands` ADDED requirement (`specs/cli-commands/spec.md`) across three passes in the same round — the first draft ("SHALL NOT be counted as agreeing"), a narrowing to a conditional ("wherever...summarises...SHALL NOT be among them"), then cutting the clause outright once the measurement above confirmed there is nothing today for it to condition on — each matching this fix's report line and exit-code-unaffected behavior on read |
| `commands/check.ts`'s `declaredCheckConstraints` | yes, in principle | yes — **structurally, not explicitly**: `existingTable()`'s DSL has no `checks` parameter, so an existing table's `checks` array is always absent/empty; no `tableExisting` guard exists here because none is currently reachable | no dedicated pin — flagged as fragile: a future DSL change letting `existingTable()` carry checks would silently start comparing them with no test to catch it |
| `assert-schema.ts` (reuses `check/compare.ts`'s `compareCatalog`) | yes | yes, transitively (shared code path) | no `assertSchema`-specific pin for the existing-table skip — relies entirely on `compareTable`'s own pin; a future bypass of `compareCatalog` inside `assertSchema` wouldn't be caught here |

#### Export / vendored contract (CLI)

| Site | ① | ② | ③ |
|---|---|---|---|
| `export/description.ts`'s `buildExportDescription` | yes | yes | `export-write.test.ts` "carries an existing table marked as such (2.1)", "…round trip (R2-N7)" |
| `contract/read-snapshot.ts`/`contract/tables.ts`'s `buildRelationships`/`findTableInSnapshot` | yes (identity-agnostic *by design* — an FK target resolves the same way whether the target is existing or managed) | yes | `contract-existing.test.ts` "a foreign key onto a declared existing table resolves to a relation"; R2-B2's own ③ (real CLI round trip) |
| `contract/emit.ts`'s `computeTables` | yes (must not drop an existing table's fact) | yes — "green on arrival" (D33's own "no omitted fact" rule already covered it before this piece existed) | `contract-existing.test.ts` "green on arrival: an existing table already appears under Tables…" |
| `export-compare.ts`'s `compareExport` (verify's own R2-G3 check) | no | — | byte-comparison against a freshly-rebuilt expected payload from the same builders `generate --export` uses — no decision of its own; the `snapshot` it's handed (`commands/verify.ts`'s `runExportCheck`) comes from `generateMigration` **singular**, which already returns the fresh, correct snapshot unconditionally (never the stale-snapshot shape R2-B2 fixed for the plural entry point) |

#### Apply engine / ledger (CLI)

| Site | ① | ② | ③ |
|---|---|---|---|
| `apply/reset.ts`'s `planReset` (reuses `diffSnapshots(currentSnapshot, emptySnapshot, …)`) | yes | yes, transitively (same diff-engine guard as generate) | `apply-reset.test.ts` "leaves a declared-but-existing table standing, and never counts it toward the drop confirmation" |
| `commands/reset.ts`'s `applyResetReport` | no | — | thin wrapper over `applyReset`; no decision of its own |
| `apply/raise.ts`/`commands/raise.ts` | no | — | reads raw migration SQL text and the ledger only — the `SnapshotFile` type here is an unrelated migration-file record (`fileName`/`sql`/`origin`), not core's `Snapshot`; matches the delta's own "raise … reads migration text and the ledger, never a declaration" |
| `apply/plan.ts`, `apply/execute.ts`, `apply/ledger.ts`, `commands/migrate.ts`, `commands/status.ts` | no | — | none of these files reference `Snapshot` at all (confirmed by grep, zero hits) — the whole apply/ledger path operates over migration files and the ledger table only |
| `commands/verify.ts` check 2 (declarations ↔ snapshot, byte comparison via `generateMigration` singular) | no | — | a byte-identical re-derivation and comparison; correctness flows from `buildSnapshot`'s own marker output, already covered elsewhere |
| `commands/verify.ts`'s export check (`runExportCheck` → `compareExport`) | see `export-compare.ts` above | yes | passes `generateMigration({...}).snapshot` — the singular entry point's always-fresh contract, not the stale shape R2-B2 fixed |

#### Preset validators (`@hejbro/supabase`, `@hejbro/nile`)

| Site | ① | ② | ③ |
|---|---|---|---|
| `supabase/validators/reserved-schemas.ts` | yes | yes | `reserved-schemas.test.ts` |
| `supabase/validators/exposed-tables.ts` | yes | yes | `exposed-tables.test.ts` |
| `supabase/validators/rls-cached-auth-outside-rls.ts` | yes | yes | `rls-cached-auth-outside-rls.test.ts` |
| `supabase/validators/schema-of.ts`'s shared `isManagedTableDeclaration`-equivalent (`:37`) | yes | yes | feeds the three validators above |
| `supabase/validators/rls-uncached-auth-call.ts` | no | — | judges `PolicyDeclaration`s only; a policy can't target an existing table (same DSL-shape reason as core's `rlsUnreachableSchemaWarnings`) |
| `supabase/validators/view-security-invoker.ts` | no | — | judges only a view's own `security_invoker` option, independent of any table's existing status |
| `nile/validators.ts`'s `isManagedTableDeclaration` (`:53`), feeding `nileSerialValidator`/`nileTenantPrimaryKeyValidator`/`nileIdentityValidator` | yes | yes | `nile/test/validators.test.ts` |
| `nile/validators.ts`'s `nileRlsValidator`/`nileFunctionTriggerValidator`/`nileGrantValidator` | no | — | judge RLS/policy/trigger/function/grant declarations, none of which an existing table can carry |
| `supabase/storage/bucket-kind.ts` | no | — | storage buckets are an independent object kind (S3-like), unrelated to table declarations entirely (the one grep hit here was a comment, not code) |

#### Not a consumer — the marker's own origin

`snapshot/snapshot.ts`'s `buildSnapshot`/`parseSnapshot`/`renderSnapshot` and `kinds/table-snapshot.ts`'s `tableExisting`/`asTableSnapshot` are where the `existing` marker is written and read from, not a site that has to *know about* it the way everything above does — already covered by this piece's own original test suite and R2-N7's round trip.

#### Result

**One `①=yes,②=no` finding, small, fixed in this round** (R2-06/R2-07):
`hejbro check`'s coverage-boundary section named neither a kind-level
nor an operational reason for skipping an existing table's comparison —
the live `cli-commands` requirement "The check states the boundary of
its own coverage" was silently unmet for every declared existing table.
Fixed via `existingTableBoundaryLines` (`commands/check.ts`), red
confirmed first, mutant measured (1 red when reverted, zero collateral),
and this change's own still-open `cli-commands` ADDED requirement grew
the delta text and scenario the lead/planner wrote directly.

No other `①=yes,②=no` finding anywhere in the sweep beyond that one.
Three further sites are correct only *structurally* (no explicit
`existing`/`tableExisting` check defends them, only the shape of
today's DSL), worth naming so a future DSL change doesn't quietly
reopen them:

- **`declaredCheckConstraints`** (`commands/check.ts`): safe only
  because `existingTable()`'s DSL has no `checks` parameter today —
  structurally unreachable, not defended by a guard. No pin added this
  round (nothing to reproduce — there's no way to construct the input);
  noted for whoever adds a `checks` option to `existingTable()` later.
- **`assertSchema`'s existing-table skip**: correct only because it
  shares `compareCatalog` with `check` — no test exercises `assertSchema`
  itself with an existing-table fixture.
- **Grants** (`grant-kind.ts`): safe only because per-table grants don't
  exist in the DSL at all (D28) — not because anything checks
  existing-table status. The R1 `ownerTableIdentity` exclusion this
  round's first pass mis-cited as "a deliberate gap with no pin" was
  re-checked against `dsl/grant.ts` before being written down as a
  finding — it describes a precaution for a kind that doesn't exist yet,
  not a reachable behavior missing a test.

Nothing else here rises to "small, fix now" or "large, report now" —
the table above is the artifact itself.

**Search commands** (re-run to reproduce this sweep):
```
grep -rln "snapshot\.objects" packages/{core,cli,supabase,nile}/src
grep -rln "asTableSnapshot" packages/{core,cli,supabase,nile}/src
grep -rln "tableEntries" packages/{core,cli,supabase,nile}/src
grep -rln "splitObjectKey" packages/{core,cli,supabase,nile}/src
grep -rln '"table:' packages/{core,cli,supabase,nile}/src
grep -rn "snapshot: Snapshot\b" packages/{core,cli,supabase,nile}/src
grep -rn ": Snapshot\b" packages/{core,cli,supabase,nile}/src | grep -v "snapshot: Snapshot"
```

### Round 2 close-out (R2-12/R2-13)

Final pre-push confirmation, narrower than a full round close-out since
R2-08/09/11's own fix touched only `commands/check.ts`'s report text and
its own test file: `check:bans` re-run clean (219 package source files).
`test:integration` deliberately **not** re-run this pass — everything
this sub-round changed is CLI report text and its own tests; the
snapshot format, the diff/generate engine, and the export/vendor
contract path (the surfaces `test:integration`'s five files actually
exercise) are untouched since the last full integration run
(R2-06/07's own close-out, 5f/36t, both PG majors, `two-repo`'s
vendoring round trip included), so there is no new question for it to
answer. The lead's own closing gate re-runs it regardless. `check`,
`check-types`, and the full `test` suite were all re-run once already
(R2-11's own close-out, 17/17 tasks green) after this sub-round's test
restructure.

---

## Round 3

### Verdict

**BLOCKING 2 / NON-BLOCKING 7 / OK 13**

Round 2's own two fixes are each half-right, and each leaves a hole one
layer out from where it was patched:

- **R2-B2's fix works and breaks something else.** The no-DDL branch now
  writes the snapshot (all three of R2-B2's consequences are genuinely
  closed, re-measured through a real CLI). But a snapshot written with no
  migration has no migration banner carrying its hash — so the chain tip
  and the on-disk snapshot now disagree, and `hejbro verify` fails on a
  repository nobody hand-edited. That is a live, unmodified `cli-commands`
  requirement (**R3-B1**).
- **R2-B1's fix is applied per-side, not per-run.** `excludeExisting`
  filters `previousTables` and `nextTables` independently, so a table
  that is *managed on one side and existing on the other* — i.e. exactly
  a handover or an adoption — still counts as a dropped/added table name.
  Every one of R2-B1's four repros is closed; the transition the change
  exists to support is not (**R3-B2**).

Both were reached the same way R1 and R2 reached theirs: by running the
real CLI over a real project, on the paths whose fixtures the shipped
pins do not have (a run with *another* table changing in the same
schema; a run followed by `verify`).

---

### Round-2 findings re-checked

| # | Round-2 finding | Round-3 verdict | Evidence |
|---|---|---|---|
| R2-B1 | rename planner sees existing tables (repros A–D) | **closed for A–D, re-opened for the managed↔existing transition (R3-B2)** | `rename/snapshot-sets.ts:47-50` + `rename-plan.ts:47-50`. Real-CLI replay: A (`existingTable("c1","users")` column `name`→`title`) → `no migration — snapshot updated…`, zero migration files; B (declaration renamed `users`→`people`) → same; C (remove existing `e4.legacy` + add managed `e4.fresh`) → one migration, `+ table e4.fresh` only; D (managed `e3.widgets` → `existingTable("e3","gadgets")`) → plain `- table e3.widgets [dropped]`, nothing named `gadgets`. **But** the filter runs on each map separately, so a table managed in `previous` and existing in `next` is still in `previousTables` — see R3-B2 |
| R2-B2 | existing marker never reaches the on-disk snapshot | **closed (all three consequences), but see R3-B1** | `commands/generate.ts:738-751` (`sameJson(firstPass.snapshot.objects, previousSnapshot.objects)` gate) + `engine/generate.ts:272-279` (top-level `snapshot` on all three branches). Real CLI: ① handover run writes `"table:k1.widgets": {…,"existing":true}` to disk and prints `no migration — snapshot updated to record the declared change.`; ② removing the declaration afterwards still writes **one** migration file total — no `drop policy`/`drop sequence`/`disable row level security`/`drop table` anywhere; ③ an in-sync project that only adds `existingTable("auth","users")` writes an export whose `tables[]` fact **and** `snapshot.objects["table:auth.users"]` both carry it, and feeding that real `schema.json`/`format.json` through `validateExport`→`emitContract` yields `Tables["users"]` with `Row`/`Insert`/`Update` and `existing: true` in `contractMetadata` |
| R2-N1 | adoption creates the fan-out objects but not the adopted table's own indexes/checks/FKs/PK | **still open, and wider than R2 measured** | Real CLI, `existingTable("a1","widgets",{id})` → `table(a1,"widgets",{id:serial().primaryKey(), email:text().notNull()},…indexes:[index().on(t.email)])`: emits `create sequence` + `enable row level security` + `create policy` + `set default nextval` and **no** `create index`, **no** `add column "email"`, **no** primary key. Snapshot afterwards claims `"indexes":[{"name":"widgets_email_idx"…}]`, `"primaryKeyName":"widgets_pkey"`, and an `email` column. Second measurement (partial→wider column list, `s1.w`): three declared columns `a`,`b`,`c` never emitted, all three recorded. No clause, no pin, no issue. See NB1 |
| R2-N2 | `check`'s inventory widens to the whole reserved schema (R1-N1, #665) | **still open** | `check/inventory.ts:29-36` unchanged. Probe (`buildInventory` over a snapshot declaring `app.posts` managed + `auth.users` existing, catalog holding `auth.{users,sessions,refresh_tokens,mfa_factors}`) returns `[{auth,sessions},{auth,refresh_tokens},{auth,mfa_factors}]` — declaring one platform table pulls the rest of its schema into the report |
| R2-N3 | "a validator that checks a reference SHALL see it" has no observer (R1-N2, #666) | **still open** | `grep -rn foreignKeys packages/core/src/engine/core-validators.ts packages/supabase/src/validators packages/nile/src/validators.ts` → zero hits |
| R2-N4 | vendoring client-read half Docker-gated only (R1-N5, #667) | **still open** | `packages/cli/vitest.config.ts:14-16` still excludes `test/**/*integration.test.ts`; `two-repo.integration.test.ts` remains the only client-read witness |
| R2-N5 | changeset/skill over-claim "ever" | **fixed, except one new clause that is itself false** | `.changeset/declare-existing-tables.md` and `skills/hejbro/references/brownfield-adoption.md` are both rescoped to the table's own identity. But both now assert "none of them can block or refuse an unrelated managed change in the same schema either" — falsified by R3-B2. See NB5 |
| R2-N6 | skill contradicted the adoption scenario | **closed** | `brownfield-adoption.md` "Deciding what to manage" now describes the handover/adoption transition and what adoption creates; the "binary and made once … not a staging step" sentence is gone |
| R2-N7 | export round trip pinned in two halves that never meet | **closed** | Independently replayed through a real CLI `generate --export` writing `existingTable("billing","ledger",{id:uuid(), balance:bigint(), tags:text().array().notNullElements()})`, then `validateExport` over that run's own `format.json`/`schema.json`: `exportName:"ledger"`, `existing:true`, `balance.mode:"bigint"`, `tags.notNullElements:true`, `id.mode:null` all recovered |

---

### Blocking

#### R3-B1 — a snapshot written with no migration leaves the chain tip and the snapshot disagreeing, so `hejbro verify` fails on a repository nobody edited, permanently and with no remedy

Live requirement (`openspec/specs/cli-commands/spec.md:521-532`,
**not** modified by this change), "The migration chain on disk is
verifiable":

> the snapshot's recorded hash matches the parsed-and-re-rendered
> snapshot — so a hand-edited snapshot, an edited `parent-snapshot:` or
> `snapshot:` hash line … is reported as a mismatch, and an untouched
> chain passes.

Its scenario, "An untouched chain passes":

> - **WHEN** `hejbro verify` runs over migrations and a snapshot that
>   hejbro wrote and nothing edited
> - **THEN** it passes with exit code zero

**Code path.** `commands/generate.ts:742-746` now writes
`hejbro.snapshot.json` on the no-DDL branch whenever
`firstPass.snapshot.objects` differs from `previousSnapshot.objects`.
No migration file is written on that branch, so no banner carries the
new snapshot's hash. `verify`'s check 4 (`commands/verify.ts:535-547`)
compares the last migration's `snapshot:` hash against
`normalizedSnapshotHash(diskText)` and now finds them different.

**Reproduction (measured, real CLI over a real project — the exact
flagship path the proposal names).**

```
hejbro init
# src/app.schema.ts: schema("app") + table(app,"posts",{id,title})
hejbro generate                       → wrote migrations/…_add_app.sql
hejbro verify                         → verify: 5 checks passed
# add src/b.schema.ts: existingTable("auth","users",{id})
hejbro generate                       → no migration — snapshot updated to record the declared change.
hejbro verify                         → exit 1
```

```
error[chain-tip-mismatch]: snapshot:
  the migration chain's tip hash doesn't match the current snapshot — the last
  migration's "snapshot:" hash and the on-disk snapshot's own hash disagree,
  which means the snapshot or the last migration file was edited after the last
  `hejbro generate`. Next: restore the snapshot (and the last migration file, if
  it was edited) from version control — the snapshot is a derived file and
  should only ever change through `hejbro generate`.

verify: 1 of 5 checks failed — fix the errors above and rerun `hejbro verify`.
```

Two things make this worse than a wrong exit code:

1. **The message is false and its remedy is destructive.** Nothing was
   edited; the snapshot changed *through* `hejbro generate`, exactly as
   the message says it should. A user following "restore the snapshot
   from version control" would throw away the existing marker this
   change exists to record.
2. **There is no way out.** Re-running `hejbro generate` reports
   `no changes — snapshot already matches your declarations.` and writes
   nothing (measured). `verify` stays red for the life of the
   repository, or until some unrelated migration happens to be
   generated.

**Second failure mode — the chain breaks permanently at the next real
migration.** The next `generate` that *does* emit DDL writes
`parent-snapshot:` = the snapshot the no-migration run settled on, which
matches no earlier migration's `snapshot:` line. Measured, same project
plus a foreign key onto the existing table:

```
error[broken-chain]: 20260902124738_alter_posts.sql
  the migration chain is broken at "…_alter_posts.sql" — its parent-snapshot
  hash doesn't match any earlier migration's snapshot hash. …
skipped: chain tip ↔ snapshot (needs a parseable snapshot and a linear chain)
verify: 1 of 6 checks failed, 1 skipped
```

Reproduced independently three times: the in-sync-project-gains-an-
existing-declaration path (above), the managed→existing handover path
(`k1.widgets`, `chain-tip-mismatch`), and the handover→adoption path
(`s1.w`, `broken-chain`). `verify` is documented as the offline CI gate
("`verify` (offline migration-chain integrity)",
`openspec/specs/cli-commands/spec.md:9-10`), so this is a CI break for
every repository that adopts the feature.

**Why the shipped pins miss it.** `generate-command.test.ts`'s two new
R2-B2 tests assert the snapshot file's *content* and the migration file
*count*; neither runs `verify` afterwards, and `verify.test.ts` has no
fixture in which `generate` itself moved the snapshot without writing a
migration. The repository's own `examples/` declare no `existingTable()`
(`grep -rn existingTable examples/` → no matches), so the example
round-trips never reach this state either.

**Scope of the decision (informational).** The delta's own MODIFIED
requirement settles that such a run writes the snapshot; it says nothing
about what then anchors the chain. Either the chain-tip rule has to
learn about a snapshot state no migration carries, or such a run must
also record its own hash somewhere `verify` reads. That is a
requirement-level decision this change owns — it created the state — and
it is currently unmade, with the live requirement quietly falsified.

---

#### R3-B2 — `excludeExisting` filters each side of the run separately, so a handover or an adoption still registers as a dropped/added table name: any *other* table added or dropped in that schema in the same run is refused, and the prescribed `--rename` remedy emits DDL against the existing table and never creates the intended one

Requirement (`table-declaration`, this change's own ADDED):

> the generator SHALL emit no statement for it and SHALL diff nothing
> against it … everything that writes DDL SHALL not see it at all.

Scenario, "A table handed to the platform loses nothing":

> - **THEN** no statement is written at all — the table is not dropped …

**Code path.** `rename/snapshot-sets.ts:47-50`:

```ts
export const excludeExisting = (tables) =>
	new Map(Array.from(tables).filter(([, table]) => !tableExisting(table)));
```

applied at `rename-plan.ts:47-50` to `previousTables` and `nextTables`
**independently**. Its own doc comment (`snapshot-sets.ts:37-45`) claims
the opposite — "so one is never a rename candidate and never a rename
ambiguity source, **on either side of a run**" — and the Round 2
disposition restates it as "a table marked existing on either side is
dropped from **both** maps". Neither is what the code does. A table
managed in `previous` and existing in `next` (a **handover**) survives
in `previousTables`; existing in `previous` and managed in `next` (an
**adoption**) survives in `nextTables`. `computeSchemaTableSets`
therefore still counts it as a dropped, respectively added, table name,
and `residualTableAmbiguities` still raises on it.

**Reproduction α — handover in a run that also adds a managed table.**
`s2.widgets` managed, then in one run: hand it over *and* add `s2.gizmos`.

```ts
export const widgets = existingTable("s2", "widgets", { id: uuid() });
export const gizmos  = table(s, "gizmos", { id: uuid().primaryKey() });
```

```
error[ambiguous-table-rename]: s2
  table "widgets" was dropped, table "gizmos" was created.
  → if this is a rename, rerun:
      hejbro generate --rename s2.widgets=gizmos
```

`hejbro generate` refuses outright. Following the remedy it prescribes:

```sql
-- hejbro migration
-- ~ table s2.widgets [renamed to "gizmos"]

alter table "s2"."widgets" rename to "gizmos";
alter table "s2"."gizmos" rename constraint "widgets_pkey" to "gizmos_pkey";
```

Two statements against `s2.widgets` — the table the declaration on that
same run says hejbro does not own — and **no `create table "s2"."gizmos"`
at all**, so the table the user actually asked for is never created. The
snapshot the same run writes records `table:s2.widgets` with
`"existing": true` *and* `table:s2.gizmos` as a managed table, while the
migration renamed one into the other: snapshot, migration, and database
now disagree three ways.

**Reproduction β — adoption in a run that also drops a managed table.**
`s4.legacy` existing + `s4.old` managed, then in one run: adopt `legacy`
into a managed `table()` and delete `old`.

```
error[ambiguous-table-rename]: s4
  table "old" was dropped, table "legacy" was created.
  → hejbro generate --rename s4.old=legacy
  → hejbro generate --confirm-drop s4.old
```

With the prescribed `--rename`:

```sql
alter table "s4"."old" rename to "legacy";
alter table "s4"."legacy" rename constraint "old_pkey" to "legacy_pkey";
```

A rename onto the identity of a table that, being declared
`existingTable()`, already exists in the database — the apply-time
collision R2-B1's own repro D named, reached through the adoption door.

**The other remedy is not free either.** `--confirm-drop s2.widgets`
does produce correct SQL (measured: `create table "s2"."gizmos"` only,
nothing touching `widgets`) — but it makes the user *confirm the drop of
a table hejbro never drops and does not own*, which is verbatim the
harm R2-B1's repro C described.

**Bounds of the hole (measured, so the fix can be scoped).** A handover
alone is fine (`no migration — snapshot updated…`). A handover in a run
that only *drops* another managed table in that schema is fine (a lone
drop is not an ambiguity: measured, `- table s3.gizmos [dropped]`, one
migration). A different schema is fine (the sets are per-schema). The
break is exactly: a managed↔existing transition **plus** at least one
table added (handover) or dropped (adoption) in the same schema in the
same run.

**Fix shape (informational):** the exclusion has to be computed over the
run, not over one map — a table marked existing in `previous` **or** in
`next` must be dropped from both `previousTables` and `nextTables`,
which is what `excludeExisting`'s own doc comment already claims and
what `tableKind.diff`'s bidirectional guard (`table-kind.ts:636`)
already does one layer down.

**Test gap.** The four R2-B1 pins replay repros A–D, all of which keep
the table existing (or managed) on *both* sides; none crosses the
managed↔existing boundary in a run that also touches another table in
that schema. `generate.test.ts`'s handover/adoption pins
(`:1051`, `:1179`) change exactly one table per run. The fixture shape
that reaches this is "transition **and** something else in the same
schema" — the same one-table-per-fixture gap R1 named for the handover
pins and R2 named for the rename pins, now at its third site.

---

### Non-blocking

**NB1 — R2-N1 is still open and is wider than R2 measured: adoption
creates the fan-out objects but none of the adopted table's own declared
columns, primary key, indexes, checks or foreign keys — while the
snapshot records all of them as existing.** Measured twice through the
real CLI (`a1.widgets` gaining `email` + an index; `s1.w` gaining
columns `a`,`b`,`c` after a partial-column handover): the run emits only
`create sequence` / `owned by` / `set default nextval` / `enable row
level security` / `create policy`, and the snapshot afterwards claims
`"indexes":[{"name":"widgets_email_idx"…}]`, `"primaryKeyName":
"widgets_pkey"` and every unemitted column. No later run will ever
create them — the snapshot says they are already there. The delta's own
enumeration is closed ("its sequences, its row-level security, its
policies"), so the scenario is not contradicted; but both user-facing
texts rewritten in round 2 now say **"everything the new declaration
manages on it … is created exactly as it would be for any other managed
table"** (`.changeset/declare-existing-tables.md`,
`skills/hejbro/references/brownfield-adoption.md`), which a reader will
not read as "the three things in the parenthesis and nothing else".
Still no clause, no pin, no issue.

**NB2 — R2-N2 (`check`'s inventory widening, R1-N1, #665) is still
open**, now with a concrete measurement: with `app.posts` managed and
`auth.users` declared existing, `buildInventory` returns
`auth.sessions`, `auth.refresh_tokens`, `auth.mfa_factors` as unmanaged.
For the flagship Supabase case the report simultaneously prints
`check does not compare auth.users: declared existing and not compared.`
and lists the rest of `auth` as unmanaged — the boundary line makes the
inconsistency louder than it was in round 1.

**NB3 — R2-N3 (R1-N2: "A validator that … checks a reference SHALL see
it" has no shipped observer, #666) is still open.** `grep -rn
foreignKeys` over `core/src/engine/core-validators.ts`,
`supabase/src/validators/`, `nile/src/validators.ts` returns nothing.
The clause remains structurally satisfiable and unexercised.

**NB4 — R2-N4 (the vendored client's read half is Docker-gated only,
#667) is still open.** `packages/cli/vitest.config.ts:14-16` excludes
`test/**/*integration.test.ts` from the default run; the contract half
of "A consumer reads a platform-owned table" is well pinned
(`contract-existing.test.ts`, re-verified end to end here through a real
CLI export), the client-read half is not observable without Docker.

**NB5 — the changeset and the skill now carry a new claim that R3-B2
falsifies.** Both say adding/changing/renaming/removing an existing
declaration means "none of them can block or refuse an unrelated managed
change in the same schema either"
(`.changeset/declare-existing-tables.md`;
`skills/hejbro/references/brownfield-adoption.md`, "Deciding what to
manage"). Reproduction α is exactly that: adding an existing declaration
(as a handover) refuses an unrelated managed table addition in the same
schema. Round 2 rescoped these two texts to close R2-N5; the rescoped
version overshot in the other direction. Whatever the resolution of
R3-B2, this sentence must not outrun it. (Minor, same files: the code
sample under that section still labels its example
`// Permanently unmanaged`, three paragraphs after the prose explains
the choice is no longer permanent.)

**NB6 — `hejbro baseline` on a project whose only declarations are
existing tables fails with a message that is factually false.** Measured:
a project declaring only `existingTable("auth","users",…)` gets

```
error[baseline-nothing-to-adopt]: src/**/*.schema.ts
  baseline found nothing to adopt: your declaration files loaded, but exported
  no hejbro declarations (schema/table/... calls). …
```

exit 1. The file *did* export a hejbro declaration; before this change
that path was unreachable (an `existingTable()` was refused as a
declaration outright), so the message never had to be true of it.
`commands/generate.ts:724-727` runs `throwBaselineNothingToAdopt` off
`!firstPass.hasChanges`, which this change decoupled from "there are no
declarations". No scenario covers it (the delta's baseline scenario is
about a *mixed* project, which works — verified: the baseline SQL
carries `create schema "app"` + `create table "app"."posts"` and nothing
naming `auth.users`, and the snapshot records `table:auth.users`).

**NB7 — `excludeExisting`'s own doc comment states the contract the code
does not implement.** `snapshot-sets.ts:37-45`: "never a rename
ambiguity source, **on either side of a run** … so both
`computeSchemaTableSets` and `computeTableColumnSets` — and, through
them, every ambiguity/pairing computation downstream — never see one."
The function filters one map at a time and cannot see the other side.
Recorded separately from R3-B2 because this comment (and the identical
claim in `## Round 2 disposition`) is what makes the gap invisible to
the next reader: a maintainer checking "is the rename planner
existing-aware?" reads the comment and stops.

---

### Verified scenarios

| # | Capability | Scenario | Verdict | Evidence |
|---|---|---|---|---|
| 1 | table-declaration | An existing declaration produces no migration | **OK** | Real-CLI repros A/B/C: column rename inside an existing declaration, rename of the declaration itself, and removal beside a managed addition in the same schema all report `no migration — snapshot updated…` (or emit only the managed table) with zero migration files naming the existing table; `rename-plan.ts:47-50`; `generate.test.ts` R2-B1 repro block |
| 2 | table-declaration | A managed table may reference an existing one | **OK** | Real CLI: `alter table "app"."posts" add constraint "posts_author_id_fk" foreign key ("author_id") references "auth"."users" ("id")`; `grep auth` over every migration file in that project returns only that constraint line — no `create schema "auth"`, no statement naming `auth.users` as a subject |
| 3 | table-declaration | A table handed to the platform loses nothing | **BLOCKING (R3-B2)**; the isolated case OK, and its snapshot clause now genuinely closed | Isolated handover (`k1.widgets`, `serial` PK + rls + policy, and the partial-column pair `s1.w`): no migration, on-disk snapshot carries `"existing": true`, `sequence:`/`rls:`/`policy:` nodes leave the snapshot with no DDL, and the follow-up removal run still writes no drop. In a run that also adds a table in that schema: refused, and the prescribed remedy emits `alter table "s2"."widgets" rename to "gizmos"` |
| 4 | table-declaration | An adopted table gains what the declaration manages | **BLOCKING (R3-B2)**; the isolated case OK but see NB1 | Isolated adoption: no `create table`, `create sequence` + `owned by` + `set default nextval` + `enable row level security` + `create policy` all emitted. In a run that also drops a table in that schema: refused, remedy renames a managed table onto the existing table's identity. Declared indexes/columns/PK never created (NB1) |
| 5 | table-declaration | A reserved-schema validator exempts an existing table | **OK** | Real CLI with `presets:[supabasePreset]`: `existingTable("auth","users")` → exit 0, no diagnostic; adding `table(auth,"sessions",…)` in the same schema → `error[reserved-schema]: auth`. `supabase/src/validators/reserved-schemas.ts:30-49`; `supabase` suite 17f/141t green |
| 6 | table-declaration | An older snapshot's tables are all managed | **OK** | `kinds/table-snapshot.ts:274-275` (`snapshot.existing === true`); `core/test/snapshot.test.ts` `formatVersion: 8` node; core suite 98f/1476t + 1 todo green |
| 7 | schema-export | An existing table survives the round trip | **OK** | Real CLI `generate --export` → `validateExport` over that run's own files: `existing:true`, `exportName:"ledger"`, `balance.mode:"bigint"`, `tags.notNullElements:true` all recovered; embedded snapshot node carries the array `typeNode` |
| 8 | schema-export | A description written before the mark reads as managed | **OK** | `vendor/validate-export.ts:37-49` (`existing: z.boolean().default(false)`, no `descriptionFormat` bump); `validate-export.test.ts` green in-process |
| 9 | schema-vendoring | A consumer reads a platform-owned table | **OK** (contract half measured end to end; client-read half NB4) | Real CLI export → `validateExport` → `emitContract`: `Tables["users"]` with full `Row`/`Insert`/`Update`, `contractMetadata.tables.users.existing: true`, and with the FK declared, `referencedRelation: "auth.users"` in `posts`' `Relationships`. `query/src/client/synthesize.ts:92-119` synthesizes every vendored table with no existing filter |
| 10 | schema-vendoring | An undeclared table still has no relation | **OK** | `contract/tables.ts:178-196` (`findTableInSnapshot` → drop); `contract-emit.test.ts` "no relation is derived for an unmanaged target" green |
| 11 | cli-commands | An existing declaration is neither compared nor inventoried | **OK** (NB2 still open on the surrounding schema) | `check/compare.ts:414-427` returns `[]` before any catalog lookup; `check/inventory.ts:38-44`; `check-command.test.ts:545-635` — fixture has the catalog holding the table with a *different* type, all four clauses green in-process |
| 12 | cli-commands | An existing declaration is named in the coverage boundary, never as a finding | **OK** | `commands/check.ts:120-133` + `:257`; the one production call site (`:458`) passes the declaration-derived snapshot, so the line appears even before the marker reaches disk. `summaryLine` (`:214-223`) and the exit-0 branch (`:260-265`) carry no agreed-object count, so the conditional "SHALL NOT be among them" clause has nothing to condition on — vacuously true, as round 2 measured. Four assertions green |
| 13 | cli-commands | baseline and reset pass an existing declaration by | **OK** (see NB6 for the existing-only edge) | Real CLI baseline over a mixed project: SQL carries `create schema "app"` + `create table "app"."posts"`, nothing naming `auth.users`; snapshot records `table:auth.users`. `apply-reset.test.ts:147-183` (`planReset` → `["table:app.managed","schema:app"]`, no DDL call mentioning `auth`) green; `apply-raise.test.ts` green |
| 14 | cli-commands (MODIFIED) | A recorded declaration that emits nothing still writes the snapshot | **OK as written — but see R3-B1 for what it leaves behind** | Real CLI: adding `existingTable("auth","users")` to an in-sync project → no migration file, snapshot gains `"table:auth.users": {…,"existing":true}`, `no migration — snapshot updated to record the declared change.`, exit 0. Every clause of the scenario holds; the chain-integrity consequence is not one of its clauses |
| 15 | cli-commands (MODIFIED) | No difference writes nothing | **OK** | Real CLI, second run with no edit: `no changes — snapshot already matches your declarations.`, exit 0, no new file; `noMigrationReportLine` (`commands/generate.ts:624-628`) keeps the two lines distinct |

---

### Method

- `pnpm exec openspec show add-unmanaged-objects --diff` from the repo
  root — four ADDED requirements and one MODIFIED, fifteen scenarios
  read against the main spec. (That command prints `proposal.md`'s
  narrative ahead of the diff; it was skipped, and the review is written
  against the requirement/scenario text only.) Read from
  `evaluation.md`: the round-1 and round-2 findings lists,
  `## Round 1 disposition`, `## Round 2 disposition` and
  `### Snapshot consumers`. `design.md`, `tasks.md`, PR bodies,
  `git log` messages and `blackbox/` were not read.
- **The built CLI is stale** (`packages/cli/dist` newest file
  2026-08-28, `packages/cli/src` 2026-09-02), and the brief forbids
  `pnpm build`, so the 23 `packages/cli` subprocess suites cannot run.
  Rather than read them only, this round drove the CLI **from source**:
  a throwaway `node --import` hook (`module.registerHooks`) mapping
  `hejbro`/`@hejbro/*` and any `packages/*/dist/{index,cli}.js` to the
  corresponding `src/*.ts`, with Node 26's native TS type-stripping and
  an extensionless-import fallback, running
  `packages/cli/src/cli.ts` in a real tmp project (config, `src/*.
  schema.ts`, `node_modules/hejbro` symlink — the same layout
  `test/support/cli-runner.ts` builds). Confirmed live end to end
  (`init`, `generate`, `generate --export`, `baseline`, `verify` all
  behave, with jiti loading the fixtures through the same hook), so
  every CLI measurement above is the shipped code path, not a
  hand-assembled payload.
- Eighteen throwaway projects under `/tmp/d106r3/` (deleted afterwards;
  no repository file created or modified except this report). They
  exercised: an `existingTable()` added to an in-sync project, and
  removed again; the managed→existing handover with `serial` + rls +
  policy, and the removal after it; the reverse adoption, with an index,
  a `notNull` column and a wider column list than the existing
  declaration carried; the partial-column pair in both directions; R2-B1
  repros A–D through the real CLI; a handover and an adoption each
  combined with another table added or dropped in the same schema
  (R3-B2), with both prescribed remedies applied and their SQL read; a
  managed FK onto an existing table, with the export and the emitted
  contract read back; the rich-column export round trip; `--rename` and
  `--confirm-drop` naming an existing table; the Supabase preset with a
  reserved-schema existing declaration and a managed one; `baseline`
  over a mixed and over an existing-only project; and `hejbro verify`
  after each of the no-migration snapshot writes (R3-B1).
- Three in-process probes through the same hook:
  `buildInventory` over a fake `auth` catalog (NB2), the Nile
  serial/tenant-PK/identity validators against an existing tenant-aware
  table and its managed twin, and `validateExport` → `emitContract` over
  the real files a CLI run wrote.
- Read: `packages/core/src/{engine/generate.ts, engine/rename-plan.ts,
  engine/rename/snapshot-sets.ts, kinds/table-snapshot.ts,
  dsl/{table,existing-table}.ts}`; `packages/cli/src/{commands/
  {generate,check,verify,vendor}.ts, check/{compare,inventory}.ts,
  export/{description,write}.ts, vendor/validate-export.ts,
  contract/{emit,tables}.ts}`; `packages/query/src/client/
  {synthesize,name-keyed-db}.ts`; `packages/supabase/src/validators/
  reserved-schemas.ts`; `packages/nile/src/validators.ts`;
  `skills/hejbro/references/brownfield-adoption.md`;
  `.changeset/declare-existing-tables.md`;
  `openspec/specs/cli-commands/spec.md`.
- Tests run: `packages/core` 98 files / 1476 passed + 1 todo (green).
  `packages/supabase` 17 files / 141 passed (green). `packages/cli`
  in-process subset (`check-command`, `check-compare`,
  `contract-existing`, `contract-emit`, `validate-export`,
  `apply-reset`, `apply-raise`) — 86 passed, the only two reds being
  `check-command.test.ts`'s two subprocess `--help` cases, which fail on
  the dist-freshness guard alone.
- Not run / environment notes: the full `packages/cli` suite is 23 files
  red on `assertFreshBuild` (`test/support/cli-runner.ts:61`) plus the
  same pre-existing `assert-schema.test.ts` failure round 2 recorded (an
  artifact of invoking vitest outside turbo — `vitest.shared.ts` aliases
  `@hejbro/core`/`@hejbro/query` to source but not `@hejbro/supabase`).
  `packages/nile` has no installed `node_modules`; its validators were
  replayed against source instead. `packages/skills` is 4/5 files green
  with one unrelated red (`neon-preset.md`'s snippet cannot resolve
  `@neondatabase/serverless` — a missing optional dependency in this
  checkout, not a text change from this piece). Docker-gated
  `*integration.test.ts` files were not run.

## Round 3 disposition

Both blocking findings are closed, all seven non-blocking findings are
either closed or newly opened as tracked issues, and three lead-added
items landed for the 0.2.0 release tray (#665, #666, #658's table
half). Example coverage (evaluation.md's own "the repository's own
`examples/` declare no `existingTable()`" note) is explicitly out of
scope this round — handed off as #674.

### R3-B2 — fixed

`excludeExisting` (`packages/core/src/engine/rename/snapshot-sets.ts`)
took only one map and filtered it on its own, so a table managed on one
side and existing on the other — exactly a handover or an adoption —
stayed present on the side it hadn't left, reading as a genuine
drop/create the moment another table in the same schema also changed.
Rewritten to take both `previousTables`/`nextTables`, compute the union
of identities existing on *either* side first (`isExistingOnEitherSide`),
then remove that union from *both* maps before `computeSchemaTableSets`/
`computeTableColumnSets` ever see them (`packages/core/src/engine/
rename-plan.ts`'s one call site, now destructuring `{ previousTables,
nextTables }`). Red: the evaluator's own repros α (handover + an
unrelated managed table added in the same schema) and β (adoption + an
unrelated managed table dropped in the same schema), replayed verbatim
in `packages/core/test/generate.test.ts`, reproducing the exact
`ambiguous-table-rename` error text evaluation.md quoted before the fix,
green after. Mutant (revert to independent per-map filtering): exactly
2 red / 41 in that file, R2-B1's own A-D repros stay green (a different
code path — same-map transitions, not cross-map ones).

### R3-B1 (J13) — fixed

The live `cli-commands` requirement "The migration chain on disk is
verifiable" already says the banner's two hashes are the declaration
snapshot before/after, never the SQL text — so a run with no statement
to write was never an exception to that requirement, it was the
requirement working as specified once the implementation caught up.
`generateMigrations`' own no-DDL branch (`packages/core/src/engine/
generate.ts`) now returns one migration carrying no statements, banner
included with the same before/after hashes any other migration's would,
whenever the settled snapshot differs from `previousSnapshot` with no
`KindChange` to explain it — never a generic `migrations: []` write-nothing
in that case. `commands/generate.ts` was restructured so this case falls
through to the *existing* write-files path (second pass for banner
hashes, `buildWrittenMigrations`, file writes, report) instead of a
second, CLI-side assembly of banner/hash/file-format rules — matching
the lead's own ruling that those rules stay in core alone.

**Slug.** `deriveSlug` cannot name this run at all: an existing-marker
transition produces no `KindChange`, so `changes` is always `[]`, and
`deriveSlug([])`'s own `"migration"` fallback was explicitly ruled out
for this case. `deriveExistingTransitionSlug` (new, `packages/core/src/
sql/migration-file.ts`, exported from `@hejbro/core`) mirrors
`deriveSlug`'s exact shape — verb + `_` + the identity's last
dot-segment, first difference only, no third part, no schema prefix —
reading the snapshot difference directly instead of a `KindChange`
array. Four verbs, all taken from this same change's own delta/skill
prose rather than invented: `record` (a marker appeared), `forget` (one
disappeared), `release` (managed → existing, the same word the delta
uses for "hands the table to the platform"), `adopt` (existing →
managed, the delta's own word for the reverse). "First difference" is
deterministic the same way `stableJson` is: both snapshots' `table:`
keys, unioned and sorted with `compareKeys` (plain string order), first
key in that order whose existing status moved wins. Never falls through
to a generic default — reaching this function with no transition found
is an internal-invariant throw, not a silent default, since a caller
only reaches it once the two snapshots are already known to differ.

**A real bug, caught by running the suite, not by inspection.** Gating
the slug choice on `migration.changes.length` broke the existing
`--rename` test: a pure rename (`RenamePlan.renameStatements` only, no
`KindChange` at all) already has `hasChanges: true` with an empty
`changes` array, a real, pre-existing shape `deriveSlug([])`'s own
`"migration"` fallback already handled correctly before this round.
Routing it into `deriveExistingTransitionSlug` instead threw, looking
for a transition that wasn't there. Fixed by gating on the *run's* own
`hasChanges`, threaded down from the CLI's own `finalPass.hasChanges`,
not on the per-migration `changes` array.

**A CRAP violation, caught and fixed by redesign, not by tests.**
`classifyExistingTransition`'s first draft (four independently-computed
booleans feeding a four-way if-chain) measured complexity 13 — CRAP
148.31, nowhere near the ≤5 budget even at full coverage (CRAP equals
complexity exactly at 100%, per this repo's own gate). Redesigned as a
three-state classifier (`sideOf`: `absent`/`existing`/`managed` for
each side) feeding a plain object lookup keyed by `previous:next` —
branching collapsed to near zero. The same redesign also surfaced a
coverage gap: `deriveExistingTransitionSlug`/`classifyExistingTransition`
were exercised only through CLI subprocess tests, invisible to
`packages/core`'s own coverage instrumentation (a different process
entirely) — closed with 7 new direct unit tests in `packages/core/test/
migration-file.test.ts` (all four transitions, the last-dot-segment
rule, first-in-sorted-order determinism, and the internal-invariant
throw). Re-measured: 0/1606 functions over the CRAP threshold.

**Four CLI reds** (evaluator's own reproductions, real CLI and real
disk): ① an in-sync project that adds a new `existingTable()` →
`generate` → `verify` passes ② a later run that *does* emit real DDL
after that → `verify` still passes (the evaluator's own "second failure
mode", `broken-chain`) ③ the same two, through the handover path
(`k1.widgets`) ④ the zero-statement migration's own slug is
deterministic across two entirely independent fixture directories given
the same declared change. Plus one new real-server integration test
(`packages/cli/test/apply-live.integration.test.ts`, both PG majors): a
*real* `hejbro generate` run's own zero-statement migration — never
hand-written, the way the round 3 evaluator's own repro method had to
be given the brief's stale-dist constraint — applies via `hejbro
migrate` against a live server, the ledger records both rows, and
`verify` passes afterward. Mutant (revert `generateMigrations`' new
branch to unconditional `migrations: []`): exactly 6 red / 561 (the four
new tests plus the two R2-B2 pins and the export pin this round's report
line touches), "No difference writes nothing" and every round 2
snapshot-recording pin stay green.

**Cross-consumer verification (R3-07/R3-08/R3-10).** Widening a shared
core function's own no-DDL branch is exactly the shape this piece has
been caught by three times running (R1: the fan-out kinds; R2: the
rename planner and the CLI's own snapshot-write rule). Grep-derived,
not assumed: `generateMigrations` has exactly three call sites in the
entire source tree (`apply/reset.ts` ×1, `commands/generate.ts` ×2, both
this round's own), and every reader of `hasChanges` or the `.migrations`
array (`.length`, `[0]`, `.at()`) lives in one of those same two files
plus `engine/generate.ts` itself, where the field is defined. `reset`
cannot reach the new branch at all — `resetMigrationSql` is only called
once `planReset`'s own, independent `diffSnapshots` call has already
confirmed `changes.length > 0`, so the internal `generateMigrations`
call it makes is structurally guaranteed `hasChanges: true` too (same
snapshot pair, same diff). `baseline` reaches the core call but never
its new branch's output — the CLI's own `if (mode === "baseline")`
block (this round's NB6 fix) always returns before falling through to
the shared write-files path. `verify`'s export check uses only the
singular `generateMigration`, untouched this round (confirmed again,
having been closed the same way in round 2). Confirmed by control-flow
reading *and* re-running `apply-reset.test.ts` (13/13) and
`baseline-command.test.ts` (14/14) unchanged. No fourth consumer found.
Whether `hasChanges`'s own meaning should change (it still means "DDL
exists," and nothing reads it as "something to write") was reported as
a table and left to the lead/planner, not decided here; the live
requirement gained one clarifying sentence mid-round making the same
point ("whether a run has something to write and whether it emitted any
statement are two facts, not one").

### NB1, NB5 — fixed

`.changeset/declare-existing-tables.md` and `skills/hejbro/references/
brownfield-adoption.md` both narrowed "everything the new declaration
manages on it ... is created exactly as it would be for any other
managed table" to the closed, three-item enumeration (sequence,
row-level security, policies), citing #671 for what adoption still does
not create (indexes, check constraints, foreign keys, primary key) even
though the snapshot records them as if it had. "None of them can block
or refuse an unrelated managed change in the same schema either" is
true again once R3-B2 landed — left as-is, now backed by R3-B2's own
repro α/β tests rather than reworded. The stale `// Permanently
unmanaged` code-sample comment in the skill (three paragraphs after the
prose explains the choice is no longer permanent) was removed.

### NB6 — fixed

`hejbro baseline` on a project declaring only `existingTable()`s used to
fail with `baseline-nothing-to-adopt` — literally false, since real
declarations *did* load and export. `commands/generate.ts` now checks
`declarations.length === 0` first (the genuinely-empty case keeps the
old refusal) before falling into a new branch for the existing-only
case: writes the snapshot (baseline's `previousSnapshot` is always
empty, so it's guaranteed to differ), writes no migration file (there
was never a `create` statement for `hejbro migrate` to register), and
reports accurately, exit 0. Three new tests in `baseline-command.test.ts`
(succeeds with an accurate report; a second baseline still refuses even
with zero migration files on disk; `verify` accepts the state this
leaves behind); mutant (revert to the unconditional refusal) exactly 3
red / 14, zero collateral.

### NB7 — closed

`excludeExisting`'s own doc comment claimed the "both sides" behavior
the pre-R3-B2 code didn't implement, making the R3-B2 gap invisible to
a reader who checked the comment and stopped. Closed by R3-B2's own fix
itself: the new doc comment describes the actual union-based, both-maps
behavior accurately, since that's what the code now does.

### #665 — fixed

`check/inventory.ts`'s `declaredSchemaNames` read every snapshot node's
`.schema` unconditionally, so declaring one existing table in a reserved
schema (`auth.users`) pulled every *other* catalog table in that schema
into the unmanaged inventory — three tables nobody declared a shape or
an existing marker for. Rewritten to `Object.entries`-based filtering:
a `table:`-prefixed node contributes its schema only when it is *not*
marked existing; every other kind (`schema:`, `grant:`, functions,
views, and managed `table:` nodes) contributes exactly as before. Red:
the evaluator's own repro (`auth.users` existing-only → `auth.sessions`/
`refresh_tokens`/`mfa_factors` no longer reported unmanaged), plus a
control in the same shape round 1 used (a schema with a real managed
table still reports its own undeclared tables) proving the exemption
didn't widen past existing tables specifically. Mutant (revert to
unconditional schema reads): exactly 1 red / 27, the control stays
green.

### #666 — closed (delta narrowed by the lead/planner, pin added here)

`table-declaration`'s "one that checks a reference SHALL see it" had no
observer for three rounds running. Rather than remove the sentence, the
lead/planner narrowed it to an observable claim: "An existing
declaration SHALL still reach the validator pipeline exactly as a
managed one does" plus a new scenario, "An existing declaration reaches
the validators." The pin: a recording validator installed in
`core/test/validators.test.ts`, asserting a `generateMigration` run's
`declarations` array (as handed to every installed validator) contains
the `existingTable()` declaration with `{declarationKind: "table",
existing: true}` — green on the first run, meaning the protection was
real all along and simply unobserved. Mutant (quietly filter existing
declarations out immediately before `runValidators`, simulating exactly
the future refactor the requirement guards against): exactly 1 red /
1480.

### #658 (table half) — closed (requirement added by the lead/planner,
pins extended/measured here)

The `synced-table-declared` refusal became the *only* defense against a
vendored/synced table value reaching migration generation once this
piece moved the discriminator from `existing` to `authority` (J3) —
and no requirement anywhere named it. The lead/planner added
`table-declaration`'s "A table this repository does not author is
refused as a declaration" (new requirement, `synced-table-declared`
code, both `table()` and `existingTable()` named in the message) plus
its own scenario. Two items to close it:

(a) A pin already existed (`packages/query/test/client/
synthesize.test.ts`, asserting `error.code === "synced-table-declared"`)
but never checked the message text named both remedies — a new test
asserts the exact substring naming `table()` and `existingTable()`
together.

(b) `check:diagnostic-xref`'s own doc-catalog ask, measured rather than
assumed: the gate's `scripts/source-roots.mjs` scans `packages/*/src`
only — never `docs/` or `skills/`, and `@hejbro/skills` has no `src` at
all — so there is no doc catalog of error codes for this gate to check
against in the first place. Confirmed, not guessed: grepped for
already-shipped codes with the same shape (`synced-function-declared`,
`baseline-nothing-to-adopt`) across `docs/`/`skills/` and found neither
one documented anywhere either. Nothing added — there was nowhere to
add it, and the instruction's own condition ("문서 목록이 있으면")
never held.

### #674 — handed off

Example coverage (a supabase example with `auth.users` existing +
`profiles` FK, roundtrip + image verification + the coverage-boundary
line) is the fixture shape the round 3 evaluator's own "`grep -rn
existingTable examples/` → no matches" finding named — out of scope for
this round by the lead's own prior 3.2 ruling ("don't touch the
examples"). Filed as #674 (Task, #623 tray) per the lead's instruction;
not attempted here.

### Gates

`TURBO_FORCE=1 build --force` 7/7 (rerun across every mutant swap).
`check` 656 files clean (2 formatting nits auto-fixed by `pnpm format`;
3 ternaries the house style bans replaced with small named helpers or a
table lookup). `check-types` 16/16 (0 cached, forced, rerun multiple
times). `test` 17/17 tasks — core 98f/1487t (+7 over round 2's 1480t),
query 61f/844t (+1), cli 64f/561t (+9 net over round 2's 552t across
the whole round). `check:bans` 219 files clean. `check:crap` 0/1606 (the
two new core functions/helper measured directly and confirmed clean
after the redesign, twice). `openspec validate --strict` valid; `show
--diff` reconfirmed multiple times across this round's three separate
spec edits: `deltaCount: 6`, `cli-commands` MODIFIED still exactly one
entry (no second MODIFIED created), `table-declaration` ADDED ×2 is
correct (two distinct `### Requirement:` blocks in the same delta file
— #666's edit lives in the pre-existing requirement, #658's is a
brand-new one). `ci.yml`-derived full list (tasktime, changeset status,
first-release-version skip, next-marker, diagnostic-xref 4/217,
fixed-group 7 packages, smoke:pack-install 6 assertions) all green.
`test:integration` 5f/38t (+2 over round 2's 36t, the new zero-statement
real-server test), both PG majors (`postgres:15-alpine`/
`postgres:17-alpine`) confirmed independently, `two-repo`'s own
vendoring round trip staying green throughout.

One environmental note, recorded honestly rather than hidden: a
mid-round `pnpm test` pass showed transient `cli-smoke` timeouts, and
one `check:crap` run hit an `ENOENT` reading `packages/core/dist/
index.js` mid-coverage-run — both traced to concurrent, unrelated
processes on a shared machine (system load observed at 113-122 during
the episode; a different worktree's own build process was independently
running at the same time), not to anything this round changed. Both
cleared on retry, confirmed clean twice each afterward.

10 commits this round (`6fc944b8` through `c41a79c2`), still unpushed.
