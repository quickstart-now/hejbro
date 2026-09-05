# Design: harden-ledger-diagnostics

Contract details this change settles before code. Every one is a
`[design]` question in `tasks.md`; the lead ruled on them (owner
delegation #412/D12, D13) before any of them reached code.

**Settled — lead ruling, recorded as `.blackbox/836` R1 and
`.blackbox/823` R1.** D1 through D9 are each settled as the
recommendation stated below; the options are kept as the record of what
was considered and refused, not as open questions. The rule the nine
serve: *a failure the ledger owns is attributed to the ledger — never
left raw, never charged to a migration file.*

## Fixed by the two issues

- The ledger owns its own failures. A read hejbro sends to the ledger and
  a write hejbro sends to the ledger fail as hejbro-coded diagnostics, in
  every command that sends one.
- The relation's absence stays a state, never a failure: `readLedger`'s
  `{ exists: false }` is what "this database has never been applied to"
  is made of, and the identity probe already tells absent from occupied.
- A ledger write failure is never attributed to the migration being
  applied, and the rollback is stated.
- **Scope is the rule, not the issue's wording** (lead, 836/R2). #836 was
  filed against `status`'s *read*, but a role without `create` makes
  `migrate` dump the same raw driver object out of the bootstrap's
  `create schema` (measured, batch A4). That is a ledger write, so it is
  covered here under `apply-ledger-unwritable` with the site named
  "bootstrap": nothing the ledger owns reaches a user raw, whichever
  statement carried it.

## D1 — The two code names

**Background.** `ledger.ts`'s own header states the prefix rule settled in
`add-apply-engine` task 7.2: a prefix names the *operation*, never the one
command that minted it first; the apply-wide family is `apply-*`. Reading
and writing the ledger are each done by more than one command (`status`,
`migrate`, `raise` read; `migrate`, `raise`, `reset` write), so both codes
are `apply-*` by that rule — the carve-out for a single-command condition
(`reset-*`, `raise-*`) does not apply.

**Options.**
1. `apply-ledger-unreadable` / `apply-ledger-unwritable` — adjectives, in
   the shape of the sibling `apply-ledger-occupied` already in this
   family.
2. `apply-ledger-read-failed` / `apply-ledger-write-failed` — verbs, in
   the shape of `apply-failed` and `reset-drop-failed`.
3. One code for both, `apply-ledger-failed`, with the direction in the
   message.

**Recommendation: option 1.** The family's own existing member is an
adjective (`occupied`), and `-failed` codes in this codebase name an
*action a user asked for* (applying, dropping) — reading the ledger is
never something a user asked for by name. Option 3 is rejected on the
proposal's own grounds: the two send the reader to different remedies, and
a shared code makes an automated caller parse prose to tell them apart.

## D2 — Whether the diagnostic names the connected role

**Background.** #836's expectation names "the ledger, the role, and the
server's reason". The role is not in the failure the driver hands back;
Postgres's message says `permission denied for table migration_ledger`
without naming who was denied. hejbro can learn it with `select
current_user` — one extra read, on the failure path only.

**Options.**
1. Name the role, read with `select current_user` on the failure path;
   if that read itself fails, omit the role clause rather than fail
   twice.
2. Do not name the role; the user knows which URL they passed.
3. Derive the role from the connection string.

**Recommendation: option 1.** A connection string routinely carries no
username (it comes from `PGUSER`, a pooler, or a socket peer), so option 3
names the wrong thing exactly when it matters. `current_user` also answers
what the *server* thinks the role is after `set role`/`security definer`,
which is the fact the grant has to be written against. The cost is one
statement on a path that has already failed. Rejected variant: reading it
eagerly for every command — a healthy run pays for a diagnostic it never
prints.

*Measured (batch A2-7, `postgres:17-alpine`):* `select current_user,
session_user` succeeds for a role whose `select` on the ledger is
withheld and for one without `usage` on the `hejbro` schema — it needs no
privilege of its own, so the failure path can always ask.

*Reviewed and declined (review round 2):* on a connection that is already
gone — a terminated backend, a killed server — the role read cannot run
either, so those diagnostics carry no role clause, and the `Next:` line
generalises to "the connecting role". The reviewer proposed filling the
gap from the connection string's username. Declined on option 3's own
measured ground: a connection string routinely carries no username, and
when it does it is what the client *asked* to be, which `set role` and a
`security definer` context can both make untrue. Omitting the clause says
less; filling it from the URL would say something hejbro cannot check
precisely when it can no longer ask. The requirement's own scenario — a
withheld privilege — always has a live connection, and there the role is
named.

## D3 — Message and `Next:` wording

**Background.** The family's own template (`apply-ledger-occupied`) is:
what is at the name → why hejbro stops → `Next:` naming both ways out and
the command to rerun. `check-next-marker` requires the `Next:` marker;
`AGENTS.md` requires English.

**Proposed text — `apply-ledger-unreadable`:**

> `"hejbro"."migration_ledger"` could not be read as the role `<role>`
> (`<SQLSTATE>`): `<server message>`. hejbro reads its own ledger before
> it can say what this database has applied. Next: grant that role
> `select` on `"hejbro"."migration_ledger"` (and `usage` on the `hejbro`
> schema), or connect as the role that applied, then rerun `<command>`.

**Proposed text — `apply-ledger-unwritable`:**

> writing `"hejbro"."migration_ledger"` was refused as the role `<role>`
> (`<SQLSTATE>`): `<server message>`. `<what was being written>` — the
> migration itself was rolled back with it, so nothing from
> `<file>` is applied and the ledger records nothing new. Next:
> `<remedy>`, then rerun `<command>`.

**Options for `<what was being written>` / `<remedy>`.**
1. Three write sites named in words — "the row recording `<file>`", "the
   ledger's own bootstrap", "the clearing of the ledger's rows" — with one
   shared remedy sentence ("resolve what the error above describes on the
   ledger itself").
2. A per-SQLSTATE remedy (23502 → the ledger's `id` lost its identity;
   42501 → grant `insert`; 23505 → a concurrent run recorded it).
3. No site name, no remedy branch: server code plus message only.

**Recommendation: option 1 plus one SQLSTATE branch.** The write site is
free (the caller knows it) and is the fact that tells a reader whether the
ledger's *shape* or its *grants* are at fault. Beyond that, one branch
earns its place: the measured `23502` case (#823) is the one where the
server's own message ("null value in column \"id\"") points at hejbro's
own insert rather than at the ledger's altered shape, so it gets a
sentence naming the identity/default the bootstrap creates. Every other
SQLSTATE stays on the generic branch — the same discipline `execute.ts`
applies to `apply-failed` (one named exception, `55P04`, everything else
generic).

*Measured (batch A2/A3) — why the site word cannot come from the server:*
a withheld `select`, a withheld `insert` and a withheld `delete` on the
ledger are all `42501 permission denied for table migration_ledger`,
byte-identical; a withheld schema `usage` is `42501 permission denied for
schema hejbro` — the same SQLSTATE as all three. So neither the code nor
the message says which statement hejbro sent, and only the caller knows.
The bootstrap's own two refusals are `42501 permission denied for
database <db>` (`create schema`) and `42501 permission denied for schema
hejbro` (`create table`) — measured to occur naturally: `migrate` under a
role without `create` fails there before it ever reaches a read.
The `23502` row carries `DETAIL: Failing row contains (null, …)` and
node-postgres exposes `.schema`/`.table`/`.column` (`"id"`) on it, so that
branch names the column from the driver's own field, never by parsing the
message. `driverErrorDetail` already exists in `execute.ts` for exactly
this kind of reuse.

## D4 — Where the classification lives, and how the failing half is known

**Background.** `apply/ledger.ts` is the only module that sends a
statement to the ledger; `execute.ts` runs the migration's own statement
and the ledger row inside one `try`. Today its single `catch` cannot tell
the halves apart, which is #823.

**Options.**
1. `ledger.ts` wraps every statement it sends and rethrows a tagged
   failure (the server error kept as `cause`); `execute.ts`'s catch tests
   the tag first, and `apply-failed` becomes the else-branch.
2. `execute.ts` tracks a phase variable across the transaction callback.
3. The catch classifies by matching the failure's message or the SQL
   text.

**Recommendation: option 1.** The tag is set where the statement is
actually sent, so a future caller of `ledger.ts` inherits the attribution
without knowing it exists; option 2 needs `let` (banned) or a re-shaped
callback, and option 3 is the "read the rendered message back" pattern the
codebase already refuses (`raise.ts` classifies on `error.cause`,
structurally, for exactly this reason).

**Where the text lives, and when it may be built.** The two codes'
messages live in a sibling module, `apply/ledger-diagnostics.ts`, exactly
as `apply-ledger-occupied`'s live in `ledger-identity.ts`: `ledger.ts`
sends statements and tags failures, a sibling owns the refusal's prose.
That also keeps the import graph acyclic and the driver-error readers
un-duplicated — `ledger-diagnostics.ts` → `execute.ts` → `ledger.ts`, one
way, so `execute.ts` stays a rethrower and never imports the classifier.

*Measured — why classification runs outside the failed transaction:* a
statement sent on a transaction that already failed is refused with
`25P02 current transaction is aborted, commands ignored until end of
transaction block`, measured both with a generic failure and with #823's
own `23502` insert. The role read (D2) would therefore return nothing at
all if the classifier ran inside the transaction callback — the diagnostic
would silently lose its role clause in precisely the case the issue is
about. Callers classify after `driver.transaction()` has rolled back and
handed the driver back usable.

## D5 — `migrate`'s exit code for a ledger failure

**Background.** The spec's three answers: zero (nothing pending or all
applied), one (the database refused a migration), two (the run could not
act at all).

**Options.** 1 — one, reusing today's `failureResult` path. 2 — two, as a
run that could not act.

**Recommendation: two.** A ledger failure is the one case that proves the
database refused *no* migration: the transaction rolled back, so nothing
was applied. Reporting one would tell an automated caller that a migration
was refused, sending it to look at a file that is fine. Migrations applied
before the failing one are still reported in their own bucket on stdout,
as they are today.

## D6 — Does `reset`'s ledger clearing leave `reset-drop-failed`?

**Background.** `reset` runs its drops and `clearLedgerRows` in one
transaction, and today every failure inside it becomes `reset-drop-failed`
— a code whose `Next:` line talks about dependencies between dropped
objects and about declared cycles. A refused `delete` on the ledger has
nothing to do with either.

**Options.** 1 — the ledger's delete gets `apply-ledger-unwritable`,
`reset-drop-failed` keeps the drops. 2 — leave it as `reset-drop-failed`,
out of this change's scope.

**Recommendation: option 1**, on D13's completeness ground the brief
states: the rule is "a failure the ledger owns is attributed to the
ledger", and one path left behind is the same defect under another
command's name. The delta's own reset requirement gains the sentence.

## D7 — Which paths receive the rule (the measured table)

*Measured (batch A5, grep over `packages/cli/src`).*

| Ledger statement | Function | Commands reaching it |
|---|---|---|
| catalog identity probe | `probeLedgerIdentity` | `migrate`, `status`, `reset`, `raise` |
| full read | `readLedger` | `status`, `migrate`, `raise` |
| single-row recheck | `isMigrationRecorded` | `migrate`, `raise` (inside the apply transaction) |
| bootstrap DDL | `bootstrapLedger` | `migrate`, `raise` |
| row insert | `recordAppliedMigration` | `migrate`, `raise` |
| clear rows | `clearLedgerRows` | `reset` |

`verify` imports nothing from the ledger modules — it reads the chain and
the snapshot on disk only — so the five commands the brief names are four
in the measured source, and `reset` is a *writer* only: it probes and
clears, and never calls `readLedger`. The probe reads only
`pg_class`/`pg_namespace`/`pg_attribute`, world-readable: measured, both
privilege-starved roles ran it successfully and got `ledger` back, which
is exactly how a run reaches the refused read one statement later.
Whether a probe failure also takes `apply-ledger-unreadable` is **D8**.

## D8 — Does the identity probe's own failure take the read code?

**Options.** 1 — yes: a failure of the catalog read is a failure to find
out what is at the ledger's name, and it is the first statement every
ledger-touching command sends. 2 — no: it reads the catalog, not the
ledger, and a catalog read that fails is a database-wide problem the
connection check should have caught.

**Recommendation: option 1**, with the message naming the catalog read as
what was refused. It costs one wrap at one call site and closes the
"nothing raw reaches the user" promise across the whole ledger path
instead of most of it.

## D9 — 42P01's leniency after this change

**Background.** `readLedger` treats 42P01 as `{ exists: false }`. With the
identity probe running first, an absent ledger is already known before the
read, so the leniency now covers only the race where the relation vanishes
between the probe and the read.

**Options.** 1 — keep the leniency exactly as it is (the race stays the
no-ledger answer). 2 — drop it, so the race becomes
`apply-ledger-unreadable`. 3 — stop calling `readLedger` at all when the
probe answered `absent`.

**Recommendation: option 1.** It is the smallest change consistent with
both issues, and the race's outcome under it ("this database has never
been applied to") is *true at the moment it is reported*. Option 3 is a
structural improvement with no defect behind it — **reviewed and
deferred** (lead, 836/R1): out of scope here, and deliberately not filed
as an issue; this paragraph is its record.

*Measured (batch A2-4/A2-5):* a `select` against a schema that does not
exist and a `select` against a missing table in an existing schema give
the **same** answer — `42P01 relation "hejbro.migration_ledger" does not
exist`. There is no `3F000` face of this defect, and `readLedger`'s
existing single-code leniency already covers both absences. No change is
needed there, which is what makes option 1 the smallest one.
